import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { MOEditor, type MOInitial, type MORecipe } from "@/components/mo-editor";
import { db, t } from "@/db";
import { getEntityContext } from "@/lib/dal";
import { stockPosition } from "@/lib/queries/availability";

/** Server wrapper: loads items, recipes and open sales orders for a new or existing manufacturing order. */
export async function MOEditorPage({ id, preset }: { id?: string; preset?: { productId?: string; qty?: number; salesOrderId?: string } }) {
  const { entity } = await getEntityContext();
  const [products, recipeLines, recipeOps, orders, position] = await Promise.all([
    db
      .select({ id: t.products.id, sku: t.products.sku, name: t.products.name, uom: t.products.uom, cost: t.products.standardCost, trackStock: t.products.trackStock, type: t.products.type })
      .from(t.products)
      .where(and(eq(t.products.entityId, entity.id), eq(t.products.active, true)))
      .orderBy(asc(t.products.name)),
    db
      .select({ productId: t.recipeLines.productId, ingredientId: t.recipeLines.ingredientId, qtyPerUnit: t.recipeLines.qtyPerUnit, note: t.recipeLines.note })
      .from(t.recipeLines)
      .innerJoin(t.products, eq(t.products.id, t.recipeLines.productId))
      .where(eq(t.products.entityId, entity.id))
      .orderBy(asc(t.recipeLines.sortOrder)),
    db
      .select({ productId: t.recipeOperations.productId, name: t.recipeOperations.name, hoursPerUnit: t.recipeOperations.hoursPerUnit, costPerHour: t.recipeOperations.costPerHour })
      .from(t.recipeOperations)
      .innerJoin(t.products, eq(t.products.id, t.recipeOperations.productId))
      .where(eq(t.products.entityId, entity.id))
      .orderBy(asc(t.recipeOperations.sortOrder)),
    db
      .select({ id: t.salesOrders.id, number: t.salesOrders.number, title: t.salesOrders.title, customer: t.customers.name, deliveryDeadline: t.salesOrders.deliveryDeadline })
      .from(t.salesOrders)
      .innerJoin(t.customers, eq(t.customers.id, t.salesOrders.customerId))
      .where(and(eq(t.salesOrders.entityId, entity.id), inArray(t.salesOrders.status, ["open", "picked"])))
      .orderBy(desc(t.salesOrders.orderDate)),
    stockPosition(entity.id),
  ]);

  const recipes: Record<string, MORecipe> = {};
  for (const l of recipeLines) (recipes[l.productId] ??= { lines: [], ops: [] }).lines.push({ ingredientId: l.ingredientId, qtyPerUnit: Number(l.qtyPerUnit), note: l.note });
  for (const o of recipeOps) (recipes[o.productId] ??= { lines: [], ops: [] }).ops.push({ name: o.name, hoursPerUnit: Number(o.hoursPerUnit), costPerHour: Number(o.costPerHour) });

  let initial: MOInitial | undefined;
  if (id) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
    const [mo] = await db.select().from(t.manufacturingOrders).where(and(eq(t.manufacturingOrders.id, id), eq(t.manufacturingOrders.entityId, entity.id)));
    if (!mo) notFound();
    if (mo.status === "done" || mo.status === "cancelled") redirect(`/make/orders/${id}`);
    const [materials, operations] = await Promise.all([
      db.select().from(t.moMaterials).where(eq(t.moMaterials.moId, id)).orderBy(asc(t.moMaterials.sortOrder)),
      db.select().from(t.moOperations).where(eq(t.moOperations.moId, id)).orderBy(asc(t.moOperations.sortOrder)),
    ]);
    initial = {
      id: mo.id,
      number: mo.number,
      productId: mo.productId,
      plannedQty: Number(mo.plannedQty),
      productionDeadline: mo.productionDeadline,
      deliveryDeadline: mo.deliveryDeadline,
      salesOrderId: mo.salesOrderId,
      notes: mo.notes,
      materials: materials.map((m) => ({ productId: m.productId, plannedQty: Number(m.plannedQty), note: m.note })),
      operations: operations.map((o) => ({ name: o.name, plannedHours: Number(o.plannedHours), costPerHour: Number(o.costPerHour) })),
    };
  }

  const so = preset?.salesOrderId ? orders.find((o) => o.id === preset.salesOrderId) : undefined;
  return (
    <MOEditor
      items={products
        .filter((p) => p.type !== "service")
        .map((p) => ({ id: p.id, sku: p.sku, name: p.name, uom: p.uom, cost: Number(p.cost), trackStock: p.trackStock, inStock: position.onHand.get(p.id) ?? 0 }))}
      recipes={recipes}
      salesOrders={orders.map((o) => ({ id: o.id, label: `${o.number}${o.title ? ` / ${o.title}` : ""} — ${o.customer}` }))}
      initial={initial}
      preset={preset && { ...preset, salesOrderId: so?.id, deliveryDeadline: so?.deliveryDeadline ?? undefined }}
      currency={entity.currency}
    />
  );
}
