import type { Metadata } from "next";
import { POEditorPage } from "@/components/po-editor-page";

export const metadata: Metadata = { title: "New purchase order · saveBOARD ERP" };

export default async function NewPOPage(props: PageProps<"/buy/orders/new">) {
  const sp = await props.searchParams;
  return <POEditorPage presetSupplierId={typeof sp.supplier === "string" ? sp.supplier : undefined} />;
}