import { and, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import type { Metadata } from "next";
import { InvoicingList, type InvoiceRow, type InvoicingMode } from "@/components/invoicing-list";
import { ListHeader } from "@/components/list-header";
import { db, t } from "@/db";
import { getEntityContext } from "@/lib/dal";
import { XERO_SETTINGS } from "@/lib/invoicing/xero";
import { entityToday } from "@/lib/queries/stock-items";
import { getConnection } from "@/lib/xero/client";

export const metadata: Metadata = { title: "Invoicing · saveBOARD ERP" };

const TABS: { label: string; value: InvoicingMode }[] = [
  { label: "To invoice", value: "to_invoice" },
  { label: "Invoiced", value: "invoiced" },
  { label: "Credit notes", value: "credits" },
  { label: "Credited", value: "credited" },
];

async function orderRows(entityId: string, entityCurrency: string, invoiced: boolean): Promise<InvoiceRow[]> {
  const o = t.salesOrders;
  const rows = await db
    .select({
      id: o.id,
      number: o.number,
      title: o.title,
      customer: t.customers.name,
      reference: o.customerReference,
      shippedOn: sql<string | null>`(select max(s.shipped_on)::text from shipments s where s.order_id = ${o.id} and s.reversed_at is null)`,
      invoicedOn: o.invoicedOn,
      dueOn: o.invoiceDueOn,
      subtotal: o.subtotal,
      currency: o.currency,
      xeroInvoiceId: o.xeroInvoiceId,
      xeroStatus: o.xeroStatus,
      xeroAmountDue: o.xeroAmountDue,
      zeroRated: sql<boolean>`not exists (select 1 from order_lines l where l.order_id = ${o.id} and l.tax_rate > 0 and l.product_id is not null)`,
    })
    .from(o)
    .innerJoin(t.customers, eq(t.customers.id, o.customerId))
    .where(
      and(
        eq(o.entityId, entityId),
        invoiced
          ? or(eq(o.status, "invoiced"), and(inArray(o.status, ["open", "picked"]), isNotNull(o.invoicedOn)))
          : and(eq(o.status, "shipped"), isNull(o.invoicedOn)),
      ),
    )
    .orderBy(invoiced ? desc(o.invoicedOn) : o.number, desc(o.number))
    .limit(invoiced ? 300 : 1000);
  return rows.map((r) => ({
    id: r.id,
    href: `/sell/orders/${r.id}`,
    number: r.number,
    title: r.title,
    customer: r.customer,
    reference: r.reference,
    eventOn: r.shippedOn ?? (invoiced ? "Not shipped yet" : null),
    invoicedOn: r.invoicedOn,
    dueOn: r.dueOn,
    total: Number(r.subtotal),
    currency: r.currency,
    export: r.zeroRated && r.currency !== entityCurrency,
    inXero: !!r.xeroInvoiceId,
    xeroStatus: r.xeroStatus,
    amountDue: r.xeroAmountDue === null ? null : Number(r.xeroAmountDue),
  }));
}

async function returnRows(entityId: string, credited: boolean): Promise<InvoiceRow[]> {
  const r = t.salesReturns;
  const rows = await db
    .select({
      id: r.id,
      number: r.number,
      so: t.salesOrders.number,
      customer: t.customers.name,
      reference: t.salesOrders.customerReference,
      returnDate: r.returnDate,
      receivedOn: r.receivedOn,
      creditedOn: r.creditedOn,
      subtotal: r.subtotal,
      currency: r.currency,
      xeroCreditNoteId: r.xeroCreditNoteId,
      xeroStatus: r.xeroStatus,
    })
    .from(r)
    .innerJoin(t.salesOrders, eq(t.salesOrders.id, r.orderId))
    .innerJoin(t.customers, eq(t.customers.id, r.customerId))
    .where(and(eq(r.entityId, entityId), ne(r.status, "cancelled"), credited ? isNotNull(r.creditedOn) : isNull(r.creditedOn)))
    .orderBy(credited ? desc(r.creditedOn) : r.returnDate, desc(r.number))
    .limit(credited ? 300 : 1000);
  return rows.map((x) => ({
    id: x.id,
    href: `/sell/returns/${x.id}`,
    number: x.number,
    title: x.so,
    customer: x.customer,
    reference: x.reference,
    eventOn: x.receivedOn ?? `${x.returnDate} (awaiting goods)`,
    invoicedOn: x.creditedOn,
    dueOn: null,
    total: Number(x.subtotal),
    currency: x.currency,
    export: false,
    inXero: !!x.xeroCreditNoteId,
    xeroStatus: x.xeroStatus,
    amountDue: null,
  }));
}

/** Shipped orders ready to invoice and returns ready to credit, as Xero import files (one sales order = one invoice). */
export default async function InvoicingPage(props: PageProps<"/sell/invoicing">) {
  const { entity } = await getEntityContext();
  const sp = await props.searchParams;
  const mode = TABS.find((x) => x.value === sp.tab)?.value ?? "to_invoice";
  const [rows, conn] = await Promise.all([
    mode === "to_invoice" || mode === "invoiced" ? orderRows(entity.id, entity.currency, mode === "invoiced") : returnRows(entity.id, mode === "credited"),
    getConnection(entity.id),
  ]);
  const x = XERO_SETTINGS[entity.id];

  return (
    <>
      <ListHeader
        tabs={TABS.map((tab) => ({ label: tab.label, href: tab.value === "to_invoice" ? "/sell/invoicing" : `/sell/invoicing?tab=${tab.value}`, active: tab.value === mode }))}
        note={conn ? `Connected to Xero: ${conn.tenantName}` : "Xero not connected — invoices go by import file (Settings → Xero)"}
      />
      <InvoicingList mode={mode} today={entityToday(entity.id)} entityCurrency={entity.currency} rows={rows} xeroOrg={conn?.tenantName ?? null} />
      {conn && (
        <p className="mt-3 text-sm text-muted">
          Sending creates <b>draft</b> invoices and credit notes in {conn.tenantName}, numbered SO-… / RET-…, account {x.accountCode}; approve them in Xero. Payments are read
          back every morning (or Settings → Xero → Refresh payments now); a paid invoice closes its order.
        </p>
      )}
      <section className={conn ? "mt-4 hidden" : "mt-4 grid gap-1 rounded border border-line bg-surface p-4 text-sm"}>
        <h2 className="font-medium">Importing into Xero ({entity.id} organisation)</h2>
        <ol className="ml-5 list-decimal text-muted">
          <li>In Xero: Business → Invoices → Import.</li>
          <li>Choose the downloaded file and set <b>Unit amounts are: Tax exclusive</b>.</li>
          <li>
            Invoices come in as drafts numbered with the SO number, account {x.accountCode}, tax &ldquo;{x.taxOnIncome}&rdquo; (&ldquo;{x.taxZeroRated}&rdquo; on zero-rated
            export goods). Check them, then approve.
          </li>
          <li>
            Credit notes use the same import. Their lines have negative quantities, so Xero brings them in as credit notes numbered with the return number (RET-…).
            Allocate each one to its invoice in Xero.
          </li>
          <li>A customer whose name doesn&apos;t exactly match a Xero contact is created as a new contact, so check any new ones.</li>
        </ol>
        <p className="text-muted">Due dates follow the customer&apos;s payment terms (e.g. &ldquo;20th of following month&rdquo;, &ldquo;7 days&rdquo;); if none are set, 30 days.</p>
      </section>
    </>
  );
}
