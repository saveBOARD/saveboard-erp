import type { Metadata } from "next";
import { PrintShell, SalesDocument } from "@/components/print/sales-document";
import { printData } from "@/lib/queries/print";

export const metadata: Metadata = { title: "Order acknowledgement · saveBOARD ERP" };

export default async function PrintOrder(props: PageProps<"/print/order/[id]">) {
  const { id } = await props.params;
  const d = await printData(id);
  return (
    <PrintShell title={`Order acknowledgement ${d.order.number}`}>
      <SalesDocument kind="acknowledgement" entity={d.entity} order={d.order} customer={d.customer} lines={d.lines} />
    </PrintShell>
  );
}
