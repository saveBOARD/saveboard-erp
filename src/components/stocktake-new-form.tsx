"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createStocktake } from "@/app/(app)/stock/actions";

export function StocktakeNewForm({ categories, counts }: { categories: string[]; counts: { all: number; product: number; material: number } }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState("all");
  const [category, setCategory] = useState(categories[0] ?? "");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");

  function start() {
    setError(null);
    startTransition(async () => {
      const res = await createStocktake({ scope, category: scope === "category" ? category : null, reason, notes: notes || null });
      if (res.error) return setError(res.error);
      router.push(`/stock/stocktakes/${res.id}`);
    });
  }

  const option = (value: string, text: string) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="radio" name="scope" value={value} checked={scope === value} onChange={() => setScope(value)} /> {text}
    </label>
  );

  return (
    <div className="mx-auto grid max-w-2xl gap-4 rounded border border-line bg-surface p-6">
      <div>
        <div className="text-xs uppercase tracking-wide text-muted">Stocktake</div>
        <h1 className="text-2xl font-medium">Start a stocktake</h1>
        <p className="text-sm text-muted">
          The expected quantity of every item is recorded now. Count, enter the numbers (you can save and come back), then
          complete: the differences are posted as one stock adjustment.
        </p>
      </div>
      <label className="grid gap-1 text-sm">
        Reason *
        <input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} className="input" placeholder="e.g. Month-end count October 2026" />
      </label>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm">What will be counted?</legend>
        {option("all", `All stock items (${counts.all})`)}
        {option("product", `Products only (${counts.product})`)}
        {option("material", `Materials only (${counts.material})`)}
        <div className="flex flex-wrap items-center gap-2">
          {option("category", "One category:")}
          <select id="category" value={category} onChange={(e) => { setCategory(e.target.value); setScope("category"); }} className="input py-1">
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
      </fieldset>
      <label className="grid gap-1 text-sm">
        Notes
        <textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="input" />
      </label>
      <div className="flex items-center justify-end gap-3">
        {error && <p className="mr-auto text-sm text-bad">{error}</p>}
        <Link href="/stock/stocktakes" className="btn-secondary">
          Cancel
        </Link>
        <button type="button" onClick={start} disabled={pending} className="btn-primary">
          {pending ? "Starting…" : "Start stocktake"}
        </button>
      </div>
    </div>
  );
}
