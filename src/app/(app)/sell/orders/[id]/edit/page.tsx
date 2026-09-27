import type { Metadata } from "next";
import { OrderEditorPage } from "@/components/order-editor-page";

export const metadata: Metadata = { title: "Edit sales order · saveBOARD ERP" };

export default async function EditSalesOrderPage(props: PageProps<"/sell/orders/[id]/edit">) {
  const { id } = await props.params;
  return <OrderEditorPage kind="order" id={id} />;
}
