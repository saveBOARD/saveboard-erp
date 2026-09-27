"use client";

import clsx from "clsx";
import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { saveOrder, type OrderInput } from "@/app/(app)/sell/actions";
import { defaultTaxRate, isExport, lineAmounts, orderTotals } from "@/lib/orders/calc";
import type { EditorCustomer, EditorProduct } from "@/lib/queries/editor-data";

type ShipTo = { name: string; phone: string; line1: string; line2: string; city: string; region: string; postcode: string; country: string };
type Line = {
  key: string;
  itemText: string;
  productId: string | null;
  sku: string | null;
  description: string;
  qty: string;
  unitPrice: string;
  discount: string; // percent, e.g. "10"
  tax: string; // percent, e.g. "15"
};

export type EditorInitial = {
  id: string;
  number: string;
  title: string | null;
  customerId: string;
  customerReference: string | null;
  orderDate: string;
  deliveryDeadline: string | null;
  quoteExpiresOn: string | null;
  shipTo: ShipTo;
  notes: string | null;
  lines: { productId: string | null; sku: string | null; description: string; qty: number; unitPrice: number; discountPct: number; taxRate: number }[];
};

const itemLabel = (p: { sku: string; name: string }) => `${p.sku} — ${p.name}`;
const pctText = (fraction: number) => String(Math.round(fraction * 100 * 10000) / 10000);
const money = (n: number, currency: string) =>
  `${n.toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
const emptyShipTo: ShipTo = { name: "", phone: "", line1: "", line2: "", city: "", region: "", postcode: "", country: "" };
const newKey = () => Math.random().toString(36).slice(2);

function Input(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const { label, className, ...rest } = props;
  return (
    <label className={clsx("grid gap-1 text-xs text-muted", className)}>
      {label}
      <input {...rest} className="input text-sm text-ink" />
    </label>
  );
}

export function OrderEditor({
  kind,
  entity,
  customers,
  products,
  initial,
  today,
  presetCustomerId,
}: {
  kind: "quote" | "order";
  entity: { id: string; currency: string; gstRate: number };
  customers: EditorCustomer[];
  products: EditorProduct[];
  initial?: EditorInitial;
  today: string;
  /** New document started from a customer's page. */
  presetCustomerId?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const customerByName = useMemo(() => new Map(customers.map((c) => [c.name.trim().toLowerCase(), c])), [customers]);
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const productByLabel = useMemo(() => new Map(products.map((p) => [itemLabel(p).toLowerCase(), p])), [products]);

  const preset = !initial && presetCustomerId ? customerById.get(presetCustomerId) : undefined;
  const presetSite = preset ? (preset.sites.find((s) => s.isDefault) ?? preset.sites[0]) : undefined;
  const [customerId, setCustomerId] = useState(initial?.customerId ?? preset?.id ?? "");
  const [customerText, setCustomerText] = useState(initial ? (customerById.get(initial.customerId)?.name ?? "") : (preset?.name ?? ""));
  const [title, setTitle] = useState(initial?.title ?? "");
  const [customerReference, setCustomerReference] = useState(initial?.customerReference ?? "");
  const [orderDate, setOrderDate] = useState(initial?.orderDate ?? today);
  const [deliveryDeadline, setDeliveryDeadline] = useState(initial?.deliveryDeadline ?? "");
  const [quoteExpiresOn, setQuoteExpiresOn] = useState(initial?.quoteExpiresOn ?? "");
  const [shipTo, setShipTo] = useState<ShipTo>(
    initial?.shipTo ??
      (presetSite
        ? {
            name: presetSite.contactName ?? "",
            phone: presetSite.contactPhone ?? "",
            line1: presetSite.line1 ?? "",
            line2: presetSite.line2 ?? "",
            city: presetSite.city ?? "",
            region: presetSite.region ?? "",
            postcode: presetSite.postcode ?? "",
            country: presetSite.country ?? preset?.country ?? "",
          }
        : { ...emptyShipTo, country: preset?.country ?? "" }),
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [lines, setLines] = useState<Line[]>(() =>
    initial
      ? initial.lines.map((l) => {
          const p = l.productId ? productById.get(l.productId) : undefined;
          return {
            key: newKey(),
            itemText: p ? itemLabel(p) : l.sku ? `${l.sku} — ${l.description}` : l.description,
            productId: l.productId,
            sku: l.sku,
            description: l.description,
            qty: String(l.qty),
            unitPrice: String(l.unitPrice),
            discount: pctText(l.discountPct),
            tax: pctText(l.taxRate),
          };
        })
      : [],
  );

  const customer = customerById.get(customerId);
  const exportOrder = isExport(entity.id, shipTo.country);
  const gstPct = pctText(entity.gstRate);

  const parsedLines = lines.map((l) => ({
    qty: Number(l.qty) || 0,
    unitPrice: Number(l.unitPrice) || 0,
    discountPct: (Number(l.discount) || 0) / 100,
    taxRate: (Number(l.tax) || 0) / 100,
  }));
  const totals = orderTotals(parsedLines);

  function applySite(siteId: string) {
    const site = customer?.sites.find((s) => s.id === siteId);
    if (!site) return;
    setShipTo({
      name: site.contactName ?? "",
      phone: site.contactPhone ?? "",
      line1: site.line1 ?? "",
      line2: site.line2 ?? "",
      city: site.city ?? "",
      region: site.region ?? "",
      postcode: site.postcode ?? "",
      country: site.country ?? "",
    });
  }

  function chooseCustomer(text: string) {
    setCustomerText(text);
    const c = customerByName.get(text.trim().toLowerCase());
    setCustomerId(c?.id ?? "");
    if (c && c.id !== customerId) {
      const site = c.sites.find((s) => s.isDefault) ?? c.sites[0];
      setShipTo(
        site
          ? {
              name: site.contactName ?? "",
              phone: site.contactPhone ?? "",
              line1: site.line1 ?? "",
              line2: site.line2 ?? "",
              city: site.city ?? "",
              region: site.region ?? "",
              postcode: site.postcode ?? "",
              country: site.country ?? c.country ?? "",
            }
          : { ...emptyShipTo, country: c.country ?? "" },
      );
    }
  }

  function updateLine(key: string, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function chooseItem(key: string, text: string) {
    const p = productByLabel.get(text.trim().toLowerCase());
    setLines((ls) =>
      ls.map((l) => {
        if (l.key !== key) return l;
        if (!p) return { ...l, itemText: text, productId: null, sku: null, description: text };
        const priceUnset = !l.unitPrice || Number(l.unitPrice) === 0;
        return {
          ...l,
          itemText: text,
          productId: p.id,
          sku: p.sku,
          description: p.name,
          unitPrice: priceUnset && p.lastPrice !== null ? String(p.lastPrice) : l.unitPrice,
          tax: pctText(defaultTaxRate({ gstRate: entity.gstRate, exportOrder, isService: p.isService })),
        };
      }),
    );
  }

  function addLine() {
    setLines((ls) => [
      ...ls,
      { key: newKey(), itemText: "", productId: null, sku: null, description: "", qty: "1", unitPrice: "", discount: "0", tax: exportOrder ? "0" : gstPct },
    ]);
  }

  function save() {
    setError(null);
    if (!customerId) return setError("Choose a customer from the list (start typing their name).");
    const input: OrderInput = {
      id: initial?.id ?? null,
      kind,
      title: title || null,
      customerId,
      customerReference: customerReference || null,
      orderDate,
      deliveryDeadline: deliveryDeadline || null,
      quoteExpiresOn: quoteExpiresOn || null,
      shipToName: shipTo.name || null,
      shipToPhone: shipTo.phone || null,
      shipToLine1: shipTo.line1 || null,
      shipToLine2: shipTo.line2 || null,
      shipToCity: shipTo.city || null,
      shipToRegion: shipTo.region || null,
      shipToPostcode: shipTo.postcode || null,
      shipToCountry: shipTo.country || null,
      notes: notes || null,
      lines: lines.map((l, i) => ({
        productId: l.productId,
        sku: l.sku,
        description: l.description || l.itemText,
        ...parsedLines[i],
      })),
    };
    startTransition(async () => {
      const res = await saveOrder(input);
      if (res.error) return setError(res.error);
      router.push(`/sell/${kind === "quote" ? "quotes" : "orders"}/${res.id}`);
      router.refresh();
    });
  }

  const backHref = initial ? `/sell/${kind === "quote" ? "quotes" : "orders"}/${initial.id}` : `/sell/${kind === "quote" ? "quotes" : "orders"}`;

  return (
    <div className="mx-auto grid max-w-6xl gap-4">
      <datalist id="customer-options">
        {customers.map((c) => (
          <option key={c.id} value={c.name} />
        ))}
      </datalist>
      <datalist id="product-options">
        {products.map((p) => (
          <option key={p.id} value={itemLabel(p)} />
        ))}
      </datalist>

      <section className="grid gap-4 rounded border border-line bg-surface p-5">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted">{kind === "quote" ? "Quote" : "Sales order"}</div>
          <h1 className="text-2xl font-medium">{initial ? initial.number : `New ${kind === "quote" ? "quote" : "sales order"}`}</h1>
          {!initial && <p className="text-xs text-muted">The next SO number is given when you save.</p>}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            label="Customer *"
            id="customer"
            list="customer-options"
            value={customerText}
            onChange={(e) => chooseCustomer(e.target.value)}
            placeholder="Start typing a name…"
            autoComplete="off"
            className="lg:col-span-2"
          />
          <Input label="Reference (shown after the number)" id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Cranbourne north" />
          <Input label="Customer PO / reference" id="customerReference" value={customerReference} onChange={(e) => setCustomerReference(e.target.value)} />
          <Input label="Created" id="orderDate" type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} required />
          <Input label="Delivery deadline" id="deliveryDeadline" type="date" value={deliveryDeadline} onChange={(e) => setDeliveryDeadline(e.target.value)} />
          {kind === "quote" && (
            <Input label="Quote valid until" id="quoteExpiresOn" type="date" value={quoteExpiresOn} onChange={(e) => setQuoteExpiresOn(e.target.value)} />
          )}
        </div>
        {customerText && !customerId && (
          <p className="text-sm text-warn">No customer called &ldquo;{customerText}&rdquo;. Pick one from the list, or add them under Customers first.</p>
        )}
      </section>

      <section className="grid gap-3 rounded border border-line bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">Ship to</h2>
          {customer && customer.sites.length > 0 && (
            <label className="flex items-center gap-2 text-sm text-muted">
              Delivery site
              <select id="site" className="input py-1" defaultValue="" onChange={(e) => applySite(e.target.value)}>
                <option value="" disabled>
                  Choose…
                </option>
                {customer.sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} — {[s.line1, s.city].filter(Boolean).join(", ")}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input label="Site contact" id="shipToName" value={shipTo.name} onChange={(e) => setShipTo({ ...shipTo, name: e.target.value })} />
          <Input label="Contact phone" id="shipToPhone" value={shipTo.phone} onChange={(e) => setShipTo({ ...shipTo, phone: e.target.value })} />
          <Input label="Address line 1" id="shipToLine1" value={shipTo.line1} onChange={(e) => setShipTo({ ...shipTo, line1: e.target.value })} />
          <Input label="Address line 2" id="shipToLine2" value={shipTo.line2} onChange={(e) => setShipTo({ ...shipTo, line2: e.target.value })} />
          <Input label="City" id="shipToCity" value={shipTo.city} onChange={(e) => setShipTo({ ...shipTo, city: e.target.value })} />
          <Input label={entity.id === "AUS" ? "State" : "Region"} id="shipToRegion" value={shipTo.region} onChange={(e) => setShipTo({ ...shipTo, region: e.target.value })} />
          <Input label="Postcode" id="shipToPostcode" value={shipTo.postcode} onChange={(e) => setShipTo({ ...shipTo, postcode: e.target.value })} />
          <Input label="Country" id="shipToCountry" value={shipTo.country} onChange={(e) => setShipTo({ ...shipTo, country: e.target.value })} />
        </div>
        {exportOrder && (
          <p className="rounded bg-[#eef3f8] px-3 py-2 text-sm">
            <b>Export order.</b> New product lines default to 0% GST; freight and other services keep {gstPct}% GST.
          </p>
        )}
      </section>

      <section className="overflow-x-auto rounded border border-line bg-surface">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="border-b border-line px-2 py-2 font-normal">#</th>
              <th className="border-b border-line px-2 py-2 font-normal">Item (type a SKU or name, or free text)</th>
              <th className="w-24 border-b border-line px-2 py-2 text-right font-normal">Quantity</th>
              <th className="w-28 border-b border-line px-2 py-2 text-right font-normal">Price per unit</th>
              <th className="w-20 border-b border-line px-2 py-2 text-right font-normal">Discount %</th>
              <th className="w-20 border-b border-line px-2 py-2 text-right font-normal">GST %</th>
              <th className="w-32 border-b border-line px-2 py-2 text-right font-normal">Total ex GST</th>
              <th className="w-10 border-b border-line" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const p = l.productId ? productById.get(l.productId) : undefined;
              const amounts = lineAmounts(parsedLines[i]);
              return (
                <tr key={l.key} className="align-top">
                  <td className="border-b border-line px-2 py-2 text-muted">{i + 1}</td>
                  <td className="border-b border-line px-2 py-1.5">
                    <input
                      aria-label={`Line ${i + 1} item`}
                      list="product-options"
                      value={l.itemText}
                      onChange={(e) => chooseItem(l.key, e.target.value)}
                      className="input w-full"
                      placeholder="SKU or name…"
                      autoComplete="off"
                    />
                    {!p && l.itemText && <div className="mt-0.5 text-xs text-warn">Free-text line (not a stock item)</div>}
                  </td>
                  <td className="border-b border-line px-2 py-1.5">
                    <div className="flex items-center gap-1">
                      <input aria-label={`Line ${i + 1} quantity`} type="number" min="0" step="any" value={l.qty} onChange={(e) => updateLine(l.key, { qty: e.target.value })} className="input w-full text-right" />
                      <span className="w-8 text-xs text-muted">{p?.uom}</span>
                    </div>
                  </td>
                  <td className="border-b border-line px-2 py-1.5">
                    <input aria-label={`Line ${i + 1} price`} type="number" min="0" step="any" value={l.unitPrice} onChange={(e) => updateLine(l.key, { unitPrice: e.target.value })} className="input w-full text-right" />
                  </td>
                  <td className="border-b border-line px-2 py-1.5">
                    <input aria-label={`Line ${i + 1} discount`} type="number" min="0" max="100" step="any" value={l.discount} onChange={(e) => updateLine(l.key, { discount: e.target.value })} className="input w-full text-right" />
                  </td>
                  <td className="border-b border-line px-2 py-1.5">
                    <select aria-label={`Line ${i + 1} GST`} value={l.tax} onChange={(e) => updateLine(l.key, { tax: e.target.value })} className="input w-full text-right">
                      <option value={gstPct}>{gstPct}%</option>
                      <option value="0">0%</option>
                      {l.tax !== gstPct && l.tax !== "0" && <option value={l.tax}>{l.tax}%</option>}
                    </select>
                  </td>
                  <td className="border-b border-line px-2 py-2 text-right tabular-nums whitespace-nowrap">{money(amounts.subtotal, entity.currency)}</td>
                  <td className="border-b border-line px-1 py-1.5 text-center">
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
              <td colSpan={6} className="px-2 py-2">
                <button type="button" onClick={addLine} className="btn-secondary">
                  <Plus className="h-4 w-4" /> Add line
                </button>
              </td>
              <td className="px-2 pt-2 text-right tabular-nums">
                <div className="text-xs text-muted">Subtotal</div>
                {money(totals.subtotal, entity.currency)}
              </td>
              <td />
            </tr>
            <tr>
              <td colSpan={6} />
              <td className="px-2 text-right tabular-nums">
                <div className="text-xs text-muted">GST</div>
                {money(totals.tax, entity.currency)}
              </td>
              <td />
            </tr>
            <tr>
              <td colSpan={6} />
              <td className="px-2 pb-3 text-right font-bold tabular-nums whitespace-nowrap">
                <div className="text-xs font-normal text-muted">Total</div>
                {money(totals.total, entity.currency)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </section>

      <section className="rounded border border-line bg-surface p-5">
        <label className="grid gap-1 text-xs text-muted">
          Notes (printed on the document: delivery address details, delivery date, site contact…)
          <textarea id="notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className="input text-sm text-ink" />
        </label>
      </section>

      <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-3 border-t border-line bg-page/95 py-3">
        {error && (
          <p role="alert" className="mr-auto text-sm text-bad">
            {error}
          </p>
        )}
        <Link href={backHref} className="btn-secondary">
          Cancel
        </Link>
        <button type="button" onClick={save} disabled={pending} className="btn-primary">
          {pending ? "Saving…" : initial ? "Save changes" : `Create ${kind === "quote" ? "quote" : "sales order"}`}
        </button>
      </div>
    </div>
  );
}
