import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { db, t } from "@/db";

export type ProductFilter = "all" | "product" | "material" | "service";

/** Products with live stock on hand from the ledger (SUM of stock_movements). */
export async function productsWithStock(entityId: string, filter: ProductFilter, stockOnly = false) {
  const p = t.products;
  const onHand = db
    .select({ productId: t.stockMovements.productId, qty: sql<string>`sum(${t.stockMovements.qty})`.as("qty") })
    .from(t.stockMovements)
    .where(eq(t.stockMovements.entityId, entityId))
    .groupBy(t.stockMovements.productId)
    .as("on_hand");

  const conditions = [eq(p.entityId, entityId)];
  if (filter !== "all") conditions.push(eq(p.type, filter));
  if (stockOnly) conditions.push(eq(p.trackStock, true));

  const rows = await db
    .select({
      id: p.id,
      sku: p.sku,
      name: p.name,
      type: p.type,
      category: p.category,
      uom: p.uom,
      standardCost: p.standardCost,
      supplier: t.suppliers.name,
      trackStock: p.trackStock,
      safetyStock: p.safetyStock,
      inStock: onHand.qty,
    })
    .from(p)
    .leftJoin(onHand, eq(onHand.productId, p.id))
    .leftJoin(t.suppliers, eq(t.suppliers.id, p.defaultSupplierId))
    .where(and(...conditions))
    .orderBy(asc(p.name));

  return rows.map((r) => {
    const inStock = Number(r.inStock ?? 0);
    const cost = Number(r.standardCost);
    return {
      ...r,
      standardCost: cost,
      safetyStock: Number(r.safetyStock),
      inStock,
      value: Math.round(inStock * cost * 100) / 100 || 0, // `|| 0` turns -0 into 0
      typeLabel: r.type === "product" ? "Product" : r.type === "material" ? "Material" : "Service",
    };
  });
}
