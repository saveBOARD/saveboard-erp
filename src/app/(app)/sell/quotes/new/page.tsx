import type { Metadata } from "next";
import { OrderEditorPage } from "@/components/order-editor-page";

export const metadata: Metadata = { title: "New quote · saveBOARD ERP" };

export default async function NewQuotePage(props: PageProps<"/sell/quotes/new">) {
  const sp = await props.searchParams;
  return <OrderEditorPage kind="quote" presetCustomerId={typeof sp.customer === "string" ? sp.customer : undefined} />;
}