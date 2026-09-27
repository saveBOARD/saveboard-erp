import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Metadata } from "next";
import { DataTable, type Column } from "@/components/data-table";
import { ListHeader } from "@/components/list-header";
import { db, t } from "@/db";
import { getEntityContext } from "@/lib/dal";

export const metadata: Metadata = { title: "Quotes · saveBOARD ERP" };

const TABS = [
  { label: "Open", value: "open", statuses: ["draft", "sent"] },
  { label: "Accepted", value: "accepted", statuses: ["accepted"] },
  { label: "Declined & expired", value: "closed", statuses: ["declined", "expired"] },
  { label: "All", value: "all", statuses: ["draft", "sent", "accepted", "declined", "expired"] },
] as const;

const QUOTE_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
};

export default async function QuotesPage(props: PageProps<"/sell/quotes">) {
  const { entity } = await getEntityContext();
  const sp = await props.searchParams;
  const tab = TABS.find((x) => x.value === sp.tab) ?? TABS[0];
  const o = t.salesOrders;
  const rows = await db
    .select({
      id: o.id,
      number: o.number,
      title: o.title,
      orderDate: o.orderDate,
      customer: t.customers.name,
      customerReference: o.customerReference,
      subtotal: o.subtotal,
      total: o.total,
      currency: o.currency,
      fxRate: o.fxRate,
      deliveryDeadline: o.deliveryDeadline,
      quoteStatus: o.quoteStatus,
      ageDays: sql<number>`(current_date - ${o.orderDate})::int`,
    })
    .from(o)
    .innerJoin(t.customers, eq(t.customers.id, o.customerId))
    .where(and(eq(o.entityId, entity.id), eq(o.status, "quote"), inArray(o.quoteStatus, [...tab.statuses])))
    .orderBy(desc(o.orderDate), desc(o.number));

  const columns: Column[] = [
    { key: "orderDate", label: "Created date", width: 110 },
    { key: "order", label: "Order #", href: "/sell/quotes/{id}", width: 240 },
    { key: "customer", label: "Customer", width: 200 },
    { key: "customerReference", label: "Customer ref" },
    { key: "subtotal", label: "Total ex GST", kind: "money", total: true, hidden: true },
    { key: "total", label: "Total amount", kind: "money", total: true },
    { key: "orderTotal", label: "Order currency total", kind: "money", currencyKey: "currency", hidden: true },
    { key: "deliveryDeadline", label: "Delivery deadline" },
    { key: "ageDays", label: "Age (days)", kind: "number" },
    { key: "status", label: "Status", tones: { Draft: "pending", Sent: "pending", Accepted: "ok", Declined: "bad", Expired: "pending" } },
  ];

  return (
    <>
      <ListHeader
        tabs={TABS.map((x) => ({ label: x.label, href: x.value === "open" ? "/sell/quotes" : `/sell/quotes?tab=${x.value}`, active: x === tab }))}
        newLabel="Quote"
      />
      <DataTable
        columns={columns}
        rows={rows.map((r) => ({
          id: r.id,
          orderDate: r.orderDate,
          order: r.title ? `${r.number} / ${r.title}` : r.number,
          customer: r.customer,
          customerReference: r.customerReference,
          // amounts in the entity's currency (Katana does the same), converted at the quote's rate
          subtotal: Math.round(Number(r.subtotal) * Number(r.fxRate) * 100) / 100,
          total: Math.round(Number(r.total) * Number(r.fxRate) * 100) / 100,
          orderTotal: Number(r.total),
          currency: r.currency,
          deliveryDeadline: r.deliveryDeadline,
          ageDays: Number(r.ageDays),
          status: QUOTE_STATUS_LABEL[r.quoteStatus ?? "draft"],
        }))}
        currency={entity.currency}
        exportName={`quotes-${entity.id}`}
        noun="quotes"
      />
    </>
  );
}
