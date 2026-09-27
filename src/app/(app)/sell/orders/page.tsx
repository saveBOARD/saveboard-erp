import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Metadata } from "next";
import { DataTable, type Column } from "@/components/data-table";
import { ListHeader } from "@/components/list-header";
import { ORDER_STATUS } from "@/components/order-view";
import { db, t } from "@/db";
import { getEntityContext } from "@/lib/dal";
import { DELIVERY_LABEL, deliveryState, shippedByLine } from "@/lib/orders/shipped";
import { AVAILABILITY_LABEL, stockPosition } from "@/lib/queries/availability";

export const metadata: Metadata = { title: "Sales orders · saveBOARD ERP" };

type OrderStatus = (typeof t.orderStatus.enumValues)[number];
const TABS: { label: string; value: string; statuses: OrderStatus[] }[] = [
  { label: "Open", value: "open", statuses: ["open", "picked"] },
  { label: "Done", value: "done", statuses: ["shipped", "invoiced", "closed"] },
  { label: "Cancelled", value: "cancelled", statuses: ["cancelled"] },
];

export default async function SalesOrdersPage(props: PageProps<"/sell/orders">) {
  const { entity } = await getEntityContext();
  const sp = await props.searchParams;
  const tab = TABS.find((x) => x.value === sp.tab) ?? TABS[0];
  const o = t.salesOrders;
  const [rows, position] = await Promise.all([
    db
      .select({
        id: o.id,
        number: o.number,
        title: o.title,
        orderDate: o.orderDate,
        customer: t.customers.name,
        customerReference: o.customerReference,
        total: o.total,
        fxRate: o.fxRate,
        deliveryDeadline: o.deliveryDeadline,
        overdue: sql<boolean>`${o.deliveryDeadline} < current_date`,
        status: o.status,
      })
      .from(o)
      .innerJoin(t.customers, eq(t.customers.id, o.customerId))
      .where(and(eq(o.entityId, entity.id), inArray(o.status, tab.statuses)))
      .orderBy(desc(o.orderDate), desc(o.number)),
    stockPosition(entity.id),
  ]);
  const orderIds = rows.map((r) => r.id);
  const [lineRows, shipped] = orderIds.length
    ? await Promise.all([
        db.select({ id: t.orderLines.id, orderId: t.orderLines.orderId, qty: t.orderLines.qty }).from(t.orderLines).where(inArray(t.orderLines.orderId, orderIds)),
        shippedByLine(orderIds),
      ])
    : [[], new Map<string, number>()];
  const delivery = new Map(
    orderIds.map((oid) => [
      oid,
      DELIVERY_LABEL[deliveryState(lineRows.filter((l) => l.orderId === oid).map((l) => ({ id: l.id, qty: Number(l.qty) })), shipped)],
    ]),
  );

  const columns: Column[] = [
    { key: "orderDate", label: "Created date", width: 110 },
    { key: "order", label: "Order #", href: "/sell/orders/{id}", width: 240 },
    { key: "customer", label: "Customer", width: 200 },
    { key: "total", label: "Total amount", kind: "money", total: true },
    { key: "deliveryDeadline", label: "Delivery deadline" },
    ...(tab.value === "open"
      ? [{ key: "salesItems", label: "Sales items", tones: { "In stock": "ok", "Not available": "bad" } } as Column]
      : []),
    { key: "status", label: "Status", tones: { Open: "pending", Picked: "pending", Shipped: "ok", Invoiced: "ok", Closed: "ok", Cancelled: "bad" } },
    { key: "delivery", label: "Delivery", tones: { "Not shipped": "pending", "Partially shipped": "pending", Shipped: "ok" } },
    { key: "customerReference", label: "Customer reference #" },
    { key: "overdueLabel", label: "Overdue", hidden: true },
  ];

  return (
    <>
      <ListHeader
        tabs={TABS.map((x) => ({ label: x.label, href: x.value === "open" ? "/sell/orders" : `/sell/orders?tab=${x.value}`, active: x === tab }))}
        newLabel="Sales order"
        newHref="/sell/orders/new"
      />
      <DataTable
        columns={columns}
        rows={rows.map((r) => ({
          id: r.id,
          orderDate: r.orderDate,
          order: r.title ? `${r.number} / ${r.title}` : r.number,
          customer: r.customer,
          total: Math.round(Number(r.total) * Number(r.fxRate) * 100) / 100,
          deliveryDeadline: r.deliveryDeadline,
          salesItems: AVAILABILITY_LABEL[position.orderAvailability.get(r.id) ?? "not_tracked"],
          status: ORDER_STATUS[r.status].label,
          delivery: delivery.get(r.id) ?? null,
          customerReference: r.customerReference,
          overdueLabel: r.overdue && tab.value === "open" ? "Overdue" : null,
        }))}
        currency={entity.currency}
        exportName={`sales-orders-${entity.id}`}
        noun="orders"
      />
    </>
  );
}
