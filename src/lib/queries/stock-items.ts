import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db, t } from "@/db";
import { stockPosition } from "./availability";

/** Active stock-tracked items with cost and current on-hand, for adjustments and stocktakes. */
export async function stockItems(entityId: string) {
  const [items, position] = await Promise.all([
    db
      .select({ id: t.products.id, sku: t.products.sku, name: t.products.name, uom: t.products.uom, cost: t.products.standardCost, category: t.products.category, type: t.products.type })
      .from(t.products)
      .where(and(eq(t.products.entityId, entityId), eq(t.products.trackStock, true), eq(t.products.active, true)))
      .orderBy(asc(t.products.name)),
    stockPosition(entityId),
  ]);
  return items.map((i) => ({ ...i, cost: Number(i.cost), onHand: position.onHand.get(i.id) ?? 0 }));
}

export const entityToday = (entityId: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: entityId === "AUS" ? "Australia/Sydney" : "Pacific/Auckland" }).format(new Date());
