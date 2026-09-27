import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { OrderActions } from "@/components/order-actions";
import { OrderView } from "@/components/order-view";
import { getEntityContext } from "@/lib/dal";
import { getOrder } from "@/lib/queries/orders";

export const metadata: Metadata = { title: "Quote · saveBOARD ERP" };

export default async function QuotePage(props: PageProps<"/sell/quotes/[id]">) {
  const { id } = await props.params;
  const { entity } = await getEntityContext();
  const found = await getOrder(entity.id, id);
  if (!found) notFound();
  if (found.order.status !== "quote") redirect(`/sell/orders/${id}`);
  return (
    <OrderView
      kind="quote"
      order={found.order}
      customer={found.customer}
      lines={found.lines}
      entityCurrency={entity.currency}
      backHref="/sell/quotes"
      actions={<OrderActions id={id} kind="quote" status={found.order.status} quoteStatus={found.order.quoteStatus} />}
    />
  );
}
