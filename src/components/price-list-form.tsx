"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createPriceList, updatePriceList } from "@/app/(app)/sell/price-lists/actions";

/** New price list, or the settings of an existing one (name, "default less N%", notes). */
export function PriceListForm({
  existing,
  isDefault,
  defaultName,
  otherLists,
}: {
  existing?: { id: string; name: string; adjustPercent: number | null; notes: string | null };
  isDefault?: boolean;
  defaultName: string | null;
  otherLists: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [name, setName] = useState(existing?.name ?? "");
  const [mode, setMode] = useState<"own" | "adjust">(existing?.adjustPercent != null ? "adjust" : "own");
  const [pct, setPct] = useState(existing?.adjustPercent != null ? String(Math.abs(existing.adjustPercent)) : "10");
  const [direction, setDirection] = useState<"less" | "plus">(existing?.adjustPercent != null && existing.adjustPercent > 0 ? "plus" : "less");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [copyFrom, setCopyFrom] = useState("");
  const canAdjust = !isDefault && defaultName !== null;

  function submit() {
    setError(null);
    setSaved(false);
    const n = Number(pct);
    if (mode === "adjust" && !(n >= 0)) return setError("Enter the percentage, e.g. 15.");
    const adjustPercent = canAdjust && mode === "adjust" ? (direction === "less" ? -n : n) : null;
    startTransition(async () => {
      const res = existing
        ? await updatePriceList({ id: existing.id, name, adjustPercent, notes: notes || null })
        : await createPriceList({ name, adjustPercent, notes: notes || null, copyFromId: copyFrom || null });
      if (res.error) return setError(res.error);
      if (existing) {
        setSaved(true);
        router.refresh();
      } else router.push(`/sell/price-lists/${res.id}`);
    });
  }

  return (
    <div className="grid gap-4 rounded border border-line bg-surface p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1 text-xs text-muted">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} className="input text-sm text-ink" placeholder="e.g. Wholesale" />
        </label>
        <label className="grid gap-1 text-xs text-muted">
          Notes
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className="input text-sm text-ink" placeholder="Who it's for, when it was agreed…" />
        </label>
      </div>
      {canAdjust ? (
        <fieldset className="grid gap-2 text-sm">
          <legend className="mb-1 text-xs text-muted">Prices</legend>
          <label className="flex items-center gap-2">
            <input type="radio" checked={mode === "own"} onChange={() => setMode("own")} />
            Own prices only (products without a price on this list use the {defaultName} price)
          </label>
          <label className="flex flex-wrap items-center gap-2">
            <input type="radio" checked={mode === "adjust"} onChange={() => setMode("adjust")} />
            {defaultName} prices
            <select value={direction} onChange={(e) => setDirection(e.target.value as "less" | "plus")} className="input py-1" disabled={mode !== "adjust"}>
              <option value="less">less</option>
              <option value="plus">plus</option>
            </select>
            <input type="number" min="0" step="any" value={pct} onChange={(e) => setPct(e.target.value)} className="input w-20 py-1 text-right" disabled={mode !== "adjust"} />%
            <span className="text-muted">— any price entered on this list overrides it</span>
          </label>
        </fieldset>
      ) : (
        <p className="text-sm text-muted">
          {isDefault ? "This is the default list: customers without a price list of their own get these prices." : "The first price list becomes the default."}
        </p>
      )}
      {!existing && otherLists.length > 0 && (
        <label className="grid max-w-sm gap-1 text-xs text-muted">
          Start with prices copied from
          <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} className="input text-sm text-ink">
            <option value="">— nothing (empty list) —</option>
            {otherLists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={submit} disabled={pending} className="btn-primary">
          {pending ? "Saving…" : existing ? "Save settings" : "Create price list"}
        </button>
        {!existing && (
          <Link href="/sell/price-lists" className="btn-secondary">
            Cancel
          </Link>
        )}
        {error && <span className="text-sm text-bad">{error}</span>}
        {saved && !error && <span className="text-sm text-ok">Saved.</span>}
      </div>
    </div>
  );
}
