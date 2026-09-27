import type { Metadata } from "next";
import { MOEditorPage } from "@/components/mo-editor-page";

export const metadata: Metadata = { title: "New manufacturing order · saveBOARD ERP" };

export default async function NewMOPage(props: PageProps<"/make/orders/new">) {
  const sp = await props.searchParams;
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const qty = Number(str(sp.qty));
  return <MOEditorPage preset={{ productId: str(sp.product), qty: qty > 0 ? qty : undefined, salesOrderId: str(sp.so) }} />;
}
