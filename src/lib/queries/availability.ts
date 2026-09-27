import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { cache } from "react";
import { db, t } from "@/db";
import { shippedByLine } from "@/lib/orders/shipped";

export type Availability = "in_stock" | "not_available" | "not_tracked" | "shipped";

type Demand = {
  kind: "sale" | "mo";
  lineId: string; // order line or MO material line
  parentId: string; // sales order or MO
  productId: string | null;
  trackStock: boolean;
  qty: number;
  priority: number; // 0 = picked sales order (goods already set aside), 1 = everything else
  date: string; // order date / production deadline
  ref: string;
};

/**
 * Stock position for an entity, Katana style:
 *  - on hand   = SUM(stock_movements)
 *  - committed = still-to-ship qty on open/picked sales orders + planned materials on open manufacturing orders
 *  - demand is allocated from on-hand stock: picked sales orders first, then everything by date
 *    (order date for sales, production deadline for MOs); a line is "in_stock" when fully covered.
 *  - expectedFromProduction = planned output of open MOs (joins PO "expected" in the Inventory screen)
 * Lines without a product, or items with Track stock = No (freight, fees), are "not_tracked".
 */
export const stockPosition = cache(async (entityId: string) => {
  const [onHandRows, saleLines, moLines, moOutputs] = await Promise.all([
    db
      .select({ productId: t.stockMovements.productId, qty: sql<string>`sum(${t.stockMovements.qty})` })
      .from(t.stockMovements)
      .where(eq(t.stockMovements.entityId, entityId))
      .groupBy(t.stockMovements.productId),
    db
      .select({
        lineId: t.orderLines.id,
        orderId: t.orderLines.orderId,
        productId: t.orderLines.productId,
        trackStock: t.products.trackStock,
        qty: t.orderLines.qty,
        status: t.salesOrders.status,
        date: t.salesOrders.orderDate,
        ref: t.salesOrders.number,
        lineNo: t.orderLines.lineNo,
      })
      .from(t.orderLines)
      .innerJoin(t.salesOrders, eq(t.salesOrders.id, t.orderLines.orderId))
      .leftJoin(t.products, eq(t.products.id, t.orderLines.productId))
      .where(and(eq(t.salesOrders.entityId, entityId), inArray(t.salesOrders.status, ["open", "picked"]))),
    db
      .select({
        lineId: t.moMaterials.id,
        moId: t.moMaterials.moId,
        productId: t.moMaterials.productId,
        trackStock: t.products.trackStock,
        qty: t.moMaterials.plannedQty,
        date: sql<string>`coalesce(${t.manufacturingOrders.productionDeadline}, ${t.manufacturingOrders.createdAt}::date)::text`,
        ref: t.manufacturingOrders.number,
        sortOrder: t.moMaterials.sortOrder,
      })
      .from(t.moMaterials)
      .innerJoin(t.manufacturingOrders, eq(t.manufacturingOrders.id, t.moMaterials.moId))
      .innerJoin(t.products, eq(t.products.id, t.moMaterials.productId))
      .where(and(eq(t.manufacturingOrders.entityId, entityId), inArray(t.manufacturingOrders.status, ["not_started", "in_progress"]))),
    db
      .select({ productId: t.manufacturingOrders.productId, qty: sql<string>`sum(${t.manufacturingOrders.plannedQty})` })
      .from(t.manufacturingOrders)
      .where(and(eq(t.manufacturingOrders.entityId, entityId), inArray(t.manufacturingOrders.status, ["not_started", "in_progress"])))
      .groupBy(t.manufacturingOrders.productId),
  ]);
  const onHand = new Map(onHandRows.map((r) => [r.productId, Number(r.qty)]));
  const expectedFromProduction = new Map(moOutputs.map((r) => [r.productId, Number(r.qty)]));
  const shipped = await shippedByLine([...new Set(saleLines.map((l) => l.orderId))]);

  const lineAvailability = new Map<string, Availability>();
  const demands: Demand[] = [];
  for (const l of saleLines) {
    const q = Number(l.qty) - (shipped.get(l.lineId) ?? 0); // only what's still to ship is committed
    if (q <= 1e-9) {
      lineAvailability.set(l.lineId, "shipped");
      continue;
    }
    demands.push({ kind: "sale", lineId: l.lineId, parentId: l.orderId, productId: l.productId, trackStock: !!l.trackStock, qty: q, priority: l.status === "picked" ? 0 : 1, date: l.date, ref: `${l.ref}#${String(l.lineNo).padStart(4, "0")}` });
  }
  for (const m of moLines) {
    demands.push({ kind: "mo", lineId: m.lineId, parentId: m.moId, productId: m.productId, trackStock: !!m.trackStock, qty: Number(m.qty), priority: 1, date: m.date, ref: `${m.ref}#${String(m.sortOrder).padStart(4, "0")}` });
  }
  demands.sort((a, b) => a.priority - b.priority || a.date.localeCompare(b.date) || a.ref.localeCompare(b.ref));

  const remaining = new Map(onHand);
  const committed = new Map<string, number>();
  const orderAvailability = new Map<string, Availability>();
  const moAvailability = new Map<string, Availability>();

  for (const d of demands) {
    let a: Availability = "not_tracked";
    if (d.productId && d.trackStock) {
      committed.set(d.productId, (committed.get(d.productId) ?? 0) + d.qty);
      const left = remaining.get(d.productId) ?? 0;
      a = d.qty <= left + 1e-9 ? "in_stock" : "not_available";
      remaining.set(d.productId, left - d.qty);
    }
    lineAvailability.set(d.lineId, a);
    const target = d.kind === "sale" ? orderAvailability : moAvailability;
    const prev = target.get(d.parentId);
    // "not available" if any tracked line is short; "in stock" if all tracked lines are covered
    if (a === "not_available" || prev === "not_available") target.set(d.parentId, "not_available");
    else if (a === "in_stock" || prev === "in_stock") target.set(d.parentId, "in_stock");
    else target.set(d.parentId, "not_tracked");
  }
  return { onHand, committed, lineAvailability, orderAvailability, moAvailability, expectedFromProduction };
});

export const AVAILABILITY_LABEL: Record<Availability, string> = {
  in_stock: "In stock",
  not_available: "Not available",
  not_tracked: "—",
  shipped: "Shipped",
};
