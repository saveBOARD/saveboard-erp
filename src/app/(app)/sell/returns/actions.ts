"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, t } from "@/db";
import { assertEntityAccess, getEntityContext } from "@/lib/dal";
import { dayStamp } from "@/lib/dates";
import { takeNumber } from "@/lib/numbering";
import { lineAmounts, orderTotals } from "@/lib/orders/calc";
import { returnedByLine, shippedByLine } from "@/lib/orders/shipped";

export type ActionResult = { ok?: true; error?: string; id?: string };
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date");
const optText = z.string().trim().max(2000).nullable().optional().transform((v) => (v ? v : null));

async function context() {
  const { user, entity } = await getEntityContext();
  await assertEntityAccess(user.id, entity.id);
  return { user, entity };
}

function revalidateReturns(id?: string, orderId?: string) {
  revalidatePath("/sell/returns");
  revalidatePath("/sell/invoicing");
  revalidatePath("/stock/inventory");
  revalidatePath("/stock/batches");
  if (id) revalidatePath(`/sell/returns/${id}`);
  if (orderId) revalidatePath(`/sell/orders/${orderId}`);
}

const ReturnSchema = z.object({
  orderId: z.string().uuid(),
  returnDate: isoDate,
  notes: optText,
  lines: z
    .array(
      z.object({
        orderLineId: z.string().uuid(),
        qty: z.number().finite().positive("Quantities must be more than 0"),
        unitPrice: z.number().finite().min(0, "Credit prices can't be negative"),
        restock: z.boolean(),
        reason: optText,
        batchNo: optText,
      }),
    )
    .min(1, "Enter a quantity on at least one line"),
});
export type ReturnInput = z.input<typeof ReturnSchema>;

/** Raises a return (RET-…) against shipped quantities of a sales order. No stock moves until it's received. */
export async function createReturn(input: ReturnInput): Promise<ActionResult> {
  try {
    const { user, entity } = await context();
    const parsed = ReturnSchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const v = parsed.data;
    const [order] = await db.select().from(t.salesOrders).where(and(eq(t.salesOrders.id, v.orderId), eq(t.salesOrders.entityId, entity.id)));
    if (!order) return { error: "Sales order not found." };
    if (order.status === "quote" || order.status === "cancelled") return { error: `A ${order.status} can't have a return.` };
    const ids = v.lines.map((l) => l.orderLineId);
    if (new Set(ids).size !== ids.length) return { error: "Each order line can only appear once." };
    const [orderLines, shipped, returned] = await Promise.all([
      db.select().from(t.orderLines).where(and(eq(t.orderLines.orderId, v.orderId), inArray(t.orderLines.id, ids))),
      shippedByLine([v.orderId]),
      returnedByLine([v.orderId]),
    ]);
    if (orderLines.length !== ids.length) return { error: "One of the lines isn't on this order." };
    const byId = new Map(orderLines.map((l) => [l.id, l]));
    for (const l of v.lines) {
      const ol = byId.get(l.orderLineId)!;
      const can = (shipped.get(ol.id) ?? 0) - (returned.get(ol.id) ?? 0);
      if (l.qty > can + 1e-9) return { error: `Line ${ol.lineNo} (${ol.sku ?? ol.description}): only ${can} shipped and not yet returned.` };
    }
    const lines = v.lines.map((l, i) => {
      const ol = byId.get(l.orderLineId)!;
      const taxRate = Number(ol.taxRate);
      const a = lineAmounts({ qty: l.qty, unitPrice: l.unitPrice, discountPct: 0, taxRate });
      return {
        orderLineId: ol.id,
        lineNo: i + 1,
        productId: ol.productId,
        sku: ol.sku,
        description: ol.description,
        qty: String(l.qty),
        unitPrice: String(l.unitPrice),
        taxRate: String(taxRate),
        lineSubtotal: String(a.subtotal),
        lineTax: String(a.tax),
        restock: l.restock && !!ol.productId,
        reason: l.reason,
        batchNo: l.batchNo,
      };
    });
    const totals = orderTotals(v.lines.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice, discountPct: 0, taxRate: Number(byId.get(l.orderLineId)!.taxRate) })));
    const id = await db.transaction(async (tx) => {
      const number = await takeNumber(tx, entity.id, "RET");
      const [r] = await tx
        .insert(t.salesReturns)
        .values({
          entityId: entity.id,
          number,
          orderId: order.id,
          customerId: order.customerId,
          returnDate: v.returnDate,
          notes: v.notes,
          currency: order.currency,
          subtotal: String(totals.subtotal),
          tax: String(totals.tax),
          total: String(totals.total),
          createdBy: user.id,
        })
        .returning({ id: t.salesReturns.id });
      await tx.insert(t.returnLines).values(lines.map((l) => ({ ...l, returnId: r.id })));
      await tx.insert(t.auditLog).values({
        entityId: entity.id,
        userId: user.id,
        tableName: "sales_returns",
        recordId: r.id,
        action: "create",
        changes: { number, order: order.number, lines: lines.length, total: totals.total },
      });
      return r.id;
    });
    revalidateReturns(id, order.id);
    return { ok: true, id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't create the return." };
  }
}

async function loadReturn(id: string) {
  const { user, entity } = await context();
  const [r] = await db.select().from(t.salesReturns).where(and(eq(t.salesReturns.id, z.string().uuid().parse(id)), eq(t.salesReturns.entityId, entity.id)));
  if (!r) throw new Error("Return not found.");
  return { user, entity, r };
}

/** Goods are back: restock lines go into stock (at standard cost, with their batch). */
export async function receiveReturn(input: { id: string; receivedOn: string }): Promise<ActionResult> {
  try {
    const receivedOn = isoDate.parse(input.receivedOn);
    const { user, entity, r } = await loadReturn(input.id);
    if (r.status !== "open") return { error: `${r.number} is already ${r.status}.` };
    const lines = await db
      .select({ l: t.returnLines, trackStock: t.products.trackStock, cost: t.products.standardCost })
      .from(t.returnLines)
      .leftJoin(t.products, eq(t.products.id, t.returnLines.productId))
      .where(eq(t.returnLines.returnId, r.id));
    const moves = lines
      .filter(({ l, trackStock }) => l.restock && l.productId && trackStock)
      .map(({ l, cost }) => ({
        entityId: entity.id,
        productId: l.productId!,
        kind: "return" as const,
        qty: l.qty,
        unitCost: cost,
        batchNo: l.batchNo,
        refType: "sales_return",
        refId: r.id,
        refNumber: r.number,
        occurredAt: dayStamp(receivedOn),
        createdBy: user.id,
        note: l.reason ? `Returned: ${l.reason}` : "Returned by customer",
      }));
    await db.transaction(async (tx) => {
      if (moves.length) await tx.insert(t.stockMovements).values(moves);
      await tx.update(t.salesReturns).set({ status: "received", receivedOn, receivedBy: user.id }).where(eq(t.salesReturns.id, r.id));
      await tx.insert(t.auditLog).values({
        entityId: entity.id,
        userId: user.id,
        tableName: "sales_returns",
        recordId: r.id,
        action: "receive",
        changes: { number: r.number, receivedOn, restocked: moves.length },
      });
    });
    revalidateReturns(r.id, r.orderId);
    return { ok: true, id: r.id };
  } catch (e) {
    return { error: e instanceof z.ZodError ? e.issues[0].message : e instanceof Error ? e.message : "Couldn't receive the return." };
  }
}

/** Takes restocked goods back out (opposite movements) and returns the return to Open. */
export async function undoReceive(id: string): Promise<ActionResult> {
  try {
    const { user, entity, r } = await loadReturn(id);
    if (r.status !== "received") return { error: "Only a received return can be undone." };
    await db.transaction(async (tx) => {
      const all = await tx
        .select()
        .from(t.stockMovements)
        .where(and(eq(t.stockMovements.refId, r.id), eq(t.stockMovements.refType, "sales_return")));
      // Reverse only what's still standing, so receive -> undo -> receive -> undo stays correct.
      const net = new Map<string, { m: (typeof all)[number]; qty: number }>();
      for (const m of all) {
        const key = `${m.productId}|${m.batchNo ?? ""}`;
        const cur = net.get(key);
        net.set(key, { m: cur?.m ?? m, qty: (cur?.qty ?? 0) + Number(m.qty) });
      }
      const moves = [...net.values()].filter((x) => Math.abs(x.qty) > 1e-9);
      if (moves.length)
        await tx.insert(t.stockMovements).values(
          moves.map(({ m, qty }) => ({
            entityId: m.entityId,
            productId: m.productId,
            kind: "return" as const,
            qty: String(-qty),
            unitCost: m.unitCost,
            batchNo: m.batchNo,
            refType: "sales_return",
            refId: r.id,
            refNumber: `${r.number} undone`,
            createdBy: user.id,
            note: `Receipt of ${r.number} undone`,
          })),
        );
      await tx.update(t.salesReturns).set({ status: "open", receivedOn: null, receivedBy: null }).where(eq(t.salesReturns.id, r.id));
      await tx.insert(t.auditLog).values({ entityId: entity.id, userId: user.id, tableName: "sales_returns", recordId: r.id, action: "undo_receive", changes: { number: r.number } });
    });
    revalidateReturns(r.id, r.orderId);
    return { ok: true, id: r.id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't undo." };
  }
}

/** Cancels an open return that hasn't been credited (e.g. the customer kept the goods). */
export async function cancelReturn(id: string): Promise<ActionResult> {
  try {
    const { user, entity, r } = await loadReturn(id);
    if (r.status !== "open") return { error: r.status === "received" ? "Undo the receipt first." : `${r.number} is already cancelled.` };
    if (r.creditedOn) return { error: `${r.number} has been credited in Xero. Undo the credit on the Invoicing page first.` };
    await db.transaction(async (tx) => {
      await tx.update(t.salesReturns).set({ status: "cancelled" }).where(eq(t.salesReturns.id, r.id));
      await tx.insert(t.auditLog).values({ entityId: entity.id, userId: user.id, tableName: "sales_returns", recordId: r.id, action: "cancel", changes: { number: r.number } });
    });
    revalidateReturns(r.id, r.orderId);
    return { ok: true, id: r.id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't cancel." };
  }
}
