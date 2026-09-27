import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db, t } from "@/db";

export const MO_STATUS_LABEL: Record<string, string> = { not_started: "Not started", in_progress: "In progress", done: "Done", cancelled: "Cancelled" };

/** A manufacturing order with its product, materials, operations and linked sales order (entity-checked). */
export async function getMO(entityId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db
    .select({ mo: t.manufacturingOrders, product: t.products })
    .from(t.manufacturingOrders)
    .innerJoin(t.products, eq(t.products.id, t.manufacturingOrders.productId))
    .where(and(eq(t.manufacturingOrders.id, id), eq(t.manufacturingOrders.entityId, entityId)));
  if (!row) return null;
  const [materials, operations, so] = await Promise.all([
    db
      .select({ m: t.moMaterials, sku: t.products.sku, name: t.products.name, uom: t.products.uom, trackStock: t.products.trackStock, standardCost: t.products.standardCost })
      .from(t.moMaterials)
      .innerJoin(t.products, eq(t.products.id, t.moMaterials.productId))
      .where(eq(t.moMaterials.moId, id))
      .orderBy(asc(t.moMaterials.sortOrder)),
    db.select().from(t.moOperations).where(eq(t.moOperations.moId, id)).orderBy(asc(t.moOperations.sortOrder)),
    row.mo.salesOrderId
      ? db
          .select({ id: t.salesOrders.id, number: t.salesOrders.number, title: t.salesOrders.title, customer: t.customers.name })
          .from(t.salesOrders)
          .innerJoin(t.customers, eq(t.customers.id, t.salesOrders.customerId))
          .where(eq(t.salesOrders.id, row.mo.salesOrderId))
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
  ]);
  return { ...row, materials, operations, salesOrder: so };
}
