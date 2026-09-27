import clsx from "clsx";
import { ArrowLeft, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { t } from "@/db";
import { AVAILABILITY_LABEL, type Availability } from "@/lib/queries/availability";

type Order = typeof t.salesOrders.$inferSelect;
type Customer = typeof t.customers.$inferSelect;
type Line = { l: typeof t.orderLines.$inferSelect; uom: string | null };

const money = (n: number | string, currency: string) =>
  `${Number(n).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
const qtyFmt = (n: number | string) => Number(n).toLocaleString("en-NZ", { maximumFractionDigits: 4 });
const pct = (n: number | string) => `${(Number(n) * 100).toLocaleString("en-NZ", { maximumFractionDigits: 2 })}%`;

export const ORDER_STATUS: Record<string, { label: string; className: string }> = {
  // quotes
  draft: { label: "Draft", className: "bg-pending text-ink" },
  sent: { label: "Sent", className: "bg-pending text-ink" },
  accepted: { label: "Accepted", className: "bg-ok text-white" },
  declined: { label: "Declined", className: "bg-bad text-white" },
  expired: { label: "Expired", className: "bg-pending text-muted" },
  // orders
  open: { label: "Open", className: "bg-pending text-ink" },
  picked: { label: "Picked", className: "bg-[#2f6fb0] text-white" },
  shipped: { label: "Shipped", className: "bg-ok text-white" },
  invoiced: { label: "Invoiced", className: "bg-ok text-white" },
  closed: { label: "Closed", className: "bg-ok text-white" },
  cancelled: { label: "Cancelled", className: "bg-bad text-white" },
};

const AVAILABILITY_CLASS: Record<Availability, string> = {
  in_stock: "bg-ok text-white",
  not_available: "bg-bad text-white",
  not_tracked: "text-muted",
  shipped: "bg-[#2f6fb0] text-white",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-sm">{children || <span className="text-muted">—</span>}</span>
    </div>
  );
}

const address = (parts: (string | null)[]) => parts.filter(Boolean).join(", ");

/** Read-only view of a quote or sales order (header, lines, totals, notes). */
export function OrderView({
  kind,
  order: o,
  customer,
  lines,
  entityCurrency,
  availability,
  backHref,
  actions,
  shipped,
}: {
  kind: "quote" | "order";
  order: Order;
  customer: Customer;
  lines: Line[];
  entityCurrency: string;
  availability?: Map<string, Availability>;
  backHref: string;
  actions?: React.ReactNode;
  /** Quantity shipped per line (sales orders). */
  shipped?: Map<string, number>;
}) {
  const status = ORDER_STATUS[kind === "quote" ? (o.quoteStatus ?? "draft") : o.status];
  const shipTo = address([o.shipToName, o.shipToLine1, o.shipToLine2, [o.shipToCity, o.shipToRegion, o.shipToPostcode].filter(Boolean).join(" "), o.shipToCountry]);
  const billTo = address([customer.billingLine1, customer.billingLine2, [customer.billingCity, customer.billingRegion, customer.billingPostcode].filter(Boolean).join(" "), customer.billingCountry]);
  const unlinked = lines.filter((x) => x.l.sku && !x.l.productId).length;
  const showAvailability = kind === "order" && availability && ["open", "picked"].includes(o.status);

  return (
    <div className="mx-auto grid max-w-6xl gap-4">
      <div className="no-print">
        <Link href={backHref} className="inline-flex items-center gap-1 text-sm text-link hover:underline">
          <ArrowLeft className="h-4 w-4" /> {kind === "quote" ? "Quotes" : "Sales orders"}
        </Link>
      </div>

      <section className="grid gap-4 rounded border border-line bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted">{kind === "quote" ? "Quote" : "Sales order"}</div>
            <h1 className="text-2xl font-medium">
              {o.number}
              {o.title && <span className="text-muted"> / {o.title}</span>}
            </h1>
          </div>
          <span className={clsx("rounded px-4 py-1.5 text-sm font-medium", status.className)}>{status.label}</span>
        </div>
        {actions}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Customer">{customer.name}</Field>
          <Field label="Customer reference">{o.customerReference}</Field>
          <Field label="Created">{o.orderDate}</Field>
          <Field label="Delivery deadline">{o.deliveryDeadline}</Field>
          <Field label="Bill to">{billTo}</Field>
          <Field label="Ship to">{shipTo}</Field>
          <Field label="Currency">
            {o.currency}
            {o.currency !== entityCurrency &&
              ` (1 ${o.currency} = ${Number(o.fxRate)} ${entityCurrency} · total ${money(Number(o.total) * Number(o.fxRate), entityCurrency)})`}
          </Field>
          <Field label="Source">{o.source === "katana" ? "Imported from Katana" : "saveBOARD ERP"}</Field>
        </div>
      </section>

      {unlinked > 0 && (
        <p className="flex items-center gap-2 rounded border border-warn/40 bg-[#fff6e0] px-4 py-2 text-sm">
          <TriangleAlert className="h-4 w-4 text-warn" />
          {unlinked} line{unlinked > 1 ? "s use SKUs" : " uses a SKU"} that isn&apos;t in the product list (highlighted), so
          {unlinked > 1 ? " their" : " its"} stock can&apos;t be checked. Add the product to fix this.
        </p>
      )}

      <section className="overflow-x-auto rounded border border-line bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted">
              <th className="border-b border-line px-3 py-2 font-normal">#</th>
              <th className="border-b border-line px-3 py-2 font-normal">Item</th>
              <th className="border-b border-line px-3 py-2 text-right font-normal">Quantity</th>
              {shipped && <th className="border-b border-line px-3 py-2 text-right font-normal">Shipped</th>}
              <th className="border-b border-line px-3 py-2 text-right font-normal">Price per unit</th>
              <th className="border-b border-line px-3 py-2 text-right font-normal">Discount</th>
              <th className="border-b border-line px-3 py-2 text-right font-normal">Total ex GST</th>
              <th className="border-b border-line px-3 py-2 text-right font-normal">GST</th>
              {showAvailability && <th className="border-b border-line px-3 py-2 text-center font-normal">Stock</th>}
            </tr>
          </thead>
          <tbody>
            {lines.map(({ l, uom }) => {
              const a = availability?.get(l.id) ?? "not_tracked";
              return (
                <tr key={l.id} className={clsx(l.sku && !l.productId && "bg-[#fff6e0]")}>
                  <td className="border-b border-line px-3 py-2 text-muted">{l.lineNo}</td>
                  <td className="border-b border-line px-3 py-2">
                    {l.sku && <span className="mr-2 font-mono text-xs text-muted">[{l.sku}]</span>}
                    {l.description}
                  </td>
                  <td className="border-b border-line px-3 py-2 text-right tabular-nums whitespace-nowrap">
                    {qtyFmt(l.qty)} {uom}
                  </td>
                  {shipped && (
                    <td
                      className={clsx(
                        "border-b border-line px-3 py-2 text-right tabular-nums whitespace-nowrap",
                        (shipped.get(l.id) ?? 0) >= Number(l.qty) - 1e-9 ? "text-ok" : (shipped.get(l.id) ?? 0) > 0 ? "text-warn" : "text-muted",
                      )}
                    >
                      {qtyFmt(shipped.get(l.id) ?? 0)}
                    </td>
                  )}
                  <td className="border-b border-line px-3 py-2 text-right tabular-nums whitespace-nowrap">{money(l.unitPrice, o.currency)}</td>
                  <td className="border-b border-line px-3 py-2 text-right tabular-nums">{pct(l.discountPct)}</td>
                  <td className="border-b border-line px-3 py-2 text-right tabular-nums whitespace-nowrap">{money(l.lineSubtotal, o.currency)}</td>
                  <td className="border-b border-line px-3 py-2 text-right tabular-nums">{pct(l.taxRate)}</td>
                  {showAvailability && (
                    <td className={clsx("border-b border-line px-3 py-2 text-center whitespace-nowrap", AVAILABILITY_CLASS[a])}>
                      {AVAILABILITY_LABEL[a]}
                      {a === "not_available" && l.productId && (
                        <Link
                          href={`/make/orders/new?product=${l.productId}&qty=${Math.max(0, Number(l.qty) - (shipped?.get(l.id) ?? 0))}&so=${o.id}`}
                          className="no-print ml-2 rounded bg-white/90 px-1.5 py-0.5 text-xs text-link hover:underline"
                          title="Create a manufacturing order for this line"
                        >
                          Make
                        </Link>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            {[
              ["Subtotal", o.subtotal],
              ["GST", o.tax],
            ].map(([label, v]) => (
              <tr key={label}>
                <td colSpan={shipped ? 6 : 5} className="px-3 pt-2 text-right text-muted">{label}</td>
                <td className="px-3 pt-2 text-right tabular-nums whitespace-nowrap">{money(v, o.currency)}</td>
              </tr>
            ))}
            <tr className="font-bold">
              <td colSpan={shipped ? 6 : 5} className="px-3 pt-1 pb-3 text-right">Total</td>
              <td className="px-3 pt-1 pb-3 text-right tabular-nums whitespace-nowrap">{money(o.total, o.currency)}</td>
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
    </div>
  );
}
