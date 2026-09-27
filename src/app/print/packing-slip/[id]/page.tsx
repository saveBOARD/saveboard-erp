import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrintShell, SalesDocument, type DocKind } from "@/components/print/sales-document";
import { db, t } from "@/db";
import { shippedByLine } from "@/lib/orders/shipped";
import { printData } from "@/lib/queries/print";

export const metadata: Metadata = { title: "Packing slip · saveBOARD ERP" };

const COPIES: Record<string, DocKind[]> = {
  picker: ["picker"],
  transport: ["transport"],
  customer: ["customer"],
  all: ["picker", "transport", "customer"],
};

/**
 * Packing slips. With ?shipment=N: exactly what that shipment sent, with batch numbers.
 * Without: what is still outstanding on the order (for picking).
 */
export default async function PrintPackingSlip(props: PageProps<"/print/packing-slip/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const copies = COPIES[String(sp.copy ?? "all")] ?? COPIES.all;
  const d = await printData(id);
  const seq = Number(sp.shipment);

  let lines = d.lines;
  let shipment: { ref: string; shippedOn: string; carrier: string | null; consignmentNo: string | null } | undefined;

  if (seq) {
    const [s] = await db.select().from(t.shipments).where(and(eq(t.shipments.orderId, id), eq(t.shipments.seq, seq)));
    if (!s) notFound();
    const sent = await db.select().from(t.shipmentLines).where(eq(t.shipmentLines.shipmentId, s.id));
    shipment = { ref: `${d.order.number}/${s.seq}`, shippedOn: s.shippedOn, carrier: s.carrier, consignmentNo: s.consignmentNo };
    // one printed row per shipment line (a line split across batches prints once per batch)
    lines = sent.flatMap((sl) => {
      const base = d.lines.find((x) => x.l.id === sl.orderLineId);
      return base ? [{ ...base, l: { ...base.l, id: sl.id, qty: sl.qty, batchNo: sl.batchNo } }] : [];
    });
  } else if (d.order.status !== "quote") {
    const shipped = await shippedByLine([id]);
    lines = d.lines
      .map((x) => ({ ...x, l: { ...x.l, qty: String(Number(x.l.qty) - (shipped.get(x.l.id) ?? 0)) } }))
      .filter((x) => Number(x.l.qty) > 1e-9);
  }

  return (
    <PrintShell title={`Packing slip ${shipment?.ref ?? d.order.number}`}>
      {copies.map((kind) => (
        <SalesDocument key={kind} kind={kind} entity={d.entity} order={d.order} customer={d.customer} lines={lines} shipment={shipment} />
      ))}
    </PrintShell>
  );
}
