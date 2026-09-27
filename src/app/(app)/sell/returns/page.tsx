import { and, desc, eq, inArray } from "drizzle-orm";
import type { Metadata } from "next";
import { DataTable, type Column } from "@/components/data-table";
import { ListHeader } from "@/components/list-header";
import { db, t } from "@/db";
import { getEntityContext } from "@/lib/dal";

export const metadata: Metadata = { title: "Returns · saveBOARD ERP" };

type ReturnStatus = (typeof t.returnStatus.enumValues)[number];
const TABS: { label: string; value: string; statuses: ReturnStatus[] }[] = [
  { label: "Open", value: "open", statuses: ["open"] },
  { label: "Received", value: "received", statuses: ["received"] },
  { label: "Cancelled", value: "cancelled", statuses: ["cancelled"] },
];

export default async function ReturnsPage(props: PageProps<"/sell/returns">) {
  const { entity } = await getEntityContext();
  const sp = await props.searchParams;
  const tab = TABS.find((x) => x.value === sp.tab) ?? TABS[0];
  const r = t.salesReturns;
  const rows = await db
    .select({
      id: r.id,
      number: r.number,
      orderId: r.orderId,
      soNumber: t.salesOrders.number,
      customer: t.customers.name,
      returnDate: r.returnDate,
      receivedOn: r.receivedOn,
      creditedOn: r.creditedOn,
      subtotal: r.subtotal,
      total: r.total,
      currency: r.currency,
      notes: r.notes,
    })
    .from(r)
    .innerJoin(t.salesOrders, eq(t.salesOrders.id, r.orderId))
    .innerJoin(t.customers, eq(t.customers.id, r.customerId))
    .where(and(eq(r.entityId, entity.id), inArray(r.status, tab.statuses)))
    .orderBy(desc(r.returnDate), desc(r.createdAt));

  const columns: Column[] = [
    { key: "returnDate", label: "Return date", width: 110 },
    { key: "number", label: "Return #", href: "/sell/returns/{id}" },
    { key: "soNumber", label: "Sales order", href: "/sell/orders/{orderId}" },
    { key: "customer", label: "Customer", width: 240 },
    { key: "subtotal", label: "Credit ex GST", kind: "money", currencyKey: "currency" },
    { key: "total", label: "Credit incl. GST", kind: "money", currencyKey: "currency", hidden: true },
    ...(tab.value === "received" ? [{ key: "receivedOn", label: "Received" } as Column] : []),
    { key: "credit", label: "Credit note", tones: { "Not credited": "pending", Credited: "ok" } },
    { key: "notes", label: "Notes", hidden: true },
  ];

  return (
    <>
      <ListHeader tabs={TABS.map((x) => ({ label: x.label, href: x.value === "open" ? "/sell/returns" : `/sell/returns?tab=${x.value}`, active: x === tab }))} />
      <DataTable
        columns={columns}
        rows={rows.map((x) => ({
          ...x,
          subtotal: Number(x.subtotal),
          total: Number(x.total),
          credit: x.creditedOn ? "Credited" : "Not credited",
        }))}
        currency={entity.currency}
        exportName={`returns-${entity.id}`}
        noun="returns"
      />
      <p className="mt-2 text-xs text-muted">
        To start a return, open the shipped sales order and click Return. Open = waiting for the goods to come back. Credit notes go to Xero from Sell → Invoicing.
      </p>
    </>
  );
}
