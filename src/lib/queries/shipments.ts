import "server-only";
import { asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, t } from "@/db";
import type { ShipmentSummary } from "@/components/shipments-panel";

/** An order's shipments with their lines (quantity, unit, batch), oldest first. */
export async function orderShipments(orderId: string, orderNumber: string, timeZone: string): Promise<ShipmentSummary[]> {
  const reverser = alias(t.users, "reverser");
  const [heads, lines] = await Promise.all([
    db
      .select({ s: t.shipments, by: t.users.displayName, reversedBy: reverser.displayName })
      .from(t.shipments)
      .leftJoin(t.users, eq(t.users.id, t.shipments.createdBy))
      .leftJoin(reverser, eq(reverser.id, t.shipments.reversedBy))
      .where(eq(t.shipments.orderId, orderId))
      .orderBy(asc(t.shipments.seq)),
    db
      .select({ sl: t.shipmentLines, l: t.orderLines, uom: t.products.uom })
      .from(t.shipmentLines)
      .innerJoin(t.shipments, eq(t.shipments.id, t.shipmentLines.shipmentId))
      .innerJoin(t.orderLines, eq(t.orderLines.id, t.shipmentLines.orderLineId))
      .leftJoin(t.products, eq(t.products.id, t.orderLines.productId))
      .where(eq(t.shipments.orderId, orderId))
      .orderBy(asc(t.orderLines.lineNo)),
  ]);
  return heads.map(({ s, by, reversedBy }) => ({
    id: s.id,
    ref: `${orderNumber}/${s.seq}`,
    seq: s.seq,
    shippedOn: s.shippedOn,
    carrier: s.carrier,
    consignmentNo: s.consignmentNo,
    notes: s.notes,
    by,
    reversed: s.reversedAt
      ? `${s.reversedAt.toLocaleString("en-NZ", { timeZone, dateStyle: "medium", timeStyle: "short" })}${reversedBy ? ` by ${reversedBy}` : ""}`
      : null,
    lines: lines
      .filter((x) => x.sl.shipmentId === s.id)
      .map((x) => ({ description: x.l.description, sku: x.l.sku, qty: Number(x.sl.qty), uom: x.uom, batchNo: x.sl.batchNo })),
  }));
}
