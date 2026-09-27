import type { Metadata } from "next";
import { MOEditorPage } from "@/components/mo-editor-page";

export const metadata: Metadata = { title: "Edit manufacturing order · saveBOARD ERP" };

export default async function EditMOPage(props: PageProps<"/make/orders/[id]/edit">) {
  const { id } = await props.params;
  return <MOEditorPage id={id} />;
}
