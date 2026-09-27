import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db, t } from "@/db";

/** One quote or order with its customer and lines, scoped to the entity. Null if not found. */
export async function getOrder(entityId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db
    .select({ order: t.salesOrders, customer: t.customers })
    .from(t.salesOrders)
    .innerJoin(t.customers, eq(t.customers.id, t.salesOrders.customerId))
    .where(and(eq(t.salesOrders.id, id), eq(t.salesOrders.entityId, entityId)));
  if (!row) return null;
  const lines = await db
    .select({ l: t.orderLines, uom: t.products.uom })
    .from(t.orderLines)
    .leftJoin(t.products, eq(t.products.id, t.orderLines.productId))
    .where(eq(t.orderLines.orderId, id))
    .orderBy(asc(t.orderLines.lineNo));
  return { ...row, lines };
}
