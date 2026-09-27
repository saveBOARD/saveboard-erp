import type { Metadata } from "next";
import { OrderEditorPage } from "@/components/order-editor-page";

export const metadata: Metadata = { title: "New sales order · saveBOARD ERP" };

export default function NewSalesOrderPage() {
  return <OrderEditorPage kind="order" />;
}
