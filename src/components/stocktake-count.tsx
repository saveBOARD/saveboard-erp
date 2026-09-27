"use client";

import clsx from "clsx";
import { CheckCircle2, Printer, Save, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { cancelStocktake, completeStocktake, saveCounts } from "@/app/(app)/stock/actions";

export type CountLine = {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  uom: string | null;
  cost: number;
  expected: number;
  counted: number | null;
  note: string | null;
  countedBy: string | null;
};

type Entry = { counted: string; note: string };
const fmt = (n: number) => n.toLocaleString("en-NZ", { maximumFractionDigits: 4 });
const money = (n: number, c: string) => `${n.toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}`;

export function StocktakeCount({
  id,
  number,
  editable,
  lines,
  currency,
}: {
  id: string;
  number: string;
  editable: boolean;
  lines: CountLine[];
  currency: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ error?: string; ok?: string } | null>(null);
  const [search, setSearch] = useState("");
  const [uncountedOnly, setUncountedOnly] = useState(false);
  const [entries, setEntries] = useState<Record<string, Entry>>(() =>
    Object.fromEntries(lines.map((l) => [l.id, { counted: l.counted === null ? "" : String(l.counted), note: l.note ?? "" }])),
  );
  const [saved, setSaved] = useState<Record<string, Entry>>(entries);

  const dirty = lines.filter((l) => entries[l.id].counted !== saved[l.id].counted || entries[l.id].note !== saved[l.id].note);
  const stats = useMemo(() => {
    let counted = 0;
    let diffs = 0;
    let value = 0;
    for (const l of lines) {
      const c = entries[l.id].counted;
      if (c === "") continue;
      counted++;
      const d = Number(c) - l.expected;
      if (Math.abs(d) > 1e-9) diffs++;
      value += d * l.cost;
    }
    return { counted, diffs, value };
  }, [entries, lines]);

  const shown = lines.filter((l) => {
    if (uncountedOnly && entries[l.id].counted !== "") return false;
    if (!search) return true;
    const s = search.toLowerCase();
    return l.sku.toLowerCase().includes(s) || l.name.toLowerCase().includes(s) || (l.category ?? "").toLowerCase().includes(s);
  });

  const payload = (only: CountLine[]) =>
    only.map((l) => ({ lineId: l.id, counted: entries[l.id].counted === "" ? null : Number(entries[l.id].counted), note: entries[l.id].note || null }));

  function save(then?: () => void) {
    setMessage(null);
    startTransition(async () => {
      if (dirty.length) {
        const res = await saveCounts(id, payload(dirty));
        if (res.error) return setMessage({ error: res.error });
        setSaved(entries);
      }
      if (then) then();
      else setMessage({ ok: `Saved ${dirty.length} line${dirty.length === 1 ? "" : "s"}.` });
    });
  }

  function complete() {
    const notCounted = lines.length - stats.counted;
    const text =
      `Complete ${number}?\n\n${stats.counted} of ${lines.length} items counted` +
      (notCounted ? ` (${notCounted} not counted: their stock is left unchanged)` : "") +
      `.\n${stats.diffs} differences, net value ${money(stats.value, currency)}, will be posted as one stock adjustment.`;
    if (!window.confirm(text)) return;
    save(async () => {
      const res = await completeStocktake(id);
      if (res.error) return setMessage({ error: res.error });
      router.refresh();
    });
  }

  function cancel() {
    if (!window.confirm(`Cancel ${number}? Counts are kept on record but nothing is posted to stock.`)) return;
    startTransition(async () => {
      const res = await cancelStocktake(id);
      if (res.error) return setMessage({ error: res.error });
      router.refresh();
    });
  }

  return (
    <div className="grid gap-3">
      <div className="no-print flex flex-wrap items-center gap-3 rounded border border-line bg-surface p-3">
        <input
          id="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Find SKU, name or category…"
          className="input w-72"
          aria-label="Find an item"
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={uncountedOnly} onChange={(e) => setUncountedOnly(e.target.checked)} /> Uncounted only
        </label>
        <span className="text-sm">
          <b>{stats.counted}</b> / {lines.length} counted · <b>{stats.diffs}</b> differences ·{" "}
          <span className={clsx("font-medium", stats.value < 0 ? "text-bad" : stats.value > 0 ? "text-ok" : "")}>{money(stats.value, currency)}</span>
        </span>
        <Link href={`/print/stocktake/${id}`} target="_blank" className="btn-secondary ml-auto">
          <Printer className="h-4 w-4" /> Count sheet
        </Link>
      </div>

      <div className="overflow-x-auto rounded border border-line bg-surface">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="border-b border-line px-3 py-2 font-normal">Item</th>
              <th className="border-b border-line px-3 py-2 font-normal">Category</th>
              <th className="border-b border-line px-3 py-2 text-right font-normal">Expected</th>
              <th className="w-36 border-b border-line px-3 py-2 text-right font-normal">Counted</th>
              <th className="border-b border-line px-3 py-2 text-right font-normal">Difference</th>
              <th className="border-b border-line px-3 py-2 text-right font-normal">Value</th>
              <th className="border-b border-line px-3 py-2 font-normal">Note</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((l) => {
              const e = entries[l.id];
              const d = e.counted === "" ? null : Number(e.counted) - l.expected;
              const isDirty = e.counted !== saved[l.id].counted || e.note !== saved[l.id].note;
              return (
                <tr key={l.id} className={clsx(isDirty && "bg-[#fffbea]")}>
                  <td className="border-b border-line px-3 py-2">
                    <span className="mr-1 font-mono text-xs text-muted">[{l.sku}]</span>
                    {l.name}
                    {l.countedBy && !isDirty && <div className="text-xs text-muted">counted by {l.countedBy}</div>}
                  </td>
                  <td className="border-b border-line px-3 py-2 text-muted">{l.category}</td>
                  <td className="border-b border-line px-3 py-2 text-right tabular-nums whitespace-nowrap">
                    {fmt(l.expected)} {l.uom}
                  </td>
                  <td className="border-b border-line px-3 py-1.5">
                    {editable ? (
                      <input
                        aria-label={`Counted ${l.sku}`}
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="any"
                        value={e.counted}
                        onChange={(ev) => setEntries((x) => ({ ...x, [l.id]: { ...x[l.id], counted: ev.target.value } }))}
                        className="input w-full py-2 text-right text-base"
                      />
                    ) : (
                      <div className="text-right tabular-nums">{e.counted === "" ? <span className="text-muted">not counted</span> : fmt(Number(e.counted))}</div>
                    )}
                  </td>
                  <td className={clsx("border-b border-line px-3 py-2 text-right tabular-nums whitespace-nowrap", d !== null && d < 0 && "text-bad", d !== null && d > 0 && "text-ok")}>
                    {d === null ? "" : `${d > 0 ? "+" : ""}${fmt(d)}`}
                  </td>
                  <td className={clsx("border-b border-line px-3 py-2 text-right tabular-nums whitespace-nowrap", d !== null && d < 0 && "text-bad")}>
                    {d && d * l.cost ? money(d * l.cost, currency) : ""}
                  </td>
                  <td className="border-b border-line px-3 py-1.5">
                    {editable ? (
                      <input
                        aria-label={`Note ${l.sku}`}
                        value={e.note}
                        onChange={(ev) => setEntries((x) => ({ ...x, [l.id]: { ...x[l.id], note: ev.target.value } }))}
                        className="input w-full"
                      />
                    ) : (
                      <span className="text-muted">{e.note}</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {!shown.length && (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-muted">
                  No items match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editable && (
        <div className="no-print sticky bottom-0 flex flex-wrap items-center justify-end gap-3 border-t border-line bg-page/95 py-3">
          {message?.error && <p className="mr-auto text-sm text-bad">{message.error}</p>}
          {message?.ok && !dirty.length && <p className="mr-auto text-sm text-ok">{message.ok}</p>}
          {dirty.length > 0 && <p className="mr-auto text-sm text-warn">{dirty.length} unsaved change{dirty.length === 1 ? "" : "s"}</p>}
          <button type="button" onClick={cancel} disabled={pending} className="btn-secondary text-bad">
            <XCircle className="h-4 w-4" /> Cancel stocktake
          </button>
          <button type="button" onClick={() => save()} disabled={pending || !dirty.length} className="btn-secondary">
            <Save className="h-4 w-4" /> Save progress
          </button>
          <button type="button" onClick={complete} disabled={pending} className="btn-primary">
            <CheckCircle2 className="h-4 w-4" /> Complete stocktake
          </button>
        </div>
      )}
    </div>
  );
}
