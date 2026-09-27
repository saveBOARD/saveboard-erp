import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, t } from "@/db";
import type { ReceiptSummary } from "@/components/receipts-panel";

/** A purchase order with supplier, lines (with unit) and its receipts, scoped to the entity. */
export async function getPO(entityId: string, id: string, timeZone: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db
    .select({ po: t.purchaseOrders, supplier: t.suppliers })
    .from(t.purchaseOrders)
    .innerJoin(t.suppliers, eq(t.suppliers.id, t.purchaseOrders.supplierId))
    .where(and(eq(t.purchaseOrders.id, id), eq(t.purchaseOrders.entityId, entityId)));
  if (!row) return null;
  const reverser = alias(t.users, "reverser");
  const [lines, heads, rlines] = await Promise.all([
    db
      .select({ l: t.poLines, uom: t.products.uom, trackStock: t.products.trackStock })
      .from(t.poLines)
      .leftJoin(t.products, eq(t.products.id, t.poLines.productId))
      .where(eq(t.poLines.poId, id))
      .orderBy(asc(t.poLines.lineNo)),
    db
      .select({ r: t.goodsReceipts, by: t.users.displayName, reversedBy: reverser.displayName })
      .from(t.goodsReceipts)
      .leftJoin(t.users, eq(t.users.id, t.goodsReceipts.createdBy))
      .leftJoin(reverser, eq(reverser.id, t.goodsReceipts.reversedBy))
      .where(eq(t.goodsReceipts.poId, id))
      .orderBy(asc(t.goodsReceipts.seq)),
    db
      .select({ rl: t.goodsReceiptLines, l: t.poLines, uom: t.products.uom })
      .from(t.goodsReceiptLines)
      .innerJoin(t.goodsReceipts, eq(t.goodsReceipts.id, t.goodsReceiptLines.receiptId))
      .innerJoin(t.poLines, eq(t.poLines.id, t.goodsReceiptLines.poLineId))
      .leftJoin(t.products, eq(t.products.id, t.poLines.productId))
      .where(eq(t.goodsReceipts.poId, id))
      .orderBy(asc(t.poLines.lineNo)),
  ]);
  const receipts: ReceiptSummary[] = heads.map(({ r, by, reversedBy }) => ({
    id: r.id,
    ref: `${row.po.number}/${r.seq}`,
    receivedOn: r.receivedOn,
    supplierRef: r.supplierRef,
    notes: r.notes,
    by,
    reversed: r.reversedAt ? `${r.reversedAt.toLocaleString("en-NZ", { timeZone, dateStyle: "medium", timeStyle: "short" })}${reversedBy ? ` by ${reversedBy}` : ""}` : null,
    lines: rlines.filter((x) => x.rl.receiptId === r.id).map((x) => ({ description: x.l.description, sku: x.l.sku, qty: Number(x.rl.qty), uom: x.uom, batchNo: x.rl.batchNo })),
  }));
  return { ...row, lines, receipts };
}
