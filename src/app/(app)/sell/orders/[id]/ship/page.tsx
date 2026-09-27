import { eq, sql } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ShipForm } from "@/components/ship-form";
import { db, t } from "@/db";
import { getEntityContext } from "@/lib/dal";
import { shippedByLine } from "@/lib/orders/shipped";
import { getOrder } from "@/lib/queries/orders";

export const metadata: Metadata = { title: "Ship · saveBOARD ERP" };

export default async function ShipPage(props: PageProps<"/sell/orders/[id]/ship">) {
  const { id } = await props.params;
  const { entity } = await getEntityContext();
  const found = await getOrder(entity.id, id);
  if (!found) notFound();
  if (!["open", "picked"].includes(found.order.status)) redirect(`/sell/orders/${id}`);

  const [shipped, [{ next }], tracked] = await Promise.all([
    shippedByLine([id]),
    db.select({ next: sql<number>`coalesce(max(${t.shipments.seq}), 0)::int + 1` }).from(t.shipments).where(eq(t.shipments.orderId, id)),
    db
      .select({ id: t.orderLines.id, trackStock: t.products.trackStock })
      .from(t.orderLines)
      .leftJoin(t.products, eq(t.products.id, t.orderLines.productId))
      .where(eq(t.orderLines.orderId, id)),
  ]);
  const track = new Map(tracked.map((r) => [r.id, !!r.trackStock]));
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: entity.id === "AUS" ? "Australia/Sydney" : "Pacific/Auckland" }).format(new Date());

  return (
    <ShipForm
      orderId={id}
      orderNumber={found.order.number}
      nextSeq={next}
      today={today}
      lines={found.lines.map(({ l, uom }) => ({
        id: l.id,
        lineNo: l.lineNo,
        sku: l.sku,
        description: l.description,
        uom,
        ordered: Number(l.qty),
        shipped: shipped.get(l.id) ?? 0,
        trackStock: track.get(l.id) ?? false,
        suggestedBatch: l.batchNo,
      }))}
    />
  );
}
