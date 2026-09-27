"use client";

import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createShipment } from "@/app/(app)/sell/actions";

export type ShipLine = {
  id: string;
  lineNo: number;
  sku: string | null;
  description: string;
  uom: string | null;
  ordered: number;
  shipped: number;
  trackStock: boolean;
  suggestedBatch: string | null;
};

type Row = { key: string; lineId: string; qty: string; batch: string };
const newKey = () => Math.random().toString(36).slice(2);
const fmt = (n: number) => n.toLocaleString("en-NZ", { maximumFractionDigits: 4 });

export function ShipForm({ orderId, orderNumber, nextSeq, lines, today }: { orderId: string; orderNumber: string; nextSeq: number; lines: ShipLine[]; today: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [shippedOn, setShippedOn] = useState(today);
  const [carrier, setCarrier] = useState("");
  const [consignmentNo, setConsignmentNo] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<Row[]>(() =>
    lines
      .filter((l) => l.ordered - l.shipped > 1e-9)
      .map((l) => ({ key: newKey(), lineId: l.id, qty: String(l.ordered - l.shipped), batch: l.suggestedBatch ?? "" })),
  );

  const outstanding = (lineId: string) => {
    const l = lines.find((x) => x.id === lineId)!;
    return l.ordered - l.shipped;
  };
  const sendingFor = (lineId: string) => rows.filter((r) => r.lineId === lineId).reduce((s, r) => s + (Number(r.qty) || 0), 0);
  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  function addBatch(lineId: string) {
    const left = Math.max(0, outstanding(lineId) - sendingFor(lineId));
    setRows((rs) => {
      const idx = rs.map((r) => r.lineId).lastIndexOf(lineId);
      const copy = [...rs];
      copy.splice(idx + 1, 0, { key: newKey(), lineId, qty: String(left), batch: "" });
      return copy;
    });
  }

  function submit() {
    setError(null);
    const send = rows.filter((r) => Number(r.qty) > 0);
    if (!send.length) return setError("Enter a quantity to ship on at least one line.");
    for (const l of lines) {
      if (sendingFor(l.id) > outstanding(l.id) + 1e-9) return setError(`Line ${l.lineNo}: you're shipping more than the ${fmt(outstanding(l.id))} outstanding.`);
    }
    startTransition(async () => {
      const res = await createShipment({
        orderId,
        shippedOn,
        carrier: carrier || null,
        consignmentNo: consignmentNo || null,
        notes: notes || null,
        lines: send.map((r) => ({ orderLineId: r.lineId, qty: Number(r.qty), batchNo: r.batch || null })),
      });
      if (res.error) return setError(res.error);
      router.push(`/sell/orders/${orderId}`);
      router.refresh();
    });
  }

  const totalSending = lines.reduce((s, l) => s + sendingFor(l.id), 0);
  const fullyShipping = lines.every((l) => l.shipped + sendingFor(l.id) >= l.ordered - 1e-9);

  return (
    <div className="mx-auto grid max-w-5xl gap-4">
      <section className="grid gap-4 rounded border border-line bg-surface p-5">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted">Ship</div>
          <h1 className="text-2xl font-medium">
            {orderNumber}/{nextSeq}
          </h1>
          <p className="text-sm text-muted">Enter what is leaving now. Anything not shipped stays on the order for a later shipment.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-4">
          <label className="grid gap-1 text-xs text-muted">
            Ship date
            <input id="shippedOn" type="date" value={shippedOn} onChange={(e) => setShippedOn(e.target.value)} className="input text-sm text-ink" />
          </label>
          <label className="grid gap-1 text-xs text-muted">
            Carrier
            <input id="carrier" value={carrier} onChange={(e) => setCarrier(e.target.value)} className="input text-sm text-ink" placeholder="e.g. Mainfreight" />
          </label>
          <label className="grid gap-1 text-xs text-muted">
            Consignment number
            <input id="consignmentNo" value={consignmentNo} onChange={(e) => setConsignmentNo(e.target.value)} className="input text-sm text-ink" />
          </label>
          <label className="grid gap-1 text-xs text-muted">
            Notes
            <input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="input text-sm text-ink" />
          </label>
        </div>
      </section>

      <section className="overflow-x-auto rounded border border-line bg-surface">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="border-b border-line px-3 py-2 font-normal">#</th>
              <th className="border-b border-line px-3 py-2 font-normal">Item</th>
              <th className="border-b border-line px-3 py-2 text-right font-normal">Ordered</th>
              <th className="border-b border-line px-3 py-2 text-right font-normal">Already shipped</th>
              <th className="w-32 border-b border-line px-3 py-2 text-right font-normal">Ship now</th>
              <th className="w-48 border-b border-line px-3 py-2 font-normal">Batch no.</th>
              <th className="w-24 border-b border-line" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const lineRows = rows.filter((r) => r.lineId === l.id);
              const done = l.ordered - l.shipped <= 1e-9;
              if (done)
                return (
                  <tr key={l.id} className="text-muted">
                    <td className="border-b border-line px-3 py-2">{l.lineNo}</td>
                    <td className="border-b border-line px-3 py-2">{l.description}</td>
                    <td className="border-b border-line px-3 py-2 text-right">{fmt(l.ordered)} {l.uom}</td>
                    <td className="border-b border-line px-3 py-2 text-right">{fmt(l.shipped)}</td>
                    <td colSpan={3} className="border-b border-line px-3 py-2">Fully shipped</td>
                  </tr>
                );
              return lineRows.map((r, i) => (
                <tr key={r.key} className="align-top">
                  <td className="border-b border-line px-3 py-2 text-muted">{i === 0 ? l.lineNo : ""}</td>
                  <td className="border-b border-line px-3 py-2">
                    {i === 0 ? (
                      <>
                        {l.sku && <span className="mr-1 font-mono text-xs text-muted">[{l.sku}]</span>}
                        {l.description}
                        {!l.trackStock && <div className="text-xs text-muted">Not a stock item (no stock movement)</div>}
                      </>
                    ) : (
                      <span className="text-xs text-muted">↳ another batch</span>
                    )}
                  </td>
                  <td className="border-b border-line px-3 py-2 text-right tabular-nums whitespace-nowrap">{i === 0 && `${fmt(l.ordered)} ${l.uom ?? ""}`}</td>
                  <td className="border-b border-line px-3 py-2 text-right tabular-nums">{i === 0 && fmt(l.shipped)}</td>
                  <td className="border-b border-line px-3 py-1.5">
                    <input
                      aria-label={`Line ${l.lineNo} ship quantity${i ? ` (batch ${i + 1})` : ""}`}
                      type="number"
                      min="0"
                      step="any"
                      value={r.qty}
                      onChange={(e) => update(r.key, { qty: e.target.value })}
                      className="input w-full text-right"
                    />
                  </td>
                  <td className="border-b border-line px-3 py-1.5">
                    <input
                      aria-label={`Line ${l.lineNo} batch number${i ? ` (${i + 1})` : ""}`}
                      value={r.batch}
                      onChange={(e) => update(r.key, { batch: e.target.value })}
                      className="input w-full font-mono"
                      placeholder={l.trackStock ? "Batch no." : "—"}
                    />
                  </td>
                  <td className="border-b border-line px-2 py-1.5 whitespace-nowrap">
                    {i === 0 ? (
                      l.trackStock && (
                        <button type="button" onClick={() => addBatch(l.id)} className="btn-secondary px-2 py-1 text-xs" title="Split this line across batches">
                          <Plus className="h-3.5 w-3.5" /> batch
                        </button>
                      )
                    ) : (
                      <button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} className="icon-btn text-bad" aria-label="Remove batch row">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ));
            })}
          </tbody>
        </table>
      </section>

      <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-3 border-t border-line bg-page/95 py-3">
        {error ? (
          <p role="alert" className="mr-auto text-sm text-bad">
            {error}
          </p>
        ) : (
          <p className="mr-auto text-sm text-muted">
            {totalSending > 0 ? (fullyShipping ? "This ships everything outstanding: the order will be marked Shipped." : "Partial shipment: the rest stays open on the order.") : ""}
          </p>
        )}
        <Link href={`/sell/orders/${orderId}`} className="btn-secondary">
          Cancel
        </Link>
        <button type="button" onClick={submit} disabled={pending} className="btn-primary">
          {pending ? "Recording…" : `Record shipment ${orderNumber}/${nextSeq}`}
        </button>
      </div>
    </div>
  );
}
