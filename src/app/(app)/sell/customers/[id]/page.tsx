import { and, asc, desc, eq } from "drizzle-orm";
import { ArrowLeft, Pencil, Plus, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CustomerSites } from "@/components/customer-sites";
import { DataTable, type Column } from "@/components/data-table";
import { ORDER_STATUS } from "@/components/order-view";
import { db, t } from "@/db";
import { getEntityContext } from "@/lib/dal";

export const metadata: Metadata = { title: "Customer · saveBOARD ERP" };

const money = (n: number, currency: string) => `${n.toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-sm">{children || <span className="text-muted">—</span>}</span>
    </div>
  );
}

export default async function CustomerPage(props: PageProps<"/sell/customers/[id]">) {
  const { id } = await props.params;
  const { entity } = await getEntityContext();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [c] = await db.select().from(t.customers).where(and(eq(t.customers.id, id), eq(t.customers.entityId, entity.id)));
  if (!c) notFound();

  const [sites, orders, [priceList]] = await Promise.all([
    db.select().from(t.customerSites).where(eq(t.customerSites.customerId, id)).orderBy(desc(t.customerSites.isDefault), asc(t.customerSites.name)),
    db
      .select({
        id: t.salesOrders.id,
        number: t.salesOrders.number,
        title: t.salesOrders.title,
        orderDate: t.salesOrders.orderDate,
        status: t.salesOrders.status,
        quoteStatus: t.salesOrders.quoteStatus,
        total: t.salesOrders.total,
        fxRate: t.salesOrders.fxRate,
        customerReference: t.salesOrders.customerReference,
      })
      .from(t.salesOrders)
      .where(eq(t.salesOrders.customerId, id))
      .orderBy(desc(t.salesOrders.orderDate), desc(t.salesOrders.number)),
    db
      .select({ id: t.priceLists.id, name: t.priceLists.name })
      .from(t.priceLists)
      .where(c.priceListId ? eq(t.priceLists.id, c.priceListId) : and(eq(t.priceLists.entityId, entity.id), eq(t.priceLists.isDefault, true))),
  ]);

  const toEntity = (o: (typeof orders)[number]) => Number(o.total) * Number(o.fxRate);
  const openBalance = orders.filter((o) => ["open", "picked", "shipped"].includes(o.status)).reduce((s, o) => s + toEntity(o), 0);
  const limit = c.creditLimit === null ? null : Number(c.creditLimit);
  const overLimit = limit !== null && limit > 0 && openBalance > limit;
  const openQuotes = orders.filter((o) => o.status === "quote" && ["draft", "sent"].includes(o.quoteStatus ?? "")).length;

  const columns: Column[] = [
    { key: "orderDate", label: "Date", width: 100 },
    { key: "order", label: "Order #", hrefKey: "href", width: 240 },
    { key: "type", label: "Type" },
    { key: "status", label: "Status", tones: { Sent: "pending", Draft: "pending", Open: "pending", Picked: "pending", Accepted: "ok", Shipped: "ok", Invoiced: "ok", Closed: "ok", Declined: "bad", Cancelled: "bad", Expired: "pending" } },
    { key: "total", label: "Total incl. GST", kind: "money", total: true },
    { key: "customerReference", label: "Customer ref" },
  ];

  return (
    <div className="mx-auto grid max-w-6xl gap-4">
      <Link href="/sell/customers" className="no-print inline-flex items-center gap-1 text-sm text-link hover:underline">
        <ArrowLeft className="h-4 w-4" /> Customers
      </Link>

      <section className="grid gap-4 rounded border border-line bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted">Customer {c.code && `· ${c.code}`}</div>
            <h1 className="text-2xl font-medium">{c.name}</h1>
            {!c.active && <span className="text-sm text-bad">Inactive</span>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/sell/customers/${id}/edit`} className="btn-secondary">
              <Pencil className="h-4 w-4" /> Edit
            </Link>
            <Link href={`/sell/quotes/new?customer=${id}`} className="btn-secondary">
              <Plus className="h-4 w-4" /> Quote
            </Link>
            <Link href={`/sell/orders/new?customer=${id}`} className="btn-primary">
              <Plus className="h-4 w-4" /> Sales order
            </Link>
          </div>
        </div>
        {c.creditHold && (
          <p className="flex items-center gap-2 rounded bg-bad px-4 py-2 text-sm font-medium text-white">
            <TriangleAlert className="h-4 w-4" /> On credit hold: new sales orders are blocked until this is released.
          </p>
        )}
        {overLimit && (
          <p className="flex items-center gap-2 rounded border border-warn/40 bg-[#fff6e0] px-4 py-2 text-sm">
            <TriangleAlert className="h-4 w-4 text-warn" /> Open orders ({money(openBalance, entity.currency)}) are over the credit limit of{" "}
            {money(limit!, entity.currency)}.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Item label="Contact">{c.contactName}</Item>
          <Item label="Phone">{c.phone}</Item>
          <Item label="Email">{c.email && <a className="text-link hover:underline" href={`mailto:${c.email}`}>{c.email}</a>}</Item>
          <Item label={entity.businessNumberLabel}>{c.businessNumber}</Item>
          <Item label="Billing address">
            {[c.billingLine1, c.billingLine2, [c.billingCity, c.billingRegion, c.billingPostcode].filter(Boolean).join(" "), c.billingCountry].filter(Boolean).join(", ")}
          </Item>
          <Item label="Payment terms">{c.paymentTerms}</Item>
          <Item label="Price list">
            {priceList && (
              <Link href={`/sell/price-lists/${priceList.id}`} className="text-link hover:underline">
                {priceList.name}
                {!c.priceListId && " (default)"}
              </Link>
            )}
          </Item>
          <Item label="Credit limit">{limit !== null ? money(limit, entity.currency) : null}</Item>
          <Item label="Open orders (not yet invoiced)">{money(openBalance, entity.currency)}</Item>
          <Item label="Open quotes">{String(openQuotes)}</Item>
        </div>
        {c.notes && <p className="whitespace-pre-wrap rounded bg-page px-4 py-2 text-sm">{c.notes}</p>}
      </section>

      <CustomerSites customerId={id} sites={sites} regionLabel={entity.id === "AUS" ? "State" : "Region"} />

      <section className="grid gap-2">
        <h2 className="font-medium">Quotes & orders</h2>
        <DataTable
          columns={columns}
          rows={orders.map((o) => ({
            id: o.id,
            href: `/sell/${o.status === "quote" ? "quotes" : "orders"}/${o.id}`,
            orderDate: o.orderDate,
            order: o.title ? `${o.number} / ${o.title}` : o.number,
            type: o.status === "quote" ? "Quote" : "Sales order",
            status: ORDER_STATUS[o.status === "quote" ? (o.quoteStatus ?? "draft") : o.status].label,
            total: Math.round(toEntity(o) * 100) / 100,
            customerReference: o.customerReference,
          }))}
          currency={entity.currency}
          exportName={`customer-orders-${(c.code ?? c.name).replace(/\W+/g, "-")}`}
          noun="quotes & orders"
        />
        <p className="text-xs text-muted">Katana order history (completed orders before the switch) is still in the Excel workbook history sheets.</p>
      </section>
    </div>
  );
}
