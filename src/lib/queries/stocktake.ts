import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db, t } from "@/db";

/** A stocktake with its lines (item details, expected, counted), scoped to the entity. */
export async function getStocktake(entityId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db
    .select({ st: t.stocktakes, by: t.users.displayName, adjustment: t.stockAdjustments.number })
    .from(t.stocktakes)
    .leftJoin(t.users, eq(t.users.id, t.stocktakes.createdBy))
    .leftJoin(t.stockAdjustments, eq(t.stockAdjustments.id, t.stocktakes.adjustmentId))
    .where(and(eq(t.stocktakes.id, id), eq(t.stocktakes.entityId, entityId)));
  if (!row) return null;
  const lines = await db
    .select({ l: t.stocktakeLines, p: t.products, countedBy: t.users.displayName })
    .from(t.stocktakeLines)
    .innerJoin(t.products, eq(t.products.id, t.stocktakeLines.productId))
    .leftJoin(t.users, eq(t.users.id, t.stocktakeLines.countedBy))
    .where(eq(t.stocktakeLines.stocktakeId, id))
    .orderBy(asc(t.products.category), asc(t.products.name));
  return {
    ...row,
    lines: lines.map(({ l, p, countedBy }) => ({
      id: l.id,
      sku: p.sku,
      name: p.name,
      category: p.category,
      uom: p.uom,
      cost: Number(p.standardCost),
      expected: Number(l.expectedQty),
      counted: l.countedQty === null ? null : Number(l.countedQty),
      note: l.note,
      countedBy,
    })),
  };
}
