import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { cache } from "react";
import { db, t } from "@/db";

export type Availability = "in_stock" | "not_available" | "not_tracked";

/**
 * Stock position for an entity, Katana style:
 *  - on hand   = SUM(stock_movements)
 *  - committed = qty on open + picked order lines (not yet shipped)
 *  - each committed line is allocated from on-hand stock: picked orders first, then open orders oldest first;
 *    a line is "in_stock" if its full qty is covered, otherwise "not_available".
 * Lines without a product, or for products with Track stock = No (freight, fees), are "not_tracked".
 */
export const stockPosition = cache(async (entityId: string) => {
  const onHandRows = await db
    .select({ productId: t.stockMovements.productId, qty: sql<string>`sum(${t.stockMovements.qty})` })
    .from(t.stockMovements)
    .where(eq(t.stockMovements.entityId, entityId))
    .groupBy(t.stockMovements.productId);
  const onHand = new Map(onHandRows.map((r) => [r.productId, Number(r.qty)]));

  const lines = await db
    .select({
      lineId: t.orderLines.id,
      orderId: t.orderLines.orderId,
      productId: t.orderLines.productId,
      trackStock: t.products.trackStock,
      qty: t.orderLines.qty,
      status: t.salesOrders.status,
    })
    .from(t.orderLines)
    .innerJoin(t.salesOrders, eq(t.salesOrders.id, t.orderLines.orderId))
    .leftJoin(t.products, eq(t.products.id, t.orderLines.productId))
    .where(and(eq(t.salesOrders.entityId, entityId), inArray(t.salesOrders.status, ["open", "picked"])))
    .orderBy(
      sql`case when ${t.salesOrders.status} = 'picked' then 0 else 1 end`,
      asc(t.salesOrders.orderDate),
      asc(t.salesOrders.number),
      asc(t.orderLines.lineNo),
    );

  const remaining = new Map(onHand);
  const committed = new Map<string, number>();
  const lineAvailability = new Map<string, Availability>();
  const orderAvailability = new Map<string, Availability>();

  for (const l of lines) {
    let a: Availability = "not_tracked";
    if (l.productId && l.trackStock) {
      const q = Number(l.qty);
      committed.set(l.productId, (committed.get(l.productId) ?? 0) + q);
      const left = remaining.get(l.productId) ?? 0;
      a = q <= left + 1e-9 ? "in_stock" : "not_available";
      remaining.set(l.productId, left - q);
    }
    lineAvailability.set(l.lineId, a);
    const prev = orderAvailability.get(l.orderId);
    // an order is "not available" if any tracked line is short; "in stock" if all tracked lines are covered
    if (a === "not_available" || prev === "not_available") orderAvailability.set(l.orderId, "not_available");
    else if (a === "in_stock" || prev === "in_stock") orderAvailability.set(l.orderId, "in_stock");
    else orderAvailability.set(l.orderId, "not_tracked");
  }
  return { onHand, committed, lineAvailability, orderAvailability };
});

export const AVAILABILITY_LABEL: Record<Availability, string> = {
  in_stock: "In stock",
  not_available: "Not available",
  not_tracked: "—",
};
