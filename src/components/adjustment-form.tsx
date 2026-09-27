"use client";

import clsx from "clsx";
import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { createAdjustment } from "@/app/(app)/stock/actions";

export type AdjustItem = { id: string; sku: string; name: string; uom: string | null; cost: number; onHand: number };
type Row = { key: string; itemText: string; productId: string | null; qty: string; batch: string; note: string };

export const ADJUSTMENT_REASONS = [
  "Stocktake correction",
  "Damaged stock",
  "Write-off",
  "Stock received (untracked)",
  "Samples",
  "Production scrap",
  "Returned to supplier",
  "Other",
];

const label = (p: { sku: string; name: string }) => `${p.sku} — ${p.name}`;
const newKey = () => Math.random().toString(36).slice(2);
const fmt = (n: number) => n.toLocaleString("en-NZ", { maximumFractionDigits: 4 });
const money = (n: number, c: string) => `${n.toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}`;

export function AdjustmentForm({ items, currency, today }: { items: AdjustItem[]; currency: string; today: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [adjustedOn, setAdjustedOn] = useState(today);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<Row[]>(() => [{ key: newKey(), itemText: "", productId: null, qty: "", batch: "", note: "" }]);
  const byLabel = useMemo(() => new Map(items.map((p) => [label(p).toLowerCase(), p])), [items]);
  const byId = useMemo(() => new Map(items.map((p) => [p.id, p])), [items]);

  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const total = rows.reduce((s, r) => s + (r.productId ? (Number(r.qty) || 0) * byId.get(r.productId)!.cost : 0), 0);

  function save() {
    setError(null);
    const lines = rows.filter((r) => r.itemText || r.qty);
    if (lines.some((r) => !r.productId)) return setError("Pick every item from the list (type a SKU or name).");
    if (lines.some((r) => !Number(r.qty))) return setError("Enter a quantity on every line: positive adds stock, negative removes it.");
    startTransition(async () => {
      const res = await createAdjustment({
        adjustedOn,
        reason,
        notes: notes || null,
        lines: lines.map((r) => ({ productId: r.productId!, qty: Number(r.qty), batchNo: r.batch || null, note: r.note || null })),
      });
      if (res.error) return setError(res.error);
      router.push(`/stock/adjustments/${res.id}`);
      router.refresh();
    });
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-4">
      <datalist id="adj-items">
        {items.map((p) => (
          <option key={p.id} value={label(p)} />
        ))}
      </datalist>
      <datalist id="adj-reasons">
        {ADJUSTMENT_REASONS.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>

      <section className="grid gap-4 rounded border border-line bg-surface p-5 sm:grid-cols-4">
        <div className="sm:col-span-4">
          <div className="text-xs uppercase tracking-wide text-muted">Stock adjustment</div>
          <h1 className="text-2xl font-medium">New adjustment</h1>
          <p className="text-sm text-muted">Positive quantities add stock, negative remove it. Posted straight away. To undo, reverse it.</p>
        </div>
        <label className="grid gap-1 text-xs text-muted">
          Date
          <input id="adjustedOn" type="date" value={adjustedOn} onChange={(e) => setAdjustedOn(e.target.value)} className="input text-sm text-ink" />
        </label>
        <label className="grid gap-1 text-xs text-muted">
          Reason *
          <input id="reason" list="adj-reasons" value={reason} onChange={(e) => setReason(e.target.value)} className="input text-sm text-ink" placeholder="Choose or type…" />
        </label>
        <label className="grid gap-1 text-xs text-muted sm:col-span-2">
          Notes
          <input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="input text-sm text-ink" />
        </label>
      </section>

      <section className="overflow-x-auto rounded border border-line bg-surface">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="border-b border-line px-2 py-2 font-normal">Item</th>
              <th className="border-b border-line px-2 py-2 text-right font-normal">In stock now</th>
              <th className="w-28 border-b border-line px-2 py-2 text-right font-normal">Adjust by (+/−)</th>
              <th className="border-b border-line px-2 py-2 text-right font-normal">After</th>
              <th className="border-b border-line px-2 py-2 text-right font-normal">Value</th>
              <th className="w-32 border-b border-line px-2 py-2 font-normal">Batch no.</th>
              <th className="border-b border-line px-2 py-2 font-normal">Line note</th>
              <th className="w-10 border-b border-line" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const p = r.productId ? byId.get(r.productId) : undefined;
              const q = Number(r.qty) || 0;
              return (
                <tr key={r.key} className="align-top">
                  <td className="border-b border-line px-2 py-1.5">
                    <input
                      aria-label={`Line ${i + 1} item`}
                      list="adj-items"
                      value={r.itemText}
                      onChange={(e) => {
                        const hit = byLabel.get(e.target.value.trim().toLowerCase());
                        update(r.key, { itemText: e.target.value, productId: hit?.id ?? null });
                      }}
                      className="input w-full"
                      placeholder="SKU or name…"
                      autoComplete="off"
                    />
                  </td>
                  <td className="border-b border-line px-2 py-2 text-right tabular-nums whitespace-nowrap">{p ? `${fmt(p.onHand)} ${p.uom ?? ""}` : ""}</td>
                  <td className="border-b border-line px-2 py-1.5">
                    <input aria-label={`Line ${i + 1} adjustment`} type="number" step="any" value={r.qty} onChange={(e) => update(r.key, { qty: e.target.value })} className="input w-full text-right" />
                  </td>
                  <td className={clsx("border-b border-line px-2 py-2 text-right tabular-nums whitespace-nowrap", p && p.onHand + q < 0 && "text-bad")}>{p && q ? fmt(p.onHand + q) : ""}</td>
                  <td className={clsx("border-b border-line px-2 py-2 text-right tabular-nums whitespace-nowrap", q < 0 && "text-bad")}>{p && q ? money(q * p.cost, currency) : ""}</td>
                  <td className="border-b border-line px-2 py-1.5">
                    <input aria-label={`Line ${i + 1} batch`} value={r.batch} onChange={(e) => update(r.key, { batch: e.target.value })} className="input w-full font-mono" />
                  </td>
                  <td className="border-b border-line px-2 py-1.5">
                    <input aria-label={`Line ${i + 1} note`} value={r.note} onChange={(e) => update(r.key, { note: e.target.value })} className="input w-full" />
                  </td>
                  <td className="border-b border-line px-1 py-1.5">
                    <button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} className="icon-btn text-bad" aria-label={`Remove line ${i + 1}`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className="px-2 py-2">
                <button type="button" onClick={() => setRows((rs) => [...rs, { key: newKey(), itemText: "", productId: null, qty: "", batch: "", note: "" }])} className="btn-secondary">
                  <Plus className="h-4 w-4" /> Add line
                </button>
              </td>
              <td className={clsx("px-2 py-2 text-right font-bold tabular-nums whitespace-nowrap", total < 0 && "text-bad")}>{money(total, currency)}</td>
              <td colSpan={3} className="px-2 py-2 text-xs text-muted">
                Total value at standard cost
              </td>
            </tr>
          </tfoot>
        </table>
      </section>

      <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-3 border-t border-line bg-page/95 py-3">
        {error && (
          <p role="alert" className="mr-auto text-sm text-bad">
            {error}
          </p>
        )}
        <Link href="/stock/adjustments" className="btn-secondary">
          Cancel
        </Link>
        <button type="button" onClick={save} disabled={pending} className="btn-primary">
          {pending ? "Posting…" : "Post adjustment"}
        </button>
      </div>
    </div>
  );
}
