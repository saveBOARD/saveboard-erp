import type { Metadata } from "next";
import { PrintShell, SalesDocument } from "@/components/print/sales-document";
import { printData } from "@/lib/queries/print";

export const metadata: Metadata = { title: "Quote · saveBOARD ERP" };

export default async function PrintQuote(props: PageProps<"/print/quote/[id]">) {
  const { id } = await props.params;
  const d = await printData(id);
  return (
    <PrintShell title={`Quote ${d.order.number}`}>
      <SalesDocument kind="quote" entity={d.entity} order={d.order} customer={d.customer} lines={d.lines} />
    </PrintShell>
  );
}
