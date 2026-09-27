"use server";

import { and, eq, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, t } from "@/db";
import { diff, formNumber, formText } from "@/lib/audit";
import { assertEntityAccess, getEntityContext } from "@/lib/dal";

export type FormState = { error?: string } | undefined;
const TYPES = ["product", "material", "service"] as const;

/** Create or update a product / material / service item. */
export async function saveProduct(_: FormState, fd: FormData): Promise<FormState> {
  let savedId: string;
  try {
    const { user, entity } = await getEntityContext();
    await assertEntityAccess(user.id, entity.id);
    const id = formText(fd, "id");
    const sku = formText(fd, "sku", 80);
    const name = formText(fd, "name", 300);
    if (!sku) return { error: "Enter a SKU (variant code)." };
    if (!name) return { error: "Enter the item name." };
    const type = String(fd.get("type") ?? "product") as (typeof TYPES)[number];
    if (!TYPES.includes(type)) return { error: "Choose a type." };
    const cost = formNumber(fd, "standardCost", "Standard cost") ?? 0;
    const safety = formNumber(fd, "safetyStock", "Safety stock") ?? 0;
    if (cost < 0 || safety < 0) return { error: "Cost and safety stock can't be negative." };
    const supplierId = formText(fd, "defaultSupplierId");
    if (supplierId) {
      const [s] = await db.select({ id: t.suppliers.id }).from(t.suppliers).where(and(eq(t.suppliers.id, supplierId), eq(t.suppliers.entityId, entity.id)));
      if (!s) return { error: "That supplier isn't in this entity." };
    }
    const [clash] = await db
      .select({ id: t.products.id })
      .from(t.products)
      .where(and(eq(t.products.entityId, entity.id), sql`lower(${t.products.sku}) = lower(${sku})`, id ? ne(t.products.id, id) : sql`true`));
    if (clash) return { error: `SKU "${sku}" is already used by another item.` };

    const values = {
      sku,
      name,
      type,
      category: formText(fd, "category", 120),
      uom: formText(fd, "uom", 30),
      standardCost: String(cost),
      defaultSupplierId: supplierId,
      trackStock: type === "service" ? false : fd.get("trackStock") === "on",
      safetyStock: String(safety),
      active: fd.get("active") === "on",
    };

    if (id) {
      const [before] = await db.select().from(t.products).where(and(eq(t.products.id, id), eq(t.products.entityId, entity.id)));
      if (!before) return { error: "Item not found." };
      const costChanged = Number(before.standardCost) !== cost;
      await db
        .update(t.products)
        .set({ ...values, ...(costChanged ? { costSetManually: true } : {}) })
        .where(eq(t.products.id, id));
      const changes = diff(before, values);
      if (Object.keys(changes).length)
        await db.insert(t.auditLog).values({ entityId: entity.id, userId: user.id, tableName: "products", recordId: id, action: "update", changes });
      savedId = id;
    } else {
      const [p] = await db
        .insert(t.products)
        .values({ ...values, entityId: entity.id, costSetManually: true })
        .returning({ id: t.products.id });
      await db.insert(t.auditLog).values({ entityId: entity.id, userId: user.id, tableName: "products", recordId: p.id, action: "create", changes: { sku, name } });
      savedId = p.id;
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't save the item." };
  }
  revalidatePath("/items/products");
  revalidatePath("/stock/inventory");
  redirect(`/items/products/${savedId}`);
}
