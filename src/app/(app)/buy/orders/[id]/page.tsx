import clsx from "clsx";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { POActions } from "@/components/po-actions";
import { ReceiptsPanel } from "@/components/receipts-panel";
import { getEntityContext } from "@/lib/dal";
import { PO_STATUS_LABEL, RECEIVE_LABEL, receiveState, receivedByLine } from "@/lib/purchasing/received";
import { getPO } from "@/lib/queries/purchase-order";

export const metadata: Metadata = { title: "Purchase order · saveBOARD ERP" };

const money = (n: number | string, c: string) => `${Number(n).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}`;
const qtyFmt = (n: number | string) => Number(n).toLocaleString("en-NZ", { maximumFractionDigits: 4 });
const pct = (n: number | string) => `${(Number(n) * 100).toLocaleString("en-NZ", { maximumFractionDigits: 2 })}%`;
const STATUS_CLASS: Record<string, string> = { draft: "bg-pending text-ink", open: "bg-[#2f6fb0] text-white", received: "bg-ok text-white", cancelled: "bg-bad text-white" };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-sm">{children || <span className="text-muted">—</span>}</span>
    </div>
  );
}

export default async function POPage(props: PageProps<"/buy/orders/[id]">) {
  const { id } = await props.params;
  const { entity } = await getEntityContext();
  const tz = entity.id === "AUS" ? "Australia/Sydney" : "Pacific/Auckland";
  const found = await getPO(entity.id, id, tz);
  if (!found) notFound();
  const { po, supplier, lines, receipts } = found;
  const received = await receivedByLine([id]);
  const delivery = RECEIVE_LABEL[receiveState(lines.map(({ l }) => ({ id: l.id, qty: Number(l.qty) })), received)];

  return (
    <div className="mx-auto grid max-w-6xl gap-4">
      <Link href="/buy/orders" className="no-print inline-flex items-center gap-1 text-sm text-link hover:underline">
        <ArrowLeft className="h-4 w-4" /> Purchase orders
      </Link>
      <section className="grid gap-4 rounded border border-line bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted">Purchase order</div>
            <h1 className="text-2xl font-medium">
              {po.number}
              {po.title && <span className="text-muted"> / {po.title}</span>}
            </h1>
          </div>
          <div className="flex gap-2">
            {po.status === "open" && <span className="rounded bg-pending px-3 py-1.5 text-sm">{delivery}</span>}
            <span className={clsx("rounded px-3 py-1.5 text-sm", po.billed ? "bg-ok text-white" : "bg-pending")}>{po.billed ? "Billed" : "Not billed"}</span>
            <span className={clsx("rounded px-4 py-1.5 text-sm font-medium", STATUS_CLASS[po.status])}>{PO_STATUS_LABEL[po.status]}</span>
          </div>
        </div>
        <POActions id={id} status={po.status} billed={po.billed} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Supplier">
            <Link href={`/buy/suppliers/${supplier.id}`} className="text-link hover:underline">
              {supplier.name}
            </Link>
          </Field>
          <Field label="Created">{po.orderDate}</Field>
          <Field label="Expected arrival">{po.expectedOn}</Field>
          <Field label="Receiving location">{entity.locationName}</Field>
          <Field label="Currency">
            {po.currency}
            {po.currency !== entity.currency && ` (1 ${po.currency} = ${Number(po.fxRate)} ${entity.currency} · total ${money(Number(po.total) * Number(po.fxRate), entity.currency)})`}
          </Field>
          <Field label="Supplier contact">{[supplier.contactName, supplier.email, supplier.phone].filter(Boolean).join(" · ")}</Field>
        </div>
      </section>

      <section className="overflow-x-auto rounded border border-line bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted">
              <th className="border-b border-line px-3 py-2 font-normal">#</th>
              <th className="border-b border-line px-3 py-2 font-normal">Item</th>
              <th className="border-b border-line px-3 py-2 text-right font-normal">Quantity</th>
              <th className="border-b border-line px-3 py-2 text-right font-normal">Received</th>
              <th className="border-b border-line px-3 py-2 text-right font-normal">Price per unit</th>
              <th className="border-b border-line px-3 py-2 text-right font-normal">Total ex GST</th>
              <th className="border-b border-line px-3 py-2 text-right font-normal">GST</th>
            </tr>
          </thead>
          <tbody>
            {lines.map(({ l, uom }) => {
              const got = received.get(l.id) ?? 0;
              return (
                <tr key={l.id}>
                  <td className="border-b border-line px-3 py-2 text-muted">{l.lineNo}</td>
                  <td className="border-b border-line px-3 py-2">
                    {l.sku && <span className="mr-2 font-mono text-xs text-muted">[{l.sku}]</span>}
                    {l.description}
                  </td>
                  <td className="border-b border-line px-3 py-2 text-right tabular-nums whitespace-nowrap">
                    {qtyFmt(l.qty)} {uom}
                  </td>
                  <td className={clsx("border-b border-line px-3 py-2 text-right tabular-nums", got >= Number(l.qty) - 1e-9 ? "text-ok" : got > 0 ? "text-warn" : "text-muted")}>{qtyFmt(got)}</td>
                  <td className="border-b border-line px-3 py-2 text-right tabular-nums whitespace-nowrap">{money(l.unitPrice, po.currency)}</td>
                  <td className="border-b border-line px-3 py-2 text-right tabular-nums whitespace-nowrap">{money(l.lineSubtotal, po.currency)}</td>
                  <td className="border-b border-line px-3 py-2 text-right tabular-nums">{pct(l.taxRate)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            {[
              ["Subtotal", po.subtotal],
              ["GST", po.tax],
            ].map(([label, v]) => (
              <tr key={label}>
                <td colSpan={5} className="px-3 pt-2 text-right text-muted">{label}</td>
                <td className="px-3 pt-2 text-right tabular-nums whitespace-nowrap">{money(v, po.currency)}</td>
              </tr>
            ))}
            <tr className="font-bold">
              <td colSpan={5} className="px-3 pt-1 pb-3 text-right">Total</td>
              <td className="px-3 pt-1 pb-3 text-right tabular-nums whitespace-nowrap">{money(po.total, po.currency)}</td>
            </tr>
          </tfoot>
        </table>
      </section>

      {po.notes && (
        <section className="rounded border border-line bg-surface p-5">
          <h2 className="mb-1 text-xs uppercase tracking-wide text-muted">Notes for the supplier</h2>
          <p className="whitespace-pre-wrap text-sm">{po.notes}</p>
        </section>
      )}
      <ReceiptsPanel receipts={receipts} canReverse={po.status === "open" || po.status === "received"} />
    </div>
  );
}
