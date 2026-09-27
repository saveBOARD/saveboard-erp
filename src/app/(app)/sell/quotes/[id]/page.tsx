import clsx from "clsx";
import { and, asc, eq } from "drizzle-orm";
import { ArrowLeft, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db, t } from "@/db";
import { getEntityContext } from "@/lib/dal";

export const metadata: Metadata = { title: "Quote · saveBOARD ERP" };

const money = (n: number | string, currency: string) =>
  `${Number(n).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
const qtyFmt = (n: number | string) => Number(n).toLocaleString("en-NZ", { maximumFractionDigits: 4 });
const pct = (n: number | string) => `${(Number(n) * 100).toLocaleString("en-NZ", { maximumFractionDigits: 2 })}%`;

const STATUS: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-pending text-ink" },
  sent: { label: "Sent", className: "bg-pending text-ink" },
  accepted: { label: "Accepted", className: "bg-ok text-white" },
  declined: { label: "Declined", className: "bg-bad text-white" },
  expired: { label: "Expired", className: "bg-pending text-muted" },
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-sm">{children || <span className="text-muted">—</span>}</span>
    </div>
  );
}

export default async function QuotePage(props: PageProps<"/sell/quotes/[id]">) {
  const { id } = await props.params;
  const { entity } = await getEntityContext();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const [quote] = await db
    .select({ o: t.salesOrders, customer: t.customers })
    .from(t.salesOrders)
    .innerJoin(t.customers, eq(t.customers.id, t.salesOrders.customerId))
    .where(and(eq(t.salesOrders.id, id), eq(t.salesOrders.entityId, entity.id), eq(t.salesOrders.status, "quote")));
  if (!quote) notFound();
  const { o, customer } = quote;

  const lines = await db
    .select({ l: t.orderLines, uom: t.products.uom, productName: t.products.name })
    .from(t.orderLines)
    .leftJoin(t.products, eq(t.products.id, t.orderLines.productId))
    .where(eq(t.orderLines.orderId, o.id))
    .orderBy(asc(t.orderLines.lineNo));

  const status = STATUS[o.quoteStatus ?? "draft"];
  const shipTo = [o.shipToName, o.shipToLine1, o.shipToLine2, [o.shipToCity, o.shipToRegion, o.shipToPostcode].filter(Boolean).join(" "), o.shipToCountry]
    .filter(Boolean)
    .join(", ");
  const billTo = [customer.billingLine1, customer.billingLine2, [customer.billingCity, customer.billingRegion, customer.billingPostcode].filter(Boolean).join(" "), customer.billingCountry]
    .filter(Boolean)
    .join(", ");
  const unlinked = lines.filter((x) => x.l.sku && !x.l.productId).length;

  return (
    <div className="mx-auto grid max-w-6xl gap-4">
      <div className="no-print">
        <Link href="/sell/quotes" className="inline-flex items-center gap-1 text-sm text-link hover:underline">
          <ArrowLeft className="h-4 w-4" /> Quotes
        </Link>
      </div>

      <section className="grid gap-4 rounded border border-line bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted">Quote</div>
            <h1 className="text-2xl font-medium">
              {o.number}
              {o.title && <span className="text-muted"> / {o.title}</span>}
            </h1>
          </div>
          <span className={clsx("rounded px-4 py-1.5 text-sm font-medium", status.className)}>{status.label}</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Customer">{customer.name}</Field>
          <Field label="Customer reference">{o.customerReference}</Field>
          <Field label="Created">{o.orderDate}</Field>
          <Field label="Delivery deadline">{o.deliveryDeadline}</Field>
          <Field label="Bill to">{billTo}</Field>
          <Field label="Ship to">{shipTo}</Field>
          <Field label="Currency">
            {o.currency}
            {o.currency !== entity.currency && ` (1 ${o.currency} = ${Number(o.fxRate)} ${entity.currency} · total ${money(Number(o.total) * Number(o.fxRate), entity.currency)})`}
          </Field>
          <Field label="Source">{o.source === "katana" ? "Imported from Katana" : "saveBOARD ERP"}</Field>
        </div>
      </section>

      {unlinked > 0 && (
        <p className="flex items-center gap-2 rounded border border-warn/40 bg-[#fff6e0] px-4 py-2 text-sm">
          <TriangleAlert className="h-4 w-4 text-warn" />
          {unlinked} line{unlinked > 1 ? "s use SKUs" : " uses a SKU"} that isn&apos;t in the product list (highlighted). Add the product,
          or change the line, before converting this quote to an order.
        </p>
      )}

      <section className="overflow-x-auto rounded border border-line bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted">
              <th className="border-b border-line px-3 py-2 font-normal">#</th>
              <th className="border-b border-line px-3 py-2 font-normal">Item</th>
              <th className="border-b border-line px-3 py-2 text-right font-normal">Quantity</th>
              <th className="border-b border-line px-3 py-2 text-right font-normal">Price per unit</th>
              <th className="border-b border-line px-3 py-2 text-right font-normal">Discount</th>
              <th className="border-b border-line px-3 py-2 text-right font-normal">Total ex GST</th>
              <th className="border-b border-line px-3 py-2 text-right font-normal">GST</th>
            </tr>
          </thead>
          <tbody>
            {lines.map(({ l, uom }) => (
              <tr key={l.id} className={clsx(l.sku && !l.productId && "bg-[#fff6e0]")}>
                <td className="border-b border-line px-3 py-2 text-muted">{l.lineNo}</td>
                <td className="border-b border-line px-3 py-2">
                  {l.sku && <span className="mr-2 font-mono text-xs text-muted">[{l.sku}]</span>}
                  {l.description}
                </td>
                <td className="border-b border-line px-3 py-2 text-right tabular-nums whitespace-nowrap">
                  {qtyFmt(l.qty)} {uom}
                </td>
                <td className="border-b border-line px-3 py-2 text-right tabular-nums whitespace-nowrap">{money(l.unitPrice, o.currency)}</td>
                <td className="border-b border-line px-3 py-2 text-right tabular-nums">{pct(l.discountPct)}</td>
                <td className="border-b border-line px-3 py-2 text-right tabular-nums whitespace-nowrap">{money(l.lineSubtotal, o.currency)}</td>
                <td className="border-b border-line px-3 py-2 text-right tabular-nums">{pct(l.taxRate)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5} className="px-3 pt-3 text-right text-muted">Subtotal</td>
              <td className="px-3 pt-3 text-right tabular-nums whitespace-nowrap">{money(o.subtotal, o.currency)}</td>
              <td />
            </tr>
            <tr>
              <td colSpan={5} className="px-3 text-right text-muted">GST</td>
              <td className="px-3 text-right tabular-nums whitespace-nowrap">{money(o.tax, o.currency)}</td>
              <td />
            </tr>
            <tr className="font-bold">
              <td colSpan={5} className="px-3 pb-3 text-right">Total</td>
              <td className="px-3 pb-3 text-right tabular-nums whitespace-nowrap">{money(o.total, o.currency)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </section>

      {o.notes && (
        <section className="rounded border border-line bg-surface p-5">
          <h2 className="mb-1 text-xs uppercase tracking-wide text-muted">Notes</h2>
          <p className="whitespace-pre-wrap text-sm">{o.notes}</p>
        </section>
      )}

      <p className="no-print text-xs text-muted">
        Editing, the customer PDF and one-click conversion to a sales order are the next part of Phase 2.
      </p>
    </div>
  );
}
