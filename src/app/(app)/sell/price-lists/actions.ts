"use server";

import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, t } from "@/db";
import { assertEntityAccess, getEntityContext } from "@/lib/dal";

export type ActionResult = { ok?: true; error?: string; id?: string; saved?: number };

async function context() {
  const { user, entity } = await getEntityContext();
  await assertEntityAccess(user.id, entity.id);
  return { user, entity };
}

async function ownList(entityId: string, id: string) {
  const [l] = await db.select().from(t.priceLists).where(and(eq(t.priceLists.id, z.string().uuid().parse(id)), eq(t.priceLists.entityId, entityId)));
  if (!l) throw new Error("Price list not found.");
  return l;
}

function revalidate(id?: string) {
  revalidatePath("/sell/price-lists");
  revalidatePath("/sell/customers");
  if (id) revalidatePath(`/sell/price-lists/${id}`);
}

const errorText = (e: unknown, fallback: string) => (e instanceof z.ZodError ? e.issues[0].message : e instanceof Error ? e.message : fallback);

const ListSchema = z.object({
  name: z.string().trim().min(1, "Give the price list a name").max(100),
  /** Percent as typed: -15 = 15% below the default list. null = own prices only. */
  adjustPercent: z.number().min(-100).max(1000).nullable(),
  notes: z.string().trim().max(2000).nullable().optional().transform((v) => (v ? v : null)),
});

async function nameTaken(entityId: string, name: string, exceptId?: string) {
  const [clash] = await db
    .select({ id: t.priceLists.id })
    .from(t.priceLists)
    .where(and(eq(t.priceLists.entityId, entityId), sql`lower(${t.priceLists.name}) = lower(${name})`, exceptId ? ne(t.priceLists.id, exceptId) : sql`true`));
  return !!clash;
}

/** New price list. The entity's first list becomes the default. Optionally starts as a copy of another list's prices. */
export async function createPriceList(input: z.input<typeof ListSchema> & { copyFromId?: string | null }): Promise<ActionResult> {
  try {
    const { user, entity } = await context();
    const v = ListSchema.parse(input);
    if (await nameTaken(entity.id, v.name)) return { error: `There is already a price list called "${v.name}".` };
    const source = input.copyFromId ? await ownList(entity.id, input.copyFromId) : null;
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(t.priceLists).where(eq(t.priceLists.entityId, entity.id));
    const id = await db.transaction(async (tx) => {
      const [l] = await tx
        .insert(t.priceLists)
        .values({ entityId: entity.id, name: v.name, notes: v.notes, isDefault: n === 0, adjustPct: v.adjustPercent === null || n === 0 ? null : String(v.adjustPercent / 100) })
        .returning({ id: t.priceLists.id });
      if (source)
        await tx.execute(sql`insert into price_list_items (price_list_id, product_id, price)
          select ${l.id}, product_id, price from price_list_items where price_list_id = ${source.id}`);
      await tx.insert(t.auditLog).values({ entityId: entity.id, userId: user.id, tableName: "price_lists", recordId: l.id, action: "create", changes: { name: v.name, adjustPercent: v.adjustPercent, copiedFrom: source?.name ?? null } });
      return l.id;
    });
    revalidate(id);
    return { ok: true, id };
  } catch (e) {
    return { error: errorText(e, "Couldn't create the price list.") };
  }
}

export async function updatePriceList(input: z.input<typeof ListSchema> & { id: string }): Promise<ActionResult> {
  try {
    const { user, entity } = await context();
    const before = await ownList(entity.id, input.id);
    const v = ListSchema.parse(input);
    if (await nameTaken(entity.id, v.name, before.id)) return { error: `There is already a price list called "${v.name}".` };
    const adjustPct = before.isDefault || v.adjustPercent === null ? null : String(v.adjustPercent / 100);
    await db.update(t.priceLists).set({ name: v.name, notes: v.notes, adjustPct, updatedAt: new Date() }).where(eq(t.priceLists.id, before.id));
    await db.insert(t.auditLog).values({
      entityId: entity.id,
      userId: user.id,
      tableName: "price_lists",
      recordId: before.id,
      action: "update",
      changes: { name: { from: before.name, to: v.name }, adjustPct: { from: before.adjustPct, to: adjustPct } },
    });
    revalidate(before.id);
    return { ok: true, id: before.id };
  } catch (e) {
    return { error: errorText(e, "Couldn't save the price list.") };
  }
}

/** Makes this the default list (used by customers with no list of their own). The old default keeps its prices. */
export async function makeDefault(id: string): Promise<ActionResult> {
  try {
    const { user, entity } = await context();
    const l = await ownList(entity.id, id);
    if (l.isDefault) return { ok: true, id };
    await db.transaction(async (tx) => {
      await tx.update(t.priceLists).set({ isDefault: false }).where(and(eq(t.priceLists.entityId, entity.id), eq(t.priceLists.isDefault, true)));
      await tx.update(t.priceLists).set({ isDefault: true, adjustPct: null, active: true }).where(eq(t.priceLists.id, id));
      await tx.insert(t.auditLog).values({ entityId: entity.id, userId: user.id, tableName: "price_lists", recordId: id, action: "make_default", changes: { name: l.name } });
    });
    revalidate(id);
    return { ok: true, id };
  } catch (e) {
    return { error: errorText(e, "Couldn't change the default list.") };
  }
}

const PricesSchema = z.object({
  listId: z.string().uuid(),
  changes: z
    .array(z.object({ productId: z.string().uuid(), price: z.number().finite().min(0, "Prices can't be negative").nullable() }))
    .max(5000),
});

/** Sets (or, with price null, removes) a list's prices for the given products. */
export async function savePrices(input: z.input<typeof PricesSchema>): Promise<ActionResult> {
  try {
    const { user, entity } = await context();
    const v = PricesSchema.parse(input);
    const list = await ownList(entity.id, v.listId);
    if (!v.changes.length) return { ok: true, saved: 0 };
    const ids = [...new Set(v.changes.map((c) => c.productId))];
    const found = await db.select({ id: t.products.id }).from(t.products).where(and(eq(t.products.entityId, entity.id), inArray(t.products.id, ids)));
    if (found.length !== ids.length) return { error: "One of the products isn't in this entity." };
    const set = v.changes.filter((c) => c.price !== null);
    const remove = v.changes.filter((c) => c.price === null).map((c) => c.productId);
    await db.transaction(async (tx) => {
      if (remove.length) await tx.delete(t.priceListItems).where(and(eq(t.priceListItems.priceListId, list.id), inArray(t.priceListItems.productId, remove)));
      if (set.length)
        await tx
          .insert(t.priceListItems)
          .values(set.map((c) => ({ priceListId: list.id, productId: c.productId, price: String(c.price) })))
          .onConflictDoUpdate({
            target: [t.priceListItems.priceListId, t.priceListItems.productId],
            set: { price: sql`excluded.price`, updatedAt: new Date() },
          });
      await tx.insert(t.auditLog).values({
        entityId: entity.id,
        userId: user.id,
        tableName: "price_list_items",
        recordId: list.id,
        action: "update_prices",
        changes: { list: list.name, set: set.length, removed: remove.length },
      });
    });
    revalidate(list.id);
    return { ok: true, id: list.id, saved: v.changes.length };
  } catch (e) {
    return { error: errorText(e, "Couldn't save the prices.") };
  }
}

/** Deletes a list that no customer uses (never the default). */
export async function deletePriceList(id: string): Promise<ActionResult> {
  try {
    const { user, entity } = await context();
    const l = await ownList(entity.id, id);
    if (l.isDefault) return { error: "The default price list can't be deleted. Make another list the default first." };
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(t.customers).where(eq(t.customers.priceListId, id));
    if (n > 0) return { error: `${n} customer${n === 1 ? " uses" : "s use"} this price list. Move them to another list first.` };
    await db.transaction(async (tx) => {
      await tx.delete(t.priceLists).where(eq(t.priceLists.id, id));
      await tx.insert(t.auditLog).values({ entityId: entity.id, userId: user.id, tableName: "price_lists", recordId: id, action: "delete", changes: { name: l.name } });
    });
    revalidate();
    return { ok: true };
  } catch (e) {
    return { error: errorText(e, "Couldn't delete the price list.") };
  }
}
