import { asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { OrderActions } from "@/components/order-actions";
import { OrderView } from "@/components/order-view";
import { ShipmentsPanel } from "@/components/shipments-panel";
import { db, t } from "@/db";
import { getEntityContext } from "@/lib/dal";
import { returnedByLine, shippedByLine } from "@/lib/orders/shipped";
import { stockPosition } from "@/lib/queries/availability";
import { getOrder } from "@/lib/queries/orders";
import { orderShipments } from "@/lib/queries/shipments";

export const metadata: Metadata = { title: "Sales order · saveBOARD ERP" };

const RETURN_STATUS: Record<string, string> = { open: "Open — awaiting goods", received: "Received", cancelled: "Cancelled" };

export default async function SalesOrderPage(props: PageProps<"/sell/orders/[id]">) {
  const { id } = await props.params;
  const { entity } = await getEntityContext();
  const found = await getOrder(entity.id, id);
  if (!found) notFound();
  if (found.order.status === "quote") redirect(`/sell/quotes/${id}`);
  const timeZone = entity.id === "AUS" ? "Australia/Sydney" : "Pacific/Auckland";
  const [{ lineAvailability }, shipped, returned, shipments, returns] = await Promise.all([
    stockPosition(entity.id),
    shippedByLine([id]),
    returnedByLine([id]),
    orderShipments(id, found.order.number, timeZone),
    db
      .select({ id: t.salesReturns.id, number: t.salesReturns.number, status: t.salesReturns.status, returnDate: t.salesReturns.returnDate, creditedOn: t.salesReturns.creditedOn })
      .from(t.salesReturns)
      .where(eq(t.salesReturns.orderId, id))
      .orderBy(asc(t.salesReturns.createdAt)),
  ]);
  const canReturn = found.order.status !== "cancelled" && found.lines.some(({ l }) => (shipped.get(l.id) ?? 0) - (returned.get(l.id) ?? 0) > 1e-9);
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
        actions={<OrderActions id={id} kind="order" status={found.order.status} quoteStatus={found.order.quoteStatus} canReturn={canReturn} />}
      />
      <div className="mx-auto mt-4 grid max-w-6xl gap-4">
        <ShipmentsPanel orderId={id} shipments={shipments} canReverse={["open", "picked", "shipped"].includes(found.order.status)} />
        {returns.length > 0 && (
          <section className="rounded border border-line bg-surface p-4">
            <h2 className="mb-2 text-xs uppercase tracking-wide text-muted">Returns</h2>
            <ul className="grid gap-1 text-sm">
              {returns.map((r) => (
                <li key={r.id}>
                  <Link href={`/sell/returns/${r.id}`} className="text-link hover:underline">
                    {r.number}
                  </Link>{" "}
                  · {r.returnDate} · {RETURN_STATUS[r.status]} · {r.creditedOn ? `credited ${r.creditedOn}` : "not credited"}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}
