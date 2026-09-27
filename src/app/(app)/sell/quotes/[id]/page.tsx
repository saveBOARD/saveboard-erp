import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
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
    <>
      <OrderView kind="quote" order={found.order} customer={found.customer} lines={found.lines} entityCurrency={entity.currency} backHref="/sell/quotes" />
      <p className="no-print mx-auto mt-3 max-w-6xl text-xs text-muted">
        Editing, the customer PDF and one-click conversion to a sales order are the next part of Phase 2.
      </p>
    </>
  );
}
