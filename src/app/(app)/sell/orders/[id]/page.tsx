import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { OrderActions } from "@/components/order-actions";
import { OrderView } from "@/components/order-view";
import { ShipmentsPanel } from "@/components/shipments-panel";
import { getEntityContext } from "@/lib/dal";
import { shippedByLine } from "@/lib/orders/shipped";
import { stockPosition } from "@/lib/queries/availability";
import { getOrder } from "@/lib/queries/orders";
import { orderShipments } from "@/lib/queries/shipments";

export const metadata: Metadata = { title: "Sales order · saveBOARD ERP" };

export default async function SalesOrderPage(props: PageProps<"/sell/orders/[id]">) {
  const { id } = await props.params;
  const { entity } = await getEntityContext();
  const found = await getOrder(entity.id, id);
  if (!found) notFound();
  if (found.order.status === "quote") redirect(`/sell/quotes/${id}`);
  const timeZone = entity.id === "AUS" ? "Australia/Sydney" : "Pacific/Auckland";
  const [{ lineAvailability }, shipped, shipments] = await Promise.all([
    stockPosition(entity.id),
    shippedByLine([id]),
    orderShipments(id, found.order.number, timeZone),
  ]);
  return (
    <>
      <OrderView
        kind="order"
        order={found.order}
        customer={found.customer}
        lines={found.lines}
        entityCurrency={entity.currency}
        availability={lineAvailability}
        shipped={shipped}
        backHref="/sell/orders"
        actions={<OrderActions id={id} kind="order" status={found.order.status} quoteStatus={found.order.quoteStatus} />}
      />
      <div className="mx-auto mt-4 max-w-6xl">
        <ShipmentsPanel orderId={id} shipments={shipments} canReverse={["open", "picked", "shipped"].includes(found.order.status)} />
      </div>
    </>
  );
}
