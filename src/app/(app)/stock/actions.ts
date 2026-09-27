"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, t } from "@/db";
import type { Db } from "@/db/client";
import { assertEntityAccess, getEntityContext } from "@/lib/dal";
import { dayStamp } from "@/lib/dates";
import { takeNumber } from "@/lib/numbering";

export type ActionResult = { ok?: true; error?: string; id?: string };
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date");
const optText = z.string().trim().max(1000).nullable().optional().transform((v) => (v ? v : null));

async function context() {
  const { user, entity } = await getEntityContext();
  await assertEntityAccess(user.id, entity.id);
  return { user, entity };
}

function revalidateStock() {
  revalidatePath("/stock/inventory");
  revalidatePath("/stock/adjustments");
  revalidatePath("/stock/stocktakes");
  revalidatePath("/sell/orders");
}

/**
 * Writes an adjustment (header, lines, stock movements) inside the caller's transaction.
 * Unit cost = the product's standard cost now. Used by manual adjustments, reversals and stocktakes.
 */
async function postAdjustment(
  tx: Tx,
  entityId: string,
  userId: string,
  header: { adjustedOn: string; reason: string; notes: string | null; stocktakeId?: string; reversesId?: string },
  lines: { productId: string; qty: number; batchNo: string | null; note: string | null }[],
) {
  const productIds = [...new Set(lines.map((l) => l.productId))];
  const prods = await tx
    .select({ id: t.products.id, cost: t.products.standardCost, trackStock: t.products.trackStock, sku: t.products.sku })
    .from(t.products)
    .where(and(eq(t.products.entityId, entityId), inArray(t.products.id, productIds)));
  if (prods.length !== productIds.length) throw new Error("One of the items isn't in this entity's product list.");
  const untracked = prods.find((p) => !p.trackStock);
  if (untracked) throw new Error(`${untracked.sku} doesn't track stock, so it can't be adjusted.`);
  const cost = new Map(prods.map((p) => [p.id, p.cost]));

  const number = await takeNumber(tx, entityId, "SA");
  const [adj] = await tx
    .insert(t.stockAdjustments)
    .values({ entityId, number, ...header, createdBy: userId })
    .returning({ id: t.stockAdjustments.id });
  await tx.insert(t.stockAdjustmentLines).values(
    lines.map((l) => ({ adjustmentId: adj.id, productId: l.productId, qty: String(l.qty), unitCost: cost.get(l.productId)!, batchNo: l.batchNo, note: l.note })),
  );
  await tx.insert(t.stockMovements).values(
    lines.map((l) => ({
      entityId,
      productId: l.productId,
      kind: "adjustment" as const,
      qty: String(l.qty),
      unitCost: cost.get(l.productId)!,
      batchNo: l.batchNo,
      refType: "stock_adjustment",
      refId: adj.id,
      refNumber: number,
      occurredAt: dayStamp(header.adjustedOn),
      createdBy: userId,
      note: [header.reason, l.note].filter(Boolean).join(" — "),
    })),
  );
  await tx.insert(t.auditLog).values({
    entityId,
    userId,
    tableName: "stock_adjustments",
    recordId: adj.id,
    action: "create",
    changes: { number, reason: header.reason, lines: lines.length },
  });
  return { id: adj.id, number };
}

const AdjustmentSchema = z.object({
  adjustedOn: isoDate,
  reason: z.string().trim().min(1, "Choose or type a reason").max(200),
  notes: optText,
  lines: z
    .array(
      z.object({
        productId: z.string().uuid({ message: "Pick each item from the list" }),
        qty: z.number().finite().refine((n) => n !== 0, "Quantities can't be 0"),
        batchNo: optText,
        note: optText,
      }),
    )
    .min(1, "Add at least one line"),
});
export type AdjustmentInput = z.input<typeof AdjustmentSchema>;

/** Manual stock adjustment: posts immediately. */
export async function createAdjustment(input: AdjustmentInput): Promise<ActionResult> {
  try {
    const { user, entity } = await context();
    const parsed = AdjustmentSchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const v = parsed.data;
    const res = await db.transaction((tx) => postAdjustment(tx, entity.id, user.id, { adjustedOn: v.adjustedOn, reason: v.reason, notes: v.notes }, v.lines));
    revalidateStock();
    return { ok: true, id: res.id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't save the adjustment." };
  }
}

/** Undo an adjustment by posting an opposite one (nothing is deleted). */
export async function reverseAdjustment(id: string): Promise<ActionResult> {
  try {
    const { user, entity } = await context();
    const [adj] = await db.select().from(t.stockAdjustments).where(and(eq(t.stockAdjustments.id, id), eq(t.stockAdjustments.entityId, entity.id)));
    if (!adj) return { error: "Adjustment not found." };
    if (adj.reversesId) return { error: "This is already a reversal. Make a new adjustment instead." };
    const [already] = await db.select({ number: t.stockAdjustments.number }).from(t.stockAdjustments).where(eq(t.stockAdjustments.reversesId, id));
    if (already) return { error: `Already reversed by ${already.number}.` };
    const lines = await db.select().from(t.stockAdjustmentLines).where(eq(t.stockAdjustmentLines.adjustmentId, id));
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: entity.id === "AUS" ? "Australia/Sydney" : "Pacific/Auckland" }).format(new Date());
    const res = await db.transaction((tx) =>
      postAdjustment(
        tx,
        entity.id,
        user.id,
        { adjustedOn: today, reason: `Reversal of ${adj.number}`, notes: null, reversesId: id },
        lines.map((l) => ({ productId: l.productId, qty: -Number(l.qty), batchNo: l.batchNo, note: l.note })),
      ),
    );
    revalidateStock();
    return { ok: true, id: res.id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't reverse the adjustment." };
  }
}

/** Start a stocktake: freezes each item's expected (on-hand) quantity now. */
export async function createStocktake(input: { scope: string; category: string | null; reason: string; notes: string | null }): Promise<ActionResult> {
  try {
    const { user, entity } = await context();
    const reason = input.reason.trim();
    if (!reason) return { error: "Give the stocktake a reason, e.g. 'Month-end count October'." };
    const p = t.products;
    const where = [eq(p.entityId, entity.id), eq(p.trackStock, true), eq(p.active, true)];
    let scopeLabel = "All stock items";
    if (input.scope === "product" || input.scope === "material") {
      where.push(eq(p.type, input.scope));
      scopeLabel = input.scope === "product" ? "Products" : "Materials";
    } else if (input.scope === "category") {
      if (!input.category) return { error: "Choose a category." };
      where.push(eq(p.category, input.category));
      scopeLabel = `Category: ${input.category}`;
    }
    const items = await db
      // table name spelt out: inside the subquery a bare "id" would mean stock_movements.id
      .select({ id: p.id, onHand: sql<string>`coalesce((select sum(m.qty) from stock_movements m where m.product_id = "products"."id"), 0)` })
      .from(p)
      .where(and(...where));
    if (!items.length) return { error: "No stock items match that selection." };

    const id = await db.transaction(async (tx) => {
      const number = await takeNumber(tx, entity.id, "STK");
      const [st] = await tx
        .insert(t.stocktakes)
        .values({ entityId: entity.id, number, reason, scope: scopeLabel, notes: input.notes?.trim() || null, createdBy: user.id })
        .returning({ id: t.stocktakes.id });
      await tx.insert(t.stocktakeLines).values(items.map((i) => ({ stocktakeId: st.id, productId: i.id, expectedQty: String(Number(i.onHand)) })));
      await tx.insert(t.auditLog).values({ entityId: entity.id, userId: user.id, tableName: "stocktakes", recordId: st.id, action: "create", changes: { number, scope: scopeLabel, items: items.length } });
      return st.id;
    });
    revalidateStock();
    return { ok: true, id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't start the stocktake." };
  }
}

async function loadCounting(id: string) {
  const { user, entity } = await context();
  const [st] = await db.select().from(t.stocktakes).where(and(eq(t.stocktakes.id, id), eq(t.stocktakes.entityId, entity.id)));
  if (!st) throw new Error("Stocktake not found.");
  if (st.status !== "counting") throw new Error(`This stocktake is ${st.status}.`);
  return { user, entity, st };
}

/** Save counted quantities (null = not counted). Can be called many times while counting. */
export async function saveCounts(id: string, counts: { lineId: string; counted: number | null; note: string | null }[]): Promise<ActionResult> {
  try {
    const { user } = await loadCounting(id);
    const existing = await db.select().from(t.stocktakeLines).where(eq(t.stocktakeLines.stocktakeId, id));
    const byId = new Map(existing.map((l) => [l.id, l]));
    await db.transaction(async (tx) => {
      for (const c of counts) {
        const line = byId.get(c.lineId);
        if (!line) throw new Error("A line doesn't belong to this stocktake.");
        if (c.counted !== null && (!Number.isFinite(c.counted) || c.counted < 0)) throw new Error("Counts must be 0 or more.");
        const newCount = c.counted === null ? null : String(c.counted);
        const changed = (line.countedQty === null ? null : Number(line.countedQty)) !== c.counted || (line.note ?? null) !== (c.note || null);
        if (!changed) continue;
        await tx
          .update(t.stocktakeLines)
          .set({ countedQty: newCount, note: c.note || null, countedBy: c.counted === null ? null : user.id, countedAt: c.counted === null ? null : new Date() })
          .where(eq(t.stocktakeLines.id, c.lineId));
      }
    });
    revalidatePath(`/stock/stocktakes/${id}`);
    return { ok: true, id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't save the counts." };
  }
}

/** Finish: every counted difference (counted − expected) is posted as one stock adjustment linked to the stocktake. */
export async function completeStocktake(id: string): Promise<ActionResult> {
  try {
    const { user, entity, st } = await loadCounting(id);
    const lines = await db.select().from(t.stocktakeLines).where(eq(t.stocktakeLines.stocktakeId, id));
    const counted = lines.filter((l) => l.countedQty !== null);
    if (!counted.length) return { error: "Nothing has been counted yet." };
    const diffs = counted
      .map((l) => ({ productId: l.productId, qty: Math.round((Number(l.countedQty) - Number(l.expectedQty)) * 10000) / 10000, batchNo: null, note: l.note }))
      .filter((d) => d.qty !== 0);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: entity.id === "AUS" ? "Australia/Sydney" : "Pacific/Auckland" }).format(new Date());
    await db.transaction(async (tx) => {
      let adjustmentId: string | null = null;
      if (diffs.length) {
        const adj = await postAdjustment(tx, entity.id, user.id, { adjustedOn: today, reason: `Stocktake ${st.number} — ${st.reason}`, notes: null, stocktakeId: id }, diffs);
        adjustmentId = adj.id;
      }
      await tx.update(t.stocktakes).set({ status: "completed", adjustmentId, completedAt: new Date(), completedBy: user.id }).where(eq(t.stocktakes.id, id));
      await tx.insert(t.auditLog).values({
        entityId: entity.id,
        userId: user.id,
        tableName: "stocktakes",
        recordId: id,
        action: "complete",
        changes: { number: st.number, counted: counted.length, notCounted: lines.length - counted.length, differences: diffs.length },
      });
    });
    revalidateStock();
    revalidatePath(`/stock/stocktakes/${id}`);
    return { ok: true, id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't complete the stocktake." };
  }
}

export async function cancelStocktake(id: string): Promise<ActionResult> {
  try {
    const { user, entity, st } = await loadCounting(id);
    await db.update(t.stocktakes).set({ status: "cancelled" }).where(eq(t.stocktakes.id, id));
    await db.insert(t.auditLog).values({ entityId: entity.id, userId: user.id, tableName: "stocktakes", recordId: id, action: "cancel", changes: { number: st.number } });
    revalidateStock();
    return { ok: true, id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't cancel the stocktake." };
  }
}
