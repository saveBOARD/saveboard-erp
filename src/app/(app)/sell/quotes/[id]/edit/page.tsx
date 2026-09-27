import type { Metadata } from "next";
import { OrderEditorPage } from "@/components/order-editor-page";

export const metadata: Metadata = { title: "Edit quote · saveBOARD ERP" };

export default async function EditQuotePage(props: PageProps<"/sell/quotes/[id]/edit">) {
  const { id } = await props.params;
  return <OrderEditorPage kind="quote" id={id} />;
}
