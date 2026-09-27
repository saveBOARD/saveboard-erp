import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import { db, t } from "@/db";
import type { PriceListData } from "@/lib/pricing";

/** Active price lists for pickers (default first). */
export function priceListOptions(entityId: string) {
  return db
    .select({ id: t.priceLists.id, name: t.priceLists.name, isDefault: t.priceLists.isDefault })
    .from(t.priceLists)
    .where(and(eq(t.priceLists.entityId, entityId), eq(t.priceLists.active, true)))
    .orderBy(desc(t.priceLists.isDefault), asc(t.priceLists.name));
}

/** The entity's active price lists with their prices (default list first). */
export async function priceListsData(entityId: string): Promise<PriceListData[]> {
  const [lists, items] = await Promise.all([
    db
      .select()
      .from(t.priceLists)
      .where(and(eq(t.priceLists.entityId, entityId), eq(t.priceLists.active, true)))
      .orderBy(desc(t.priceLists.isDefault), asc(t.priceLists.name)),
    db
      .select({ listId: t.priceListItems.priceListId, productId: t.priceListItems.productId, price: t.priceListItems.price })
      .from(t.priceListItems)
      .innerJoin(t.priceLists, eq(t.priceLists.id, t.priceListItems.priceListId))
      .where(and(eq(t.priceLists.entityId, entityId), eq(t.priceLists.active, true))),
  ]);
  return lists.map((l) => ({
    id: l.id,
    name: l.name,
    isDefault: l.isDefault,
    adjustPct: l.adjustPct === null ? null : Number(l.adjustPct),
    prices: Object.fromEntries(items.filter((i) => i.listId === l.id).map((i) => [i.productId, Number(i.price)])),
  }));
}
