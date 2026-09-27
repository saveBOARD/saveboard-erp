import clsx from "clsx";
import { and, asc, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ReturnActions } from "@/components/return-actions";
import { db, t } from "@/db";
import { getEntityContext } from "@/lib/dal";
import { entityToday } from "@/lib/queries/stock-items";

export const metadata: Metadata = { title: "Return · saveBOARD ERP" };

const money = (n: number | string, c: string) => `${Number(n).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}`;
const qtyFmt = (n: number | string) => Number(n).toLocaleString("en-NZ", { maximumFractionDigits: 4 });
const pct = (n: number | string) => `${(Number(n) * 100).toLocaleString("en-NZ", { maximumFractionDigits: 2 })}%`;
const STATUS: Record<string, [string, string]> = {
  open: ["Open — awaiting goods", "bg-pending text-ink"],
  received: ["Received", "bg-ok text-white"],
  cancelled: ["Cancelled", "bg-bad text-white"],
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-sm">{children || <span className="text-muted">—</span>}</span>
    </div>
  );
}

export default async function ReturnPage(props: PageProps<"/sell/returns/[id]">) {
  const { id } = await props.params;
  const { entity } = await getEntityContext();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [row] = await db
    .select({ r: t.salesReturns, so: t.salesOrders.number, customer: t.customers.name, customerId: t.customers.id })
    .from(t.salesReturns)
    .innerJoin(t.salesOrders, eq(t.salesOrders.id, t.salesReturns.orderId))
    .innerJoin(t.customers, eq(t.customers.id, t.salesReturns.customerId))
    .where(and(eq(t.salesReturns.id, id), eq(t.salesReturns.entityId, entity.id)));
  if (!row) notFound();
  const { r } = row;
  const lines = await db
    .select({ l: t.returnLines, uom: t.products.uom, trackStock: t.products.trackStock })
    .from(t.returnLines)
    .leftJoin(t.products, eq(t.products.id, t.returnLines.productId))
    .where(eq(t.returnLines.returnId, id))
    .orderBy(asc(t.returnLines.lineNo));
  const [label, cls] = STATUS[r.status];

  return (
    <div className="mx-auto grid max-w-6xl gap-4">
      <Link href="/sell/returns" className="no-print inline-flex items-center gap-1 text-sm text-link hover:underline">
        <ArrowLeft className="h-4 w-4" /> Returns
      </Link>
      <section className="grid gap-4 rounded border border-line bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted">Customer return</div>
            <h1 className="text-2xl font-medium">{r.number}</h1>
          </div>
          <div className="flex gap-2">
            <span className={clsx("rounded px-3 py-1.5 text-sm", r.creditedOn ? "bg-ok text-white" : "bg-pending")}>{r.creditedOn ? `Credited ${r.creditedOn}` : "Not credited"}</span>
            <span className={clsx("rounded px-4 py-1.5 text-sm font-medium", cls)}>{label}</span>
          </div>
        </div>
        <ReturnActions id={id} status={r.status} credited={!!r.creditedOn} today={entityToday(entity.id)} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Customer">
            <Link href={`/sell/customers/${row.customerId}`} className="text-link hover:underline">
              {row.customer}
            </Link>
          </Field>
          <Field label="Sales order">
            <Link href={`/sell/orders/${r.orderId}`} className="text-link hover:underline">
              {row.so}
            </Link>
          </Field>
          <Field label="Return date">{r.returnDate}</Field>
          <Field label="Goods received">{r.receivedOn}</Field>
        </div>
        {r.notes && <p className="whitespace-pre-wrap rounded bg-page px-3 py-2 text-sm">{r.notes}</p>}
      </section>

      <section className="overflow-x-auto rounded border border-line bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted">
              <th className="border-b border-line px-3 py-2 font-normal">#</th>
              <th className="border-b border-line px-3 py-2 font-normal">Item</th>
              <th className="border-b border-line px-3 py-2 text-right font-normal">Quantity</th>
              <th className="border-b border-line px-3 py-2 font-normal">Stock</th>
              <th className="border-b border-line px-3 py-2 font-normal">Reason</th>
              <th className="border-b border-line px-3 py-2 font-normal">Batch</th>
              <th className="border-b border-line px-3 py-2 text-right font-normal">Credit per unit</th>
              <th className="border-b border-line px-3 py-2 text-right font-normal">Total ex GST</th>
              <th className="border-b border-line px-3 py-2 text-right font-normal">GST</th>
            </tr>
          </thead>
          <tbody>
            {lines.map(({ l, uom, trackStock }) => (
              <tr key={l.id}>
                <td className="border-b border-line px-3 py-2 text-muted">{l.lineNo}</td>
                <td className="border-b border-line px-3 py-2">
                  {l.sku && <span className="mr-2 font-mono text-xs text-muted">[{l.sku}]</span>}
                  {l.description}
                </td>
                <td className="border-b border-line px-3 py-2 text-right tabular-nums whitespace-nowrap">
                  {qtyFmt(l.qty)} {uom}
                </td>
                <td className="border-b border-line px-3 py-2 text-xs">
                  {!l.productId || !trackStock ? <span className="text-muted">Not a stock item</span> : l.restock ? "Back into stock" : <span className="text-warn">Not restocked (write-off)</span>}
                </td>
                <td className="border-b border-line px-3 py-2">{l.reason}</td>
                <td className="border-b border-line px-3 py-2 font-mono text-xs">{l.batchNo}</td>
                <td className="border-b border-line px-3 py-2 text-right tabular-nums whitespace-nowrap">{money(l.unitPrice, r.currency)}</td>
                <td className="border-b border-line px-3 py-2 text-right tabular-nums whitespace-nowrap">{money(l.lineSubtotal, r.currency)}</td>
                <td className="border-b border-line px-3 py-2 text-right tabular-nums">{pct(l.taxRate)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {[
              ["Credit subtotal", r.subtotal],
              ["GST", r.tax],
            ].map(([k, v]) => (
              <tr key={k}>
                <td colSpan={7} className="px-3 pt-2 text-right text-muted">{k}</td>
                <td className="px-3 pt-2 text-right tabular-nums whitespace-nowrap">{money(v!, r.currency)}</td>
                <td />
              </tr>
            ))}
            <tr className="font-bold">
              <td colSpan={7} className="px-3 pt-1 pb-3 text-right">Credit total</td>
              <td className="px-3 pt-1 pb-3 text-right tabular-nums whitespace-nowrap">{money(r.total, r.currency)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </section>
    </div>
  );
}
