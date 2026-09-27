import type { Metadata } from "next";
import { PrintShell, SalesDocument, type DocKind } from "@/components/print/sales-document";
import { printData } from "@/lib/queries/print";

export const metadata: Metadata = { title: "Packing slip · saveBOARD ERP" };

const COPIES: Record<string, DocKind[]> = {
  picker: ["picker"],
  transport: ["transport"],
  customer: ["customer"],
  all: ["picker", "transport", "customer"],
};

export default async function PrintPackingSlip(props: PageProps<"/print/packing-slip/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const copies = COPIES[String(sp.copy ?? "all")] ?? COPIES.all;
  const d = await printData(id);
  return (
    <PrintShell title={`Packing slip ${d.order.number}`}>
      {copies.map((kind) => (
        <SalesDocument key={kind} kind={kind} entity={d.entity} order={d.order} customer={d.customer} lines={d.lines} />
      ))}
    </PrintShell>
  );
}
