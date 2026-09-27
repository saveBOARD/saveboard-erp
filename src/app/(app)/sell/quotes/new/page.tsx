import type { Metadata } from "next";
import { OrderEditorPage } from "@/components/order-editor-page";

export const metadata: Metadata = { title: "New quote · saveBOARD ERP" };

export default function NewQuotePage() {
  return <OrderEditorPage kind="quote" />;
}
