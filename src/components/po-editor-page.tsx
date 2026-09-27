import { and, asc, eq, sql } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { POEditor, type POInitial } from "@/components/po-editor";
import { db, t } from "@/db";
import { getEntityContext } from "@/lib/dal";
import { entityToday } from "@/lib/queries/stock-items";

/** Server wrapper: loads suppliers, items and last prices for a new or existing purchase order. */
export async function POEditorPage({ id, presetSupplierId }: { id?: string; presetSupplierId?: string }) {
  const { entity } = await getEntityContext();
  const [suppliers, products, last] = await Promise.all([
    db
      .select({ id: t.suppliers.id, name: t.suppliers.name, leadTimeDays: t.suppliers.leadTimeDays })
      .from(t.suppliers)
      .where(and(eq(t.suppliers.entityId, entity.id), eq(t.suppliers.active, true)))
      .orderBy(asc(t.suppliers.name)),
    db
      .select({ id: t.products.id, sku: t.products.sku, name: t.products.name, uom: t.products.uom, type: t.products.type, cost: t.products.standardCost })
      .from(t.products)
      .where(and(eq(t.products.entityId, entity.id), eq(t.products.active, true)))
      .orderBy(asc(t.products.name)),
    db.execute<{ supplier_id: string; product_id: string; unit_price: string }>(sql`
      select distinct on (po.supplier_id, l.product_id) po.supplier_id, l.product_id, l.unit_price
      from po_lines l join purchase_orders po on po.id = l.po_id
      where po.entity_id = ${entity.id} and l.product_id is not null and po.status <> 'cancelled'
      order by po.supplier_id, l.product_id, po.order_date desc, po.created_at desc`),
  ]);
  const lastRows = (Array.isArray(last) ? last : (last as unknown as { rows: { supplier_id: string; product_id: string; unit_price: string }[] }).rows) as {
    supplier_id: string;
    product_id: string;
    unit_price: string;
  }[];

  let initial: POInitial | undefined;
  if (id) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
    const [po] = await db.select().from(t.purchaseOrders).where(and(eq(t.purchaseOrders.id, id), eq(t.purchaseOrders.entityId, entity.id)));
    if (!po) notFound();
    if (!["draft", "open"].includes(po.status)) redirect(`/buy/orders/${id}`);
    const lines = await db.select().from(t.poLines).where(eq(t.poLines.poId, id)).orderBy(asc(t.poLines.lineNo));
    initial = {
      id: po.id,
      number: po.number,
      title: po.title,
      supplierId: po.supplierId,
      orderDate: po.orderDate,
      expectedOn: po.expectedOn,
      currency: po.currency,
      fxRate: Number(po.fxRate),
      notes: po.notes,
      lines: lines.map((l) => ({ id: l.id, productId: l.productId, sku: l.sku, description: l.description, qty: Number(l.qty), unitPrice: Number(l.unitPrice), taxRate: Number(l.taxRate) })),
    };
  }

  return (
    <POEditor
      entity={{ id: entity.id, currency: entity.currency, gstRate: Number(entity.gstRate) }}
      suppliers={suppliers}
      products={products.map((p) => ({ id: p.id, sku: p.sku, name: p.name, uom: p.uom, isService: p.type === "service", standardCost: Number(p.cost) }))}
      lastPrices={Object.fromEntries(lastRows.map((r) => [`${r.supplier_id}|${r.product_id}`, Number(r.unit_price)]))}
      initial={initial}
      presetSupplierId={presetSupplierId}
      today={entityToday(entity.id)}
    />
  );
}
