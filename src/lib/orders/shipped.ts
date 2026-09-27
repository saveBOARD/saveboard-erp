import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, t } from "@/db";

/** Quantity shipped per order line (reversed shipments excluded). */
export async function shippedByLine(orderIds: string[]) {
  if (!orderIds.length) return new Map<string, number>();
  const rows = await db
    .select({ lineId: t.shipmentLines.orderLineId, qty: sql<string>`sum(${t.shipmentLines.qty})` })
    .from(t.shipmentLines)
    .innerJoin(t.shipments, eq(t.shipments.id, t.shipmentLines.shipmentId))
    .where(and(inArray(t.shipments.orderId, orderIds), isNull(t.shipments.reversedAt)))
    .groupBy(t.shipmentLines.orderLineId);
  return new Map(rows.map((r) => [r.lineId, Number(r.qty)]));
}

/** Quantity returned (or being returned) per order line: cancelled returns excluded. */
export async function returnedByLine(orderIds: string[]) {
  if (!orderIds.length) return new Map<string, number>();
  const rows = await db
    .select({ lineId: t.returnLines.orderLineId, qty: sql<string>`sum(${t.returnLines.qty})` })
    .from(t.returnLines)
    .innerJoin(t.salesReturns, eq(t.salesReturns.id, t.returnLines.returnId))
    .where(and(inArray(t.salesReturns.orderId, orderIds), sql`${t.salesReturns.status} <> 'cancelled'`))
    .groupBy(t.returnLines.orderLineId);
  return new Map(rows.map((r) => [r.lineId, Number(r.qty)]));
}

export type DeliveryState = "not_shipped" | "partial" | "shipped";

/** Katana's Delivery column: nothing sent / some sent / everything sent. */
export function deliveryState(lines: { id: string; qty: number }[], shipped: Map<string, number>): DeliveryState {
  const sent = lines.map((l) => shipped.get(l.id) ?? 0);
  if (sent.every((s) => s <= 0)) return "not_shipped";
  return lines.every((l, i) => sent[i] >= l.qty - 1e-9) ? "shipped" : "partial";
}

export const DELIVERY_LABEL: Record<DeliveryState, string> = {
  not_shipped: "Not shipped",
  partial: "Partially shipped",
  shipped: "Shipped",
};
