"use client";

import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { savePO, type POInput } from "@/app/(app)/buy/actions";
import { lineAmounts, orderTotals } from "@/lib/orders/calc";

export type POProduct = { id: string; sku: string; name: string; uom: string | null; isService: boolean; standardCost: number };
export type POInitial = {
  id: string;
  number: string;
  title: string | null;
  supplierId: string;
  orderDate: string;
  expectedOn: string | null;
  currency: string;
  fxRate: number;
  notes: string | null;
  lines: { id: string; productId: string | null; sku: string | null; description: string; qty: number; unitPrice: number; taxRate: number }[];
};
type Line = { key: string; lineId: string | null; itemText: string; productId: string | null; sku: string | null; description: string; qty: string; unitPrice: string; tax: string };

const label = (p: { sku: string; name: string }) => `${p.sku} — ${p.name}`;
const newKey = () => Math.random().toString(36).slice(2);
const pctText = (f: number) => String(Math.round(f * 100 * 10000) / 10000);
const money = (n: number, c: string) => `${n.toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}`;

export function POEditor({
  entity,
  suppliers,
  products,
  lastPrices,
  initial,
  presetSupplierId,
  today,
}: {
  entity: { id: string; currency: string; gstRate: number };
  suppliers: { id: string; name: string; leadTimeDays: number | null }[];
  products: POProduct[];
  /** "supplierId|productId" -> last unit price paid (PO currency) */
  lastPrices: Record<string, number>;
  initial?: POInitial;
  presetSupplierId?: string;
  today: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const supplierById = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers]);
  const supplierByName = useMemo(() => new Map(suppliers.map((s) => [s.name.trim().toLowerCase(), s])), [suppliers]);
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const productByLabel = useMemo(() => new Map(products.map((p) => [label(p).toLowerCase(), p])), [products]);
  const gstPct = pctText(entity.gstRate);

  const startSupplier = initial?.supplierId ?? presetSupplierId ?? "";
  const [supplierId, setSupplierId] = useState(startSupplier);
  const [supplierText, setSupplierText] = useState(supplierById.get(startSupplier)?.name ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [orderDate, setOrderDate] = useState(initial?.orderDate ?? today);
  const [expectedOn, setExpectedOn] = useState(initial?.expectedOn ?? "");
  const [currency, setCurrency] = useState(initial?.currency ?? entity.currency);
  const [fxRate, setFxRate] = useState(String(initial?.fxRate ?? 1));
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [lines, setLines] = useState<Line[]>(() =>
    initial
      ? initial.lines.map((l) => {
          const p = l.productId ? productById.get(l.productId) : undefined;
          return {
            key: newKey(),
            lineId: l.id,
            itemText: p ? label(p) : l.sku ? `${l.sku} — ${l.description}` : l.description,
            productId: l.productId,
            sku: l.sku,
            description: l.description,
            qty: String(l.qty),
            unitPrice: String(l.unitPrice),
            tax: pctText(l.taxRate),
          };
        })
      : [{ key: newKey(), lineId: null, itemText: "", productId: null, sku: null, description: "", qty: "1", unitPrice: "", tax: gstPct }],
  );

  const parsed = lines.map((l) => ({ qty: Number(l.qty) || 0, unitPrice: Number(l.unitPrice) || 0, discountPct: 0, taxRate: (Number(l.tax) || 0) / 100 }));
  const totals = orderTotals(parsed);
  const foreign = currency.toUpperCase() !== entity.currency;

  function chooseSupplier(text: string) {
    setSupplierText(text);
    const s = supplierByName.get(text.trim().toLowerCase());
    setSupplierId(s?.id ?? "");
    if (s?.leadTimeDays && !expectedOn) {
      const d = new Date(`${orderDate}T12:00:00`);
      d.setDate(d.getDate() + s.leadTimeDays);
      setExpectedOn(d.toISOString().slice(0, 10));
    }
  }

  function chooseItem(key: string, text: string) {
    const p = productByLabel.get(text.trim().toLowerCase());
    setLines((ls) =>
      ls.map((l) => {
        if (l.key !== key) return l;
        if (!p) return { ...l, itemText: text, productId: null, sku: null, description: text };
        const last = lastPrices[`${supplierId}|${p.id}`];
        const priceUnset = !l.unitPrice || Number(l.unitPrice) === 0;
        return {
          ...l,
          itemText: text,
          productId: p.id,
          sku: p.sku,
          description: p.name,
          unitPrice: priceUnset ? String(last ?? (foreign ? "" : p.standardCost || "")) : l.unitPrice,
        };
      }),
    );
  }

  const update = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  function save() {
    setError(null);
    if (!supplierId) return setError("Choose a supplier from the list (start typing the name).");
    const input: POInput = {
      id: initial?.id ?? null,
      title: title || null,
      supplierId,
      orderDate,
      expectedOn: expectedOn || null,
      currency: currency.toUpperCase(),
      fxRate: Number(fxRate) || 1,
      notes: notes || null,
      lines: lines
        .filter((l) => l.itemText || Number(l.qty))
        .map((l) => ({
          lineId: l.lineId,
          productId: l.productId,
          sku: l.sku,
          description: l.description || l.itemText,
          qty: Number(l.qty) || 0,
          unitPrice: Number(l.unitPrice) || 0,
          taxRate: (Number(l.tax) || 0) / 100,
        })),
    };
    startTransition(async () => {
      const res = await savePO(input);
      if (res.error) return setError(res.error);
      router.push(`/buy/orders/${res.id}`);
      router.refresh();
    });
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-4">
      <datalist id="po-suppliers">
        {suppliers.map((s) => (
          <option key={s.id} value={s.name} />
        ))}
      </datalist>
      <datalist id="po-items">
        {products.map((p) => (
          <option key={p.id} value={label(p)} />
        ))}
      </datalist>

      <section className="grid gap-4 rounded border border-line bg-surface p-5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2 lg:col-span-4">
          <div className="text-xs uppercase tracking-wide text-muted">Purchase order</div>
          <h1 className="text-2xl font-medium">{initial ? initial.number : "New purchase order"}</h1>
          {!initial && <p className="text-xs text-muted">The next PO number is given when you save. New orders start as drafts.</p>}
        </div>
        <label className="grid gap-1 text-xs text-muted lg:col-span-2">
          Supplier *
          <input id="supplier" list="po-suppliers" value={supplierText} onChange={(e) => chooseSupplier(e.target.value)} className="input text-sm text-ink" placeholder="Start typing a name…" autoComplete="off" />
        </label>
        <label className="grid gap-1 text-xs text-muted lg:col-span-2">
          Reference (shown after the number)
          <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} className="input text-sm text-ink" placeholder="e.g. White LDPE" />
        </label>
        <label className="grid gap-1 text-xs text-muted">
          Order date
          <input id="orderDate" type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} className="input text-sm text-ink" />
        </label>
        <label className="grid gap-1 text-xs text-muted">
          Expected arrival
          <input id="expectedOn" type="date" value={expectedOn} onChange={(e) => setExpectedOn(e.target.value)} className="input text-sm text-ink" />
        </label>
        <label className="grid gap-1 text-xs text-muted">
          Currency
          <input id="currency" value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} className="input text-sm uppercase text-ink" />
        </label>
        {foreign && (
          <label className="grid gap-1 text-xs text-muted">
            Exchange rate ({entity.currency} per 1 {currency})
            <input id="fxRate" type="number" step="any" min="0" value={fxRate} onChange={(e) => setFxRate(e.target.value)} className="input text-sm text-ink" />
          </label>
        )}
        {supplierText && !supplierId && <p className="text-sm text-warn sm:col-span-2 lg:col-span-4">No supplier called &ldquo;{supplierText}&rdquo;. Pick one from the list, or add them under Suppliers first.</p>}
      </section>

      <section className="overflow-x-auto rounded border border-line bg-surface">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="border-b border-line px-2 py-2 font-normal">#</th>
              <th className="border-b border-line px-2 py-2 font-normal">Item (type a SKU or name, or free text)</th>
              <th className="w-28 border-b border-line px-2 py-2 text-right font-normal">Quantity</th>
              <th className="w-32 border-b border-line px-2 py-2 text-right font-normal">Price per unit ({currency})</th>
              <th className="w-20 border-b border-line px-2 py-2 text-right font-normal">GST %</th>
              <th className="w-32 border-b border-line px-2 py-2 text-right font-normal">Total ex GST</th>
              <th className="w-10 border-b border-line" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const p = l.productId ? productById.get(l.productId) : undefined;
              return (
                <tr key={l.key} className="align-top">
                  <td className="border-b border-line px-2 py-2 text-muted">{i + 1}</td>
                  <td className="border-b border-line px-2 py-1.5">
                    <input aria-label={`Line ${i + 1} item`} list="po-items" value={l.itemText} onChange={(e) => chooseItem(l.key, e.target.value)} className="input w-full" placeholder="SKU or name…" autoComplete="off" />
                  </td>
                  <td className="border-b border-line px-2 py-1.5">
                    <div className="flex items-center gap-1">
                      <input aria-label={`Line ${i + 1} quantity`} type="number" min="0" step="any" value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} className="input w-full text-right" />
                      <span className="w-8 text-xs text-muted">{p?.uom}</span>
                    </div>
                  </td>
                  <td className="border-b border-line px-2 py-1.5">
                    <input aria-label={`Line ${i + 1} price`} type="number" min="0" step="any" value={l.unitPrice} onChange={(e) => update(l.key, { unitPrice: e.target.value })} className="input w-full text-right" />
                  </td>
                  <td className="border-b border-line px-2 py-1.5">
                    <select aria-label={`Line ${i + 1} GST`} value={l.tax} onChange={(e) => update(l.key, { tax: e.target.value })} className="input w-full text-right">
                      <option value={gstPct}>{gstPct}%</option>
                      <option value="0">0%</option>
                    </select>
                  </td>
                  <td className="border-b border-line px-2 py-2 text-right tabular-nums whitespace-nowrap">{money(lineAmounts(parsed[i]).subtotal, currency)}</td>
                  <td className="border-b border-line px-1 py-1.5">
                    <button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="icon-btn text-bad" aria-label={`Remove line ${i + 1}`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5} className="px-2 py-2">
                <button type="button" onClick={() => setLines((ls) => [...ls, { key: newKey(), lineId: null, itemText: "", productId: null, sku: null, description: "", qty: "1", unitPrice: "", tax: foreign ? "0" : gstPct }])} className="btn-secondary">
                  <Plus className="h-4 w-4" /> Add line
                </button>
              </td>
              <td className="px-2 py-2 text-right tabular-nums">
                <div className="text-xs text-muted">Subtotal · GST · Total</div>
                <div>{money(totals.subtotal, currency)}</div>
                <div>{money(totals.tax, currency)}</div>
                <div className="font-bold">{money(totals.total, currency)}</div>
                {foreign && <div className="text-xs text-muted">≈ {money(totals.total * (Number(fxRate) || 0), entity.currency)}</div>}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </section>

      <section className="rounded border border-line bg-surface p-5">
        <label className="grid gap-1 text-xs text-muted">
          Notes for the supplier (printed on the PO: delivery instructions, ship-to, contact…)
          <textarea id="notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className="input text-sm text-ink" />
        </label>
      </section>

      <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-3 border-t border-line bg-page/95 py-3">
        {error && <p role="alert" className="mr-auto text-sm text-bad">{error}</p>}
        <Link href={initial ? `/buy/orders/${initial.id}` : "/buy/orders"} className="btn-secondary">
          Cancel
        </Link>
        <button type="button" onClick={save} disabled={pending} className="btn-primary">
          {pending ? "Saving…" : initial ? "Save changes" : "Create draft"}
        </button>
      </div>
    </div>
  );
}
