import { and, eq, inArray, isNull, isNotNull } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ReturnForm } from "@/components/return-form";
import { db, t } from "@/db";
import { getEntityContext } from "@/lib/dal";
import { returnedByLine, shippedByLine } from "@/lib/orders/shipped";
import { getOrder } from "@/lib/queries/orders";
import { entityToday } from "@/lib/queries/stock-items";

export const metadata: Metadata = { title: "New return · saveBOARD ERP" };

export default async function NewReturnPage(props: PageProps<"/sell/returns/new">) {
  const sp = await props.searchParams;
  const orderId = typeof sp.order === "string" ? sp.order : "";
  if (!orderId) redirect("/sell/orders?tab=done");
  const { entity } = await getEntityContext();
  const found = await getOrder(entity.id, orderId);
  if (!found || found.order.status === "quote") notFound();
  const lineIds = found.lines.map(({ l }) => l.id);
  const [shipped, returned, batchRows, products] = await Promise.all([
    shippedByLine([orderId]),
    returnedByLine([orderId]),
    lineIds.length
      ? db
          .selectDistinct({ lineId: t.shipmentLines.orderLineId, batch: t.shipmentLines.batchNo })
          .from(t.shipmentLines)
          .innerJoin(t.shipments, eq(t.shipments.id, t.shipmentLines.shipmentId))
          .where(and(inArray(t.shipmentLines.orderLineId, lineIds), isNull(t.shipments.reversedAt), isNotNull(t.shipmentLines.batchNo)))
      : Promise.resolve([]),
    db.select({ id: t.products.id, trackStock: t.products.trackStock }).from(t.products).where(eq(t.products.entityId, entity.id)),
  ]);
  const tracked = new Map(products.map((p) => [p.id, p.trackStock]));

  return (
    <ReturnForm
      order={{ id: orderId, number: found.order.number, customer: found.customer.name, currency: found.order.currency }}
      today={entityToday(entity.id)}
      lines={found.lines.map(({ l, uom }) => ({
        id: l.id,
        lineNo: l.lineNo,
        sku: l.sku,
        description: l.description,
        uom,
        returnable: Math.max(0, Math.round(((shipped.get(l.id) ?? 0) - (returned.get(l.id) ?? 0)) * 10000) / 10000),
        netPrice: Math.round(Number(l.unitPrice) * (1 - Number(l.discountPct)) * 10000) / 10000,
        taxRate: Number(l.taxRate),
        isStock: !!l.productId && tracked.get(l.productId) === true,
        batches: batchRows.filter((b) => b.lineId === l.id).map((b) => b.batch!),
      }))}
    />
  );
}
