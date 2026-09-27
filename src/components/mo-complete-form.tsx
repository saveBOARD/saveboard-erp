"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { completeMO } from "@/app/(app)/make/actions";

export type CompleteMaterial = { id: string; sku: string; name: string; uom: string | null; plannedQty: number; inStock: number; trackStock: boolean; cost: number };
export type CompleteOperation = { id: string; name: string; plannedHours: number; costPerHour: number };

const fmt = (n: number) => n.toLocaleString("en-NZ", { maximumFractionDigits: 4 });
const money = (n: number, c: string) => `${n.toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}`;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

export function MOCompleteForm({
  mo,
  materials,
  operations,
  today,
  currency,
}: {
  mo: { id: string; number: string; sku: string; name: string; uom: string | null; plannedQty: number };
  materials: CompleteMaterial[];
  operations: CompleteOperation[];
  today: string;
  currency: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [completedOn, setCompletedOn] = useState(today);
  const [actualQty, setActualQty] = useState(String(mo.plannedQty));
  const [batchNo, setBatchNo] = useState(mo.number);
  const [mats, setMats] = useState(() => Object.fromEntries(materials.map((m) => [m.id, { qty: String(m.plannedQty), batch: "" }])));
  const [hours, setHours] = useState(() => Object.fromEntries(operations.map((o) => [o.id, String(o.plannedHours)])));

  const made = Number(actualQty) || 0;
  // Scale material and hour quantities when the made quantity changes, as long as they still match the plan.
  function changeQty(v: string) {
    const next = Number(v) || 0;
    const ratio = mo.plannedQty ? next / mo.plannedQty : 0;
    const prevRatio = mo.plannedQty ? made / mo.plannedQty : 0;
    setMats((ms) =>
      Object.fromEntries(
        materials.map((m) => {
          const cur = ms[m.id];
          const untouched = Math.abs((Number(cur.qty) || 0) - r4(m.plannedQty * prevRatio)) < 1e-6;
          return [m.id, untouched ? { ...cur, qty: String(r4(m.plannedQty * ratio)) } : cur];
        }),
      ),
    );
    setHours((hs) =>
      Object.fromEntries(
        operations.map((o) => {
          const untouched = Math.abs((Number(hs[o.id]) || 0) - r4(o.plannedHours * prevRatio)) < 1e-6;
          return [o.id, untouched ? String(r4(o.plannedHours * ratio)) : hs[o.id]];
        }),
      ),
    );
    setActualQty(v);
  }

  const matCost = materials.reduce((s, m) => s + (Number(mats[m.id].qty) || 0) * m.cost, 0);
  const opCost = operations.reduce((s, o) => s + (Number(hours[o.id]) || 0) * o.costPerHour, 0);
  const shortages = materials.filter((m) => m.trackStock && (Number(mats[m.id].qty) || 0) > m.inStock + 1e-9);

  function submit() {
    setError(null);
    if (made <= 0) return setError("Enter how many were made.");
    if (shortages.length && !window.confirm(`Not enough stock of ${shortages.map((s) => s.sku).join(", ")}. Complete anyway? Stock of those items will go negative.`)) return;
    startTransition(async () => {
      const res = await completeMO({
        id: mo.id,
        completedOn,
        actualQty: made,
        batchNo: batchNo || null,
        materials: materials.map((m) => ({ id: m.id, actualQty: Number(mats[m.id].qty) || 0, batchNo: mats[m.id].batch || null })),
        operations: operations.map((o) => ({ id: o.id, actualHours: Number(hours[o.id]) || 0 })),
      });
      if (res.error) return setError(res.error);
      router.push(`/make/orders/${mo.id}`);
      router.refresh();
    });
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-4">
      <section className="grid gap-4 rounded border border-line bg-surface p-5">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted">Complete manufacturing order</div>
          <h1 className="text-2xl font-medium">
            {mo.number} <span className="text-base text-muted">[{mo.sku}] {mo.name}</span>
          </h1>
          <p className="text-sm text-muted">Enter what was actually made and used. Materials come out of stock and the finished goods go in.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="grid gap-1 text-xs text-muted">
            Completed date
            <input type="date" value={completedOn} onChange={(e) => setCompletedOn(e.target.value)} className="input text-sm text-ink" />
          </label>
          <label className="grid gap-1 text-xs text-muted">
            Quantity made {mo.uom && `(${mo.uom})`} · planned {fmt(mo.plannedQty)}
            <input type="number" min="0" step="any" value={actualQty} onChange={(e) => changeQty(e.target.value)} className="input text-right text-sm text-ink" />
          </label>
          <label className="grid gap-1 text-xs text-muted">
            Batch no. (finished goods)
            <input value={batchNo} onChange={(e) => setBatchNo(e.target.value)} className="input font-mono text-sm text-ink" />
          </label>
        </div>
      </section>

      <section className="overflow-x-auto rounded border border-line bg-surface">
        <div className="border-b border-line px-4 py-2 font-medium">Materials used</div>
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="border-b border-line px-3 py-2 font-normal">Material</th>
              <th className="border-b border-line px-3 py-2 text-right font-normal">Planned</th>
              <th className="border-b border-line px-3 py-2 text-right font-normal">In stock</th>
              <th className="w-36 border-b border-line px-3 py-2 text-right font-normal">Actually used</th>
              <th className="w-44 border-b border-line px-3 py-2 font-normal">Batch used</th>
            </tr>
          </thead>
          <tbody>
            {materials.map((m) => {
              const short = shortages.includes(m);
              return (
                <tr key={m.id}>
                  <td className="border-b border-line px-3 py-2">
                    <span className="mr-1 font-mono text-xs text-muted">[{m.sku}]</span>
                    {m.name}
                    {!m.trackStock && <div className="text-xs text-muted">Not a stock item (no stock movement)</div>}
                  </td>
                  <td className="border-b border-line px-3 py-2 text-right tabular-nums whitespace-nowrap">
                    {fmt(m.plannedQty)} {m.uom}
                  </td>
                  <td className={`border-b border-line px-3 py-2 text-right tabular-nums ${short ? "bg-bad text-white" : ""}`}>{m.trackStock ? fmt(m.inStock) : "—"}</td>
                  <td className="border-b border-line px-3 py-1.5">
                    <input
                      aria-label={`${m.sku} used`}
                      type="number"
                      min="0"
                      step="any"
                      value={mats[m.id].qty}
                      onChange={(e) => setMats((ms) => ({ ...ms, [m.id]: { ...ms[m.id], qty: e.target.value } }))}
                      className="input w-full text-right"
                    />
                  </td>
                  <td className="border-b border-line px-3 py-1.5">
                    <input
                      aria-label={`${m.sku} batch`}
                      value={mats[m.id].batch}
                      onChange={(e) => setMats((ms) => ({ ...ms, [m.id]: { ...ms[m.id], batch: e.target.value } }))}
                      className="input w-full font-mono"
                      placeholder={m.trackStock ? "Optional" : "—"}
                    />
                  </td>
                </tr>
              );
            })}
            {!materials.length && (
              <tr>
                <td colSpan={5} className="px-3 py-3 text-muted">No materials on this order.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {operations.length > 0 && (
        <section className="overflow-x-auto rounded border border-line bg-surface">
          <div className="border-b border-line px-4 py-2 font-medium">Time taken</div>
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="border-b border-line px-3 py-2 font-normal">Operation</th>
                <th className="border-b border-line px-3 py-2 text-right font-normal">Planned hours</th>
                <th className="w-36 border-b border-line px-3 py-2 text-right font-normal">Actual hours</th>
              </tr>
            </thead>
            <tbody>
              {operations.map((o) => (
                <tr key={o.id}>
                  <td className="border-b border-line px-3 py-2">{o.name}</td>
                  <td className="border-b border-line px-3 py-2 text-right tabular-nums">{fmt(o.plannedHours)}</td>
                  <td className="border-b border-line px-3 py-1.5">
                    <input aria-label={`${o.name} actual hours`} type="number" min="0" step="any" value={hours[o.id]} onChange={(e) => setHours((hs) => ({ ...hs, [o.id]: e.target.value }))} className="input w-full text-right" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-3 border-t border-line bg-page/95 py-3">
        {error ? (
          <p role="alert" className="mr-auto text-sm text-bad">{error}</p>
        ) : (
          <p className="mr-auto text-sm">
            Cost <b>{money(matCost + opCost, currency)}</b>
            {made > 0 && <span className="text-muted"> · {money((matCost + opCost) / made, currency)} per {mo.uom ?? "unit"} (goes into stock at this cost)</span>}
          </p>
        )}
        <Link href={`/make/orders/${mo.id}`} className="btn-secondary">
          Cancel
        </Link>
        <button type="button" onClick={submit} disabled={pending} className="btn-primary">
          {pending ? "Completing…" : "Complete order"}
        </button>
      </div>
    </div>
  );
}
