"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { saveProduct } from "@/app/(app)/items/products/actions";
import type { t } from "@/db";

type Product = typeof t.products.$inferSelect;

export function ProductForm({
  product,
  currency,
  suppliers,
  categories,
  uoms,
}: {
  product?: Product;
  currency: string;
  suppliers: { id: string; name: string }[];
  categories: string[];
  uoms: string[];
}) {
  const [state, action, pending] = useActionState(saveProduct, undefined);
  const p = product;
  const [type, setType] = useState(p?.type ?? "product");
  return (
    <form action={action} className="mx-auto grid max-w-3xl gap-4">
      <input type="hidden" name="id" value={p?.id ?? ""} />
      <datalist id="category-options">
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <datalist id="uom-options">
        {uoms.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>
      <h1 className="text-xl font-medium">{p ? `Edit ${p.sku}` : "New item"}</h1>

      <section className="grid gap-4 rounded border border-line bg-surface p-5 sm:grid-cols-3">
        <label className="grid gap-1 text-xs text-muted">
          SKU / variant code *
          <input id="sku" name="sku" required defaultValue={p?.sku ?? ""} className="input font-mono text-sm text-ink" />
        </label>
        <label className="grid gap-1 text-xs text-muted sm:col-span-2">
          Name *
          <input id="name" name="name" required defaultValue={p?.name ?? ""} className="input text-sm text-ink" />
        </label>
        <label className="grid gap-1 text-xs text-muted">
          Type
          <select id="type" name="type" value={type} onChange={(e) => setType(e.target.value as typeof type)} className="input text-sm text-ink">
            <option value="product">Product (sold)</option>
            <option value="material">Material (used in production)</option>
            <option value="service">Service (freight, fees; no stock)</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs text-muted">
          Category
          <input id="category" name="category" list="category-options" defaultValue={p?.category ?? ""} className="input text-sm text-ink" />
        </label>
        <label className="grid gap-1 text-xs text-muted">
          Unit of measure
          <input id="uom" name="uom" list="uom-options" defaultValue={p?.uom ?? "pcs"} className="input text-sm text-ink" />
        </label>
      </section>

      <section className="grid gap-4 rounded border border-line bg-surface p-5 sm:grid-cols-3">
        <label className="grid gap-1 text-xs text-muted">
          Standard cost ({currency} per unit)
          <input id="standardCost" name="standardCost" type="number" step="any" min="0" defaultValue={p ? String(Number(p.standardCost)) : ""} className="input text-sm text-ink" />
        </label>
        <label className="grid gap-1 text-xs text-muted sm:col-span-2">
          Default supplier
          <select id="defaultSupplierId" name="defaultSupplierId" defaultValue={p?.defaultSupplierId ?? ""} className="input text-sm text-ink">
            <option value="">—</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-muted">
          Safety stock (reorder below)
          <input id="safetyStock" name="safetyStock" type="number" step="any" min="0" defaultValue={p ? String(Number(p.safetyStock)) : "0"} className="input text-sm text-ink" />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="trackStock" defaultChecked={p?.trackStock ?? true} disabled={type === "service"} />
          Track stock
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={p?.active ?? true} />
          Active
        </label>
        {p?.costSetManually && <p className="text-xs text-muted sm:col-span-3">This cost was set in the app, so Katana imports won&apos;t overwrite it.</p>}
      </section>

      <div className="flex items-center justify-end gap-3">
        {state?.error && (
          <p role="alert" className="mr-auto text-sm text-bad">
            {state.error}
          </p>
        )}
        <Link href={p ? `/items/products/${p.id}` : "/items/products"} className="btn-secondary">
          Cancel
        </Link>
        <button className="btn-primary" disabled={pending}>
          {pending ? "Saving…" : p ? "Save changes" : "Create item"}
        </button>
      </div>
    </form>
  );
}
