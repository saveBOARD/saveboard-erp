import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { OrderView } from "@/components/order-view";
import { getEntityContext } from "@/lib/dal";
import { stockPosition } from "@/lib/queries/availability";
import { getOrder } from "@/lib/queries/orders";

export const metadata: Metadata = { title: "Sales order · saveBOARD ERP" };

export default async function SalesOrderPage(props: PageProps<"/sell/orders/[id]">) {
  const { id } = await props.params;
  const { entity } = await getEntityContext();
  const found = await getOrder(entity.id, id);
  if (!found) notFound();
  if (found.order.status === "quote") redirect(`/sell/quotes/${id}`);
  const { lineAvailability } = await stockPosition(entity.id);
  return (
    <OrderView
      kind="order"
      order={found.order}
      customer={found.customer}
      lines={found.lines}
      entityCurrency={entity.currency}
      availability={lineAvailability}
      backHref="/sell/orders"
    />
  );
}
