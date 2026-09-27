"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createReturn } from "@/app/(app)/sell/returns/actions";

export type ReturnableLine = {
  id: string;
  lineNo: number;
  sku: string | null;
  description: string;
  uom: string | null;
  returnable: number; // shipped - already returned
  netPrice: number; // unit price after the order line's discount, ex tax
  taxRate: number;
  isStock: boolean;
  batches: string[];
};
type Row = { qty: string; price: string; restock: boolean; reason: string; batch: string };

export const RETURN_REASONS = ["Damaged in transit", "Faulty / quality", "Wrong item sent", "Ordered too many", "No longer needed", "Other"];

const fmt = (n: number) => n.toLocaleString("en-NZ", { maximumFractionDigits: 4 });
const money = (n: number, c: string) => `${n.toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}`;

export function ReturnForm({
  order,
  lines,
  today,
}: {
  order: { id: string; number: string; customer: string; currency: string };
  lines: ReturnableLine[];
  today: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [returnDate, setReturnDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(lines.map((l) => [l.id, { qty: "", price: String(l.netPrice), restock: l.isStock, reason: "", batch: l.batches.length === 1 ? l.batches[0] : "" }])),
  );
  const set = (id: string, patch: Partial<Row>) => setRows((rs) => ({ ...rs, [id]: { ...rs[id], ...patch } }));
  const chosen = lines.filter((l) => Number(rows[l.id].qty) > 0);
  const subtotal = chosen.reduce((s, l) => s + Number(rows[l.id].qty) * (Number(rows[l.id].price) || 0), 0);
  const tax = chosen.reduce((s, l) => s + Number(rows[l.id].qty) * (Number(rows[l.id].price) || 0) * l.taxRate, 0);

  function submit() {
    setError(null);
    if (!chosen.length) return setError("Enter a quantity being returned on at least one line.");
    for (const l of chosen) if (Number(rows[l.id].qty) > l.returnable + 1e-9) return setError(`Line ${l.lineNo}: only ${fmt(l.returnable)} can be returned.`);
    startTransition(async () => {
      const res = await createReturn({
        orderId: order.id,
        returnDate,
        notes: notes || null,
        lines: chosen.map((l) => ({
          orderLineId: l.id,
          qty: Number(rows[l.id].qty),
          unitPrice: Number(rows[l.id].price) || 0,
          restock: rows[l.id].restock,
          reason: rows[l.id].reason || null,
          batchNo: rows[l.id].batch || null,
        })),
      });
      if (res.error) return setError(res.error);
      router.push(`/sell/returns/${res.id}`);
      router.refresh();
    });
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-4">
      <datalist id="return-reasons">
        {RETURN_REASONS.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
      <section className="grid gap-4 rounded border border-line bg-surface p-5">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted">New return</div>
          <h1 className="text-2xl font-medium">
            {order.number} <span className="text-base text-muted">{order.customer}</span>
          </h1>
          <p className="text-sm text-muted">
            Enter what the customer is sending back. Stock only goes back in when you mark the return received. The credit note goes to Xero from the
            Invoicing page.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="grid gap-1 text-xs text-muted">
            Return date
            <input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} className="input text-sm text-ink" />
          </label>
          <label className="grid gap-1 text-xs text-muted sm:col-span-2">
            Notes
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className="input text-sm text-ink" placeholder="e.g. collected by our truck 3 Oct" />
          </label>
        </div>
      </section>

      <section className="overflow-x-auto rounded border border-line bg-surface">
        <table className="w-full min-w-[1000px] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="border-b border-line px-3 py-2 font-normal">#</th>
              <th className="border-b border-line px-3 py-2 font-normal">Item</th>
              <th className="border-b border-line px-3 py-2 text-right font-normal">Can return</th>
              <th className="w-28 border-b border-line px-3 py-2 text-right font-normal">Returning</th>
              <th className="w-32 border-b border-line px-3 py-2 text-right font-normal">Credit per unit ({order.currency})</th>
              <th className="w-20 border-b border-line px-3 py-2 text-center font-normal">Restock</th>
              <th className="w-44 border-b border-line px-3 py-2 font-normal">Reason</th>
              <th className="w-36 border-b border-line px-3 py-2 font-normal">Batch</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const r = rows[l.id];
              const none = l.returnable <= 1e-9;
              return (
                <tr key={l.id} className={none ? "text-muted" : ""}>
                  <td className="border-b border-line px-3 py-2">{l.lineNo}</td>
                  <td className="border-b border-line px-3 py-2">
                    {l.sku && <span className="mr-1 font-mono text-xs text-muted">[{l.sku}]</span>}
                    {l.description}
                  </td>
                  <td className="border-b border-line px-3 py-2 text-right tabular-nums whitespace-nowrap">
                    {fmt(l.returnable)} {l.uom}
                  </td>
                  {none ? (
                    <td colSpan={5} className="border-b border-line px-3 py-2 text-xs">
                      Nothing shipped left to return
                    </td>
                  ) : (
                    <>
                      <td className="border-b border-line px-3 py-1.5">
                        <input aria-label={`Line ${l.lineNo} quantity returned`} type="number" min="0" step="any" value={r.qty} onChange={(e) => set(l.id, { qty: e.target.value })} className="input w-full text-right" />
                      </td>
                      <td className="border-b border-line px-3 py-1.5">
                        <input aria-label={`Line ${l.lineNo} credit per unit`} type="number" min="0" step="any" value={r.price} onChange={(e) => set(l.id, { price: e.target.value })} className="input w-full text-right" />
                      </td>
                      <td className="border-b border-line px-3 py-1.5 text-center">
                        {l.isStock ? (
                          <input
                            type="checkbox"
                            aria-label={`Line ${l.lineNo} restock`}
                            title="Untick for damaged goods that won't go back into stock"
                            checked={r.restock}
                            onChange={(e) => set(l.id, { restock: e.target.checked })}
                          />
                        ) : (
                          <span className="text-xs text-muted">—</span>
                        )}
                      </td>
                      <td className="border-b border-line px-3 py-1.5">
                        <input aria-label={`Line ${l.lineNo} reason`} list="return-reasons" value={r.reason} onChange={(e) => set(l.id, { reason: e.target.value })} className="input w-full" />
                      </td>
                      <td className="border-b border-line px-3 py-1.5">
                        <input
                          aria-label={`Line ${l.lineNo} batch`}
                          list={`batches-${l.id}`}
                          value={r.batch}
                          onChange={(e) => set(l.id, { batch: e.target.value })}
                          className="input w-full font-mono"
                          placeholder={l.isStock ? "Optional" : "—"}
                        />
                        <datalist id={`batches-${l.id}`}>
                          {l.batches.map((b) => (
                            <option key={b} value={b} />
                          ))}
                        </datalist>
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-3 border-t border-line bg-page/95 py-3">
        {error ? (
          <p role="alert" className="mr-auto text-sm text-bad">{error}</p>
        ) : (
          <p className="mr-auto text-sm">
            Credit <b>{money(subtotal, order.currency)}</b> + GST {money(tax, order.currency)} = <b>{money(subtotal + tax, order.currency)}</b>
            <span className="text-muted"> · untick Restock for damaged goods (credit only, no stock back)</span>
          </p>
        )}
        <Link href={`/sell/orders/${order.id}`} className="btn-secondary">
          Cancel
        </Link>
        <button type="button" onClick={submit} disabled={pending} className="btn-primary">
          {pending ? "Saving…" : "Create return"}
        </button>
      </div>
    </div>
  );
}
