import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, t } from "@/db";

/** Quantity received per PO line (reversed receipts excluded). */
export async function receivedByLine(poIds: string[]) {
  if (!poIds.length) return new Map<string, number>();
  const rows = await db
    .select({ lineId: t.goodsReceiptLines.poLineId, qty: sql<string>`sum(${t.goodsReceiptLines.qty})` })
    .from(t.goodsReceiptLines)
    .innerJoin(t.goodsReceipts, eq(t.goodsReceipts.id, t.goodsReceiptLines.receiptId))
    .where(and(inArray(t.goodsReceipts.poId, poIds), isNull(t.goodsReceipts.reversedAt)))
    .groupBy(t.goodsReceiptLines.poLineId);
  return new Map(rows.map((r) => [r.lineId, Number(r.qty)]));
}

export type ReceiveState = "not_received" | "partial" | "received";
export function receiveState(lines: { id: string; qty: number }[], received: Map<string, number>): ReceiveState {
  const got = lines.map((l) => received.get(l.id) ?? 0);
  if (got.every((g) => g <= 0)) return "not_received";
  return lines.every((l, i) => got[i] >= l.qty - 1e-9) ? "received" : "partial";
}
/** Katana's PO tabs: Draft / Open / Done. */
export const PO_STATUS_LABEL: Record<string, string> = { draft: "Draft", open: "Open", received: "Done", cancelled: "Cancelled" };
export const RECEIVE_LABEL: Record<ReceiveState, string> = { not_received: "Not received", partial: "Partially received", received: "Received" };

/** Stock on order and not yet received, per product (open POs only) — Katana's "Expected". */
export async function expectedByProduct(entityId: string) {
  const lines = await db
    .select({ id: t.poLines.id, productId: t.poLines.productId, qty: t.poLines.qty, poId: t.poLines.poId })
    .from(t.poLines)
    .innerJoin(t.purchaseOrders, eq(t.purchaseOrders.id, t.poLines.poId))
    .where(and(eq(t.purchaseOrders.entityId, entityId), eq(t.purchaseOrders.status, "open")));
  const received = await receivedByLine([...new Set(lines.map((l) => l.poId))]);
  const expected = new Map<string, number>();
  for (const l of lines) {
    if (!l.productId) continue;
    const left = Number(l.qty) - (received.get(l.id) ?? 0);
    if (left > 1e-9) expected.set(l.productId, (expected.get(l.productId) ?? 0) + left);
  }
  return expected;
}
