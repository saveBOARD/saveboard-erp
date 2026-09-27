"use client";

import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { saveRecipe } from "@/app/(app)/make/actions";

export type RecipeItem = { id: string; sku: string; name: string; uom: string | null; cost: number };
type MatRow = { key: string; itemText: string; ingredientId: string | null; qty: string; note: string };
type OpRow = { key: string; name: string; hours: string; rate: string };

const label = (p: { sku: string; name: string }) => `${p.sku} — ${p.name}`;
const newKey = () => Math.random().toString(36).slice(2);
const money = (n: number, c: string) => `${n.toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} ${c}`;

export function RecipeEditor({
  product,
  items,
  initialMaterials,
  initialOperations,
  currency,
}: {
  product: { id: string; sku: string; name: string; uom: string | null };
  items: RecipeItem[];
  initialMaterials: { ingredientId: string; qtyPerUnit: number; note: string | null }[];
  initialOperations: { name: string; hoursPerUnit: number; costPerHour: number }[];
  currency: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const byLabel = useMemo(() => new Map(items.map((i) => [label(i).toLowerCase(), i])), [items]);
  const [mats, setMats] = useState<MatRow[]>(() =>
    initialMaterials.length
      ? initialMaterials.map((m) => ({ key: newKey(), itemText: byId.get(m.ingredientId) ? label(byId.get(m.ingredientId)!) : "", ingredientId: m.ingredientId, qty: String(m.qtyPerUnit), note: m.note ?? "" }))
      : [{ key: newKey(), itemText: "", ingredientId: null, qty: "", note: "" }],
  );
  const [ops, setOps] = useState<OpRow[]>(() => initialOperations.map((o) => ({ key: newKey(), name: o.name, hours: String(o.hoursPerUnit), rate: String(o.costPerHour) })));

  const matCost = mats.reduce((s, m) => s + (m.ingredientId ? (Number(m.qty) || 0) * byId.get(m.ingredientId)!.cost : 0), 0);
  const opCost = ops.reduce((s, o) => s + (Number(o.hours) || 0) * (Number(o.rate) || 0), 0);

  function save() {
    setError(null);
    setSaved(false);
    const lines = mats.filter((m) => m.itemText || m.qty);
    if (lines.some((m) => !m.ingredientId)) return setError("Pick every material from the list (type a SKU or name).");
    startTransition(async () => {
      const res = await saveRecipe({
        productId: product.id,
        lines: lines.map((m) => ({ ingredientId: m.ingredientId!, qtyPerUnit: Number(m.qty) || 0, note: m.note || null })),
        operations: ops.filter((o) => o.name).map((o) => ({ name: o.name, hoursPerUnit: Number(o.hours) || 0, costPerHour: Number(o.rate) || 0 })),
      });
      if (res.error) return setError(res.error);
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-4">
      <datalist id="recipe-items">
        {items.map((i) => (
          <option key={i.id} value={label(i)} />
        ))}
      </datalist>
      <section className="rounded border border-line bg-surface p-5">
        <div className="text-xs uppercase tracking-wide text-muted">Recipe (bill of materials)</div>
        <h1 className="text-2xl font-medium">
          <span className="font-mono text-base text-muted">{product.sku}</span> {product.name}
        </h1>
        <p className="text-sm text-muted">Quantities are per 1 {product.uom ?? "unit"} made. Manufacturing orders multiply them by the quantity being made.</p>
      </section>

      <section className="overflow-x-auto rounded border border-line bg-surface">
        <div className="border-b border-line px-4 py-2 font-medium">Materials</div>
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="border-b border-line px-3 py-2 font-normal">Material</th>
              <th className="w-36 border-b border-line px-3 py-2 text-right font-normal">Qty per unit</th>
              <th className="border-b border-line px-3 py-2 text-right font-normal">Cost per unit</th>
              <th className="border-b border-line px-3 py-2 font-normal">Note</th>
              <th className="w-10 border-b border-line" />
            </tr>
          </thead>
          <tbody>
            {mats.map((m, i) => {
              const item = m.ingredientId ? byId.get(m.ingredientId) : undefined;
              return (
                <tr key={m.key}>
                  <td className="border-b border-line px-3 py-1.5">
                    <input
                      aria-label={`Material ${i + 1}`}
                      list="recipe-items"
                      value={m.itemText}
                      onChange={(e) => {
                        const hit = byLabel.get(e.target.value.trim().toLowerCase());
                        setMats((ms) => ms.map((x) => (x.key === m.key ? { ...x, itemText: e.target.value, ingredientId: hit?.id ?? null } : x)));
                      }}
                      className="input w-full"
                      placeholder="SKU or name…"
                      autoComplete="off"
                    />
                  </td>
                  <td className="border-b border-line px-3 py-1.5">
                    <div className="flex items-center gap-1">
                      <input aria-label={`Material ${i + 1} quantity`} type="number" step="any" min="0" value={m.qty} onChange={(e) => setMats((ms) => ms.map((x) => (x.key === m.key ? { ...x, qty: e.target.value } : x)))} className="input w-full text-right" />
                      <span className="w-8 text-xs text-muted">{item?.uom}</span>
                    </div>
                  </td>
                  <td className="border-b border-line px-3 py-2 text-right tabular-nums whitespace-nowrap">{item ? money((Number(m.qty) || 0) * item.cost, currency) : ""}</td>
                  <td className="border-b border-line px-3 py-1.5">
                    <input aria-label={`Material ${i + 1} note`} value={m.note} onChange={(e) => setMats((ms) => ms.map((x) => (x.key === m.key ? { ...x, note: e.target.value } : x)))} className="input w-full" />
                  </td>
                  <td className="border-b border-line px-1">
                    <button type="button" onClick={() => setMats((ms) => ms.filter((x) => x.key !== m.key))} className="icon-btn text-bad" aria-label={`Remove material ${i + 1}`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="flex items-center justify-between px-3 py-2">
          <button type="button" onClick={() => setMats((ms) => [...ms, { key: newKey(), itemText: "", ingredientId: null, qty: "", note: "" }])} className="btn-secondary">
            <Plus className="h-4 w-4" /> Add material
          </button>
          <span className="text-sm">Materials: <b>{money(matCost, currency)}</b> per unit</span>
        </div>
      </section>

      <section className="overflow-x-auto rounded border border-line bg-surface">
        <div className="border-b border-line px-4 py-2 font-medium">Operations (labour & machine time)</div>
        <table className="w-full min-w-[600px] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="border-b border-line px-3 py-2 font-normal">Operation</th>
              <th className="w-36 border-b border-line px-3 py-2 text-right font-normal">Hours per unit</th>
              <th className="w-36 border-b border-line px-3 py-2 text-right font-normal">Cost per hour ({currency})</th>
              <th className="border-b border-line px-3 py-2 text-right font-normal">Cost per unit</th>
              <th className="w-10 border-b border-line" />
            </tr>
          </thead>
          <tbody>
            {ops.map((o, i) => (
              <tr key={o.key}>
                <td className="border-b border-line px-3 py-1.5">
                  <input aria-label={`Operation ${i + 1}`} value={o.name} onChange={(e) => setOps((os) => os.map((x) => (x.key === o.key ? { ...x, name: e.target.value } : x)))} className="input w-full" placeholder="e.g. Labour, 3 operators + electricity" />
                </td>
                <td className="border-b border-line px-3 py-1.5">
                  <input aria-label={`Operation ${i + 1} hours`} type="number" step="any" min="0" value={o.hours} onChange={(e) => setOps((os) => os.map((x) => (x.key === o.key ? { ...x, hours: e.target.value } : x)))} className="input w-full text-right" />
                </td>
                <td className="border-b border-line px-3 py-1.5">
                  <input aria-label={`Operation ${i + 1} rate`} type="number" step="any" min="0" value={o.rate} onChange={(e) => setOps((os) => os.map((x) => (x.key === o.key ? { ...x, rate: e.target.value } : x)))} className="input w-full text-right" />
                </td>
                <td className="border-b border-line px-3 py-2 text-right tabular-nums">{money((Number(o.hours) || 0) * (Number(o.rate) || 0), currency)}</td>
                <td className="border-b border-line px-1">
                  <button type="button" onClick={() => setOps((os) => os.filter((x) => x.key !== o.key))} className="icon-btn text-bad" aria-label={`Remove operation ${i + 1}`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center justify-between px-3 py-2">
          <button type="button" onClick={() => setOps((os) => [...os, { key: newKey(), name: "", hours: "", rate: "" }])} className="btn-secondary">
            <Plus className="h-4 w-4" /> Add operation
          </button>
          <span className="text-sm">Operations: <b>{money(opCost, currency)}</b> per unit</span>
        </div>
      </section>

      <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-3 border-t border-line bg-page/95 py-3">
        <span className="mr-auto text-sm">
          Standard cost to make: <b>{money(matCost + opCost, currency)}</b> per {product.uom ?? "unit"}
          {error && <span className="ml-4 text-bad">{error}</span>}
          {saved && !error && <span className="ml-4 text-ok">Recipe saved.</span>}
        </span>
        <Link href={`/items/products/${product.id}`} className="btn-secondary">
          Back to item
        </Link>
        <button type="button" onClick={save} disabled={pending} className="btn-primary">
          {pending ? "Saving…" : "Save recipe"}
        </button>
      </div>
    </div>
  );
}
