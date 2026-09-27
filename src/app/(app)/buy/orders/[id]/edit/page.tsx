import type { Metadata } from "next";
import { POEditorPage } from "@/components/po-editor-page";

export const metadata: Metadata = { title: "Edit purchase order · saveBOARD ERP" };

export default async function EditPOPage(props: PageProps<"/buy/orders/[id]/edit">) {
  const { id } = await props.params;
  return <POEditorPage id={id} />;
}