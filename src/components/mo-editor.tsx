"use client";

import { Plus, RefreshCw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { saveMO } from "@/app/(app)/make/actions";

export type MOItem = { id: string; sku: string; name: string; uom: string | null; cost: number; inStock: number; trackStock: boolean };
export type MORecipe = { lines: { ingredientId: string; qtyPerUnit: number; note: string | null }[]; ops: { name: string; hoursPerUnit: number; costPerHour: number }[] };
export type MOInitial = {
  id: string;
  number: string;
  productId: string;
  plannedQty: number;
  productionDeadline: string | null;
  deliveryDeadline: string | null;
  salesOrderId: string | null;
  notes: string | null;
  materials: { productId: string; plannedQty: number; note: string | null }[];
  operations: { name: string; plannedHours: number; costPerHour: number }[];
};
type MatRow = { key: string; itemText: string; productId: string | null; qty: string; note: string };
type OpRow = { key: string; name: string; hours: string; rate: string };

const label = (p: { sku: string; name: string }) => `${p.sku} — ${p.name}`;
const newKey = () => Math.random().toString(36).slice(2);
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const fmt = (n: number) => n.toLocaleString("en-NZ", { maximumFractionDigits: 4 });
const money = (n: number, c: string) => `${n.toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}`;

export function MOEditor({
  items,
  recipes,
  salesOrders,
  initial,
  preset,
  currency,
}: {
  items: MOItem[];
  recipes: Record<string, MORecipe>;
  salesOrders: { id: string; label: string }[];
  initial?: MOInitial;
  preset?: { productId?: string; qty?: number; salesOrderId?: string; deliveryDeadline?: string };
  currency: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const byLabel = useMemo(() => new Map(items.map((i) => [label(i).toLowerCase(), i])), [items]);

  const fromRecipe = (productId: string | null, qty: number): { mats: MatRow[]; ops: OpRow[] } => {
    const r = productId ? recipes[productId] : undefined;
    if (!r) return { mats: [{ key: newKey(), itemText: "", productId: null, qty: "", note: "" }], ops: [] };
    return {
      mats: r.lines.map((l) => ({ key: newKey(), itemText: byId.get(l.ingredientId) ? label(byId.get(l.ingredientId)!) : "", productId: l.ingredientId, qty: String(r4(l.qtyPerUnit * qty)), note: l.note ?? "" })),
      ops: r.ops.map((o) => ({ key: newKey(), name: o.name, hours: String(r4(o.hoursPerUnit * qty)), rate: String(o.costPerHour) })),
    };
  };

  const startProduct = initial?.productId ?? preset?.productId ?? null;
  const startQty = initial?.plannedQty ?? preset?.qty ?? 1;
  const [productId, setProductId] = useState<string | null>(startProduct);
  const [productText, setProductText] = useState(startProduct && byId.get(startProduct) ? label(byId.get(startProduct)!) : "");
  const [qty, setQty] = useState(String(startQty));
  const [productionDeadline, setProductionDeadline] = useState(initial?.productionDeadline ?? "");
  const [deliveryDeadline, setDeliveryDeadline] = useState(initial?.deliveryDeadline ?? preset?.deliveryDeadline ?? "");
  const [salesOrderId, setSalesOrderId] = useState(initial?.salesOrderId ?? preset?.salesOrderId ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  // While the rows still match the recipe, changing product or quantity recalculates them.
  const [followRecipe, setFollowRecipe] = useState(!initial);
  const [mats, setMats] = useState<MatRow[]>(() =>
    initial
      ? initial.materials.map((m) => ({ key: newKey(), itemText: byId.get(m.productId) ? label(byId.get(m.productId)!) : "", productId: m.productId, qty: String(m.plannedQty), note: m.note ?? "" }))
      : fromRecipe(startProduct, startQty).mats,
  );
  const [ops, setOps] = useState<OpRow[]>(() =>
    initial ? initial.operations.map((o) => ({ key: newKey(), name: o.name, hours: String(o.plannedHours), rate: String(o.costPerHour) })) : fromRecipe(startProduct, startQty).ops,
  );

  const product = productId ? byId.get(productId) : undefined;
  const hasRecipe = !!(productId && recipes[productId]);
  const qtyNum = Number(qty) || 0;
  const matCost = mats.reduce((s, m) => s + (m.productId ? (Number(m.qty) || 0) * byId.get(m.productId)!.cost : 0), 0);
  const opCost = ops.reduce((s, o) => s + (Number(o.hours) || 0) * (Number(o.rate) || 0), 0);

  function reload(pid: string | null, q: number) {
    const r = fromRecipe(pid, q);
    setMats(r.mats);
    setOps(r.ops);
  }
  function editMat(key: string, patch: Partial<MatRow>) {
    setFollowRecipe(false);
    setMats((ms) => ms.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  }
  function editOp(key: string, patch: Partial<OpRow>) {
    setFollowRecipe(false);
    setOps((os) => os.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  }

  function save() {
    setError(null);
    if (!productId) return setError("Choose the product to make from the list.");
    const lines = mats.filter((m) => m.itemText || m.qty);
    if (lines.some((m) => !m.productId)) return setError("Pick every material from the list (type a SKU or name).");
    startTransition(async () => {
      const res = await saveMO({
        id: initial?.id ?? null,
        productId,
        plannedQty: qtyNum,
        productionDeadline: productionDeadline || null,
        deliveryDeadline: deliveryDeadline || null,
        salesOrderId: salesOrderId || null,
        notes: notes || null,
        materials: lines.map((m) => ({ productId: m.productId!, plannedQty: Number(m.qty) || 0, note: m.note || null })),
        operations: ops.filter((o) => o.name).map((o) => ({ name: o.name, plannedHours: Number(o.hours) || 0, costPerHour: Number(o.rate) || 0 })),
      });
      if (res.error) return setError(res.error);
      router.push(`/make/orders/${res.id}`);
      router.refresh();
    });
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-4">
      <datalist id="mo-items">
        {items.map((i) => (
          <option key={i.id} value={label(i)} />
        ))}
      </datalist>
      <section className="grid gap-4 rounded border border-line bg-surface p-5">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted">Manufacturing order</div>
          <h1 className="text-2xl font-medium">{initial ? initial.number : "New manufacturing order"}</h1>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="grid gap-1 text-xs text-muted sm:col-span-2">
            Product to make
            <input
              list="mo-items"
              value={productText}
              onChange={(e) => {
                const hit = byLabel.get(e.target.value.trim().toLowerCase());
                setProductText(e.target.value);
                setProductId(hit?.id ?? null);
                if (hit && followRecipe) reload(hit.id, qtyNum);
              }}
              className="input text-sm text-ink"
              placeholder="SKU or name…"
              autoComplete="off"
            />
          </label>
          <label className="grid gap-1 text-xs text-muted">
            Planned quantity {product?.uom && `(${product.uom})`}
            <input
              type="number"
              min="0"
              step="any"
              value={qty}
              onChange={(e) => {
                setQty(e.target.value);
                if (followRecipe) reload(productId, Number(e.target.value) || 0);
              }}
              className="input text-right text-sm text-ink"
            />
          </label>
          <label className="grid gap-1 text-xs text-muted">
            Linked sales order
            <select value={salesOrderId} onChange={(e) => setSalesOrderId(e.target.value)} className="input text-sm text-ink">
              <option value="">— Make to stock —</option>
              {salesOrders.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-muted">
            Production deadline
            <input type="date" value={productionDeadline} onChange={(e) => setProductionDeadline(e.target.value)} className="input text-sm text-ink" />
          </label>
          <label className="grid gap-1 text-xs text-muted">
            Delivery deadline
            <input type="date" value={deliveryDeadline} onChange={(e) => setDeliveryDeadline(e.target.value)} className="input text-sm text-ink" />
          </label>
          <label className="grid gap-1 text-xs text-muted sm:col-span-2">
            Notes (shown on the work order)
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className="input text-sm text-ink" />
          </label>
        </div>
        {product && !hasRecipe && (
          <p className="rounded bg-pending px-3 py-2 text-sm">
            {product.sku} has no recipe yet, so add the materials by hand, or{" "}
            <Link href={`/items/products/${product.id}/recipe`} className="text-link underline">
              set up its recipe
            </Link>{" "}
            first.
          </p>
        )}
      </section>

      <section className="overflow-x-auto rounded border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-4 py-2">
          <span className="font-medium">Materials</span>
          {hasRecipe && (
            <button
              type="button"
              onClick={() => {
                if (!followRecipe && !window.confirm("Replace the materials and operations with the recipe for this quantity?")) return;
                setFollowRecipe(true);
                reload(productId, qtyNum);
              }}
              className="btn-secondary px-2 py-1 text-xs"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Reload from recipe
            </button>
          )}
        </div>
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="border-b border-line px-3 py-2 font-normal">Material</th>
              <th className="w-36 border-b border-line px-3 py-2 text-right font-normal">Planned qty</th>
              <th className="border-b border-line px-3 py-2 text-right font-normal">In stock</th>
              <th className="border-b border-line px-3 py-2 text-right font-normal">Cost</th>
              <th className="border-b border-line px-3 py-2 font-normal">Note</th>
              <th className="w-10 border-b border-line" />
            </tr>
          </thead>
          <tbody>
            {mats.map((m, i) => {
              const item = m.productId ? byId.get(m.productId) : undefined;
              const short = item?.trackStock && item.inStock < (Number(m.qty) || 0) - 1e-9;
              return (
                <tr key={m.key}>
                  <td className="border-b border-line px-3 py-1.5">
                    <input
                      aria-label={`Material ${i + 1}`}
                      list="mo-items"
                      value={m.itemText}
                      onChange={(e) => {
                        const hit = byLabel.get(e.target.value.trim().toLowerCase());
                        editMat(m.key, { itemText: e.target.value, productId: hit?.id ?? null });
                      }}
                      className="input w-full"
                      placeholder="SKU or name…"
                      autoComplete="off"
                    />
                  </td>
                  <td className="border-b border-line px-3 py-1.5">
                    <div className="flex items-center gap-1">
                      <input aria-label={`Material ${i + 1} quantity`} type="number" step="any" min="0" value={m.qty} onChange={(e) => editMat(m.key, { qty: e.target.value })} className="input w-full text-right" />
                      <span className="w-8 text-xs text-muted">{item?.uom}</span>
                    </div>
                  </td>
                  <td className={`border-b border-line px-3 py-2 text-right tabular-nums ${short ? "bg-bad/15 text-bad" : ""}`}>{item ? (item.trackStock ? fmt(item.inStock) : "—") : ""}</td>
                  <td className="border-b border-line px-3 py-2 text-right tabular-nums whitespace-nowrap">{item ? money((Number(m.qty) || 0) * item.cost, currency) : ""}</td>
                  <td className="border-b border-line px-3 py-1.5">
                    <input aria-label={`Material ${i + 1} note`} value={m.note} onChange={(e) => editMat(m.key, { note: e.target.value })} className="input w-full" />
                  </td>
                  <td className="border-b border-line px-1">
                    <button type="button" onClick={() => { setFollowRecipe(false); setMats((ms) => ms.filter((x) => x.key !== m.key)); }} className="icon-btn text-bad" aria-label={`Remove material ${i + 1}`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="flex items-center justify-between px-3 py-2">
          <button type="button" onClick={() => { setFollowRecipe(false); setMats((ms) => [...ms, { key: newKey(), itemText: "", productId: null, qty: "", note: "" }]); }} className="btn-secondary">
            <Plus className="h-4 w-4" /> Add material
          </button>
          <span className="text-sm">Planned materials: <b>{money(matCost, currency)}</b></span>
        </div>
      </section>

      <section className="overflow-x-auto rounded border border-line bg-surface">
        <div className="border-b border-line px-4 py-2 font-medium">Operations</div>
        <table className="w-full min-w-[600px] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="border-b border-line px-3 py-2 font-normal">Operation</th>
              <th className="w-36 border-b border-line px-3 py-2 text-right font-normal">Planned hours</th>
              <th className="w-36 border-b border-line px-3 py-2 text-right font-normal">Cost per hour</th>
              <th className="border-b border-line px-3 py-2 text-right font-normal">Cost</th>
              <th className="w-10 border-b border-line" />
            </tr>
          </thead>
          <tbody>
            {ops.map((o, i) => (
              <tr key={o.key}>
                <td className="border-b border-line px-3 py-1.5">
                  <input aria-label={`Operation ${i + 1}`} value={o.name} onChange={(e) => editOp(o.key, { name: e.target.value })} className="input w-full" />
                </td>
                <td className="border-b border-line px-3 py-1.5">
                  <input aria-label={`Operation ${i + 1} hours`} type="number" step="any" min="0" value={o.hours} onChange={(e) => editOp(o.key, { hours: e.target.value })} className="input w-full text-right" />
                </td>
                <td className="border-b border-line px-3 py-1.5">
                  <input aria-label={`Operation ${i + 1} rate`} type="number" step="any" min="0" value={o.rate} onChange={(e) => editOp(o.key, { rate: e.target.value })} className="input w-full text-right" />
                </td>
                <td className="border-b border-line px-3 py-2 text-right tabular-nums whitespace-nowrap">{money((Number(o.hours) || 0) * (Number(o.rate) || 0), currency)}</td>
                <td className="border-b border-line px-1">
                  <button type="button" onClick={() => { setFollowRecipe(false); setOps((os) => os.filter((x) => x.key !== o.key)); }} className="icon-btn text-bad" aria-label={`Remove operation ${i + 1}`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center justify-between px-3 py-2">
          <button type="button" onClick={() => { setFollowRecipe(false); setOps((os) => [...os, { key: newKey(), name: "", hours: "", rate: "" }]); }} className="btn-secondary">
            <Plus className="h-4 w-4" /> Add operation
          </button>
          <span className="text-sm">Planned operations: <b>{money(opCost, currency)}</b></span>
        </div>
      </section>

      <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-3 border-t border-line bg-page/95 py-3">
        {error ? (
          <p role="alert" className="mr-auto text-sm text-bad">{error}</p>
        ) : (
          <p className="mr-auto text-sm">
            Planned cost <b>{money(matCost + opCost, currency)}</b>
            {qtyNum > 0 && <span className="text-muted"> · {money((matCost + opCost) / qtyNum, currency)} per {product?.uom ?? "unit"}</span>}
          </p>
        )}
        <Link href={initial ? `/make/orders/${initial.id}` : "/make/orders"} className="btn-secondary">
          Cancel
        </Link>
        <button type="button" onClick={save} disabled={pending} className="btn-primary">
          {pending ? "Saving…" : initial ? "Save changes" : "Create manufacturing order"}
        </button>
      </div>
    </div>
  );
}
