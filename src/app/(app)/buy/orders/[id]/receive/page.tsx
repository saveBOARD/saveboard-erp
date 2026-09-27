import { eq, sql } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ReceiveForm } from "@/components/receive-form";
import { db, t } from "@/db";
import { getEntityContext } from "@/lib/dal";
import { receivedByLine } from "@/lib/purchasing/received";
import { getPO } from "@/lib/queries/purchase-order";
import { entityToday } from "@/lib/queries/stock-items";

export const metadata: Metadata = { title: "Receive goods · saveBOARD ERP" };

export default async function ReceivePage(props: PageProps<"/buy/orders/[id]/receive">) {
  const { id } = await props.params;
  const { entity } = await getEntityContext();
  const found = await getPO(entity.id, id, "Pacific/Auckland");
  if (!found) notFound();
  if (found.po.status !== "open") redirect(`/buy/orders/${id}`);
  const [received, [{ next }]] = await Promise.all([
    receivedByLine([id]),
    db.select({ next: sql<number>`coalesce(max(${t.goodsReceipts.seq}), 0)::int + 1` }).from(t.goodsReceipts).where(eq(t.goodsReceipts.poId, id)),
  ]);
  return (
    <ReceiveForm
      poId={id}
      poNumber={found.po.number}
      nextSeq={next}
      today={entityToday(entity.id)}
      lines={found.lines.map(({ l, uom, trackStock }) => ({
        id: l.id,
        lineNo: l.lineNo,
        sku: l.sku,
        description: l.description,
        uom,
        ordered: Number(l.qty),
        received: received.get(l.id) ?? 0,
        trackStock: !!trackStock,
      }))}
    />
  );
}
