import { and, desc, eq, sql } from "drizzle-orm";
import type { Metadata } from "next";
import { InvoicingList } from "@/components/invoicing-list";
import { ListHeader } from "@/components/list-header";
import { db, t } from "@/db";
import { getEntityContext } from "@/lib/dal";
import { XERO_SETTINGS } from "@/lib/invoicing/xero";
import { entityToday } from "@/lib/queries/stock-items";

export const metadata: Metadata = { title: "Invoicing · saveBOARD ERP" };

/** Shipped orders ready to invoice, and the Xero import file (one sales order = one invoice). */
export default async function InvoicingPage(props: PageProps<"/sell/invoicing">) {
  const { entity } = await getEntityContext();
  const sp = await props.searchParams;
  const mode = sp.tab === "invoiced" ? "invoiced" : "to_invoice";
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
      zeroRated: sql<boolean>`not exists (select 1 from order_lines l where l.order_id = ${o.id} and l.tax_rate > 0 and l.product_id is not null)`,
    })
    .from(o)
    .innerJoin(t.customers, eq(t.customers.id, o.customerId))
    .where(and(eq(o.entityId, entity.id), eq(o.status, mode === "invoiced" ? "invoiced" : "shipped")))
    .orderBy(mode === "invoiced" ? desc(o.invoicedOn) : o.number, desc(o.number))
    .limit(mode === "invoiced" ? 300 : 1000);
  const x = XERO_SETTINGS[entity.id];

  return (
    <>
      <ListHeader
        tabs={[
          { label: "To invoice", href: "/sell/invoicing", active: mode === "to_invoice" },
          { label: "Invoiced", href: "/sell/invoicing?tab=invoiced", active: mode === "invoiced" },
        ]}
      />
      <InvoicingList
        mode={mode}
        today={entityToday(entity.id)}
        entityCurrency={entity.currency}
        rows={rows.map((r) => ({
          id: r.id,
          number: r.number,
          title: r.title,
          customer: r.customer,
          reference: r.reference,
          shippedOn: r.shippedOn,
          invoicedOn: r.invoicedOn,
          dueOn: r.dueOn,
          total: Number(r.subtotal),
          currency: r.currency,
          export: r.zeroRated && r.currency !== entity.currency,
        }))}
      />
      <section className="mt-4 grid gap-1 rounded border border-line bg-surface p-4 text-sm">
        <h2 className="font-medium">Importing into Xero ({entity.id} organisation)</h2>
        <ol className="ml-5 list-decimal text-muted">
          <li>In Xero: Business → Invoices → Import.</li>
          <li>Choose the downloaded file and set <b>Unit amounts are: Tax exclusive</b>.</li>
          <li>
            Invoices come in as drafts numbered with the SO number, account {x.accountCode}, tax &ldquo;{x.taxOnIncome}&rdquo; (&ldquo;{x.taxZeroRated}&rdquo; on zero-rated
            export goods). Check them, then approve.
          </li>
          <li>A customer whose name doesn&apos;t exactly match a Xero contact is created as a new contact, so check any new ones.</li>
        </ol>
        <p className="text-muted">Due dates follow the customer&apos;s payment terms (e.g. &ldquo;20th of following month&rdquo;, &ldquo;7 days&rdquo;); if none are set, 30 days.</p>
      </section>
    </>
  );
}
