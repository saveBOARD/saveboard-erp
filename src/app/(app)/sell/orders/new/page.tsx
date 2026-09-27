import type { Metadata } from "next";
import { OrderEditorPage } from "@/components/order-editor-page";

export const metadata: Metadata = { title: "New sales order · saveBOARD ERP" };

export default async function NewSalesOrderPage(props: PageProps<"/sell/orders/new">) {
  const sp = await props.searchParams;
  return <OrderEditorPage kind="order" presetCustomerId={typeof sp.customer === "string" ? sp.customer : undefined} />;
}