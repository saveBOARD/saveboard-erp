"use client";

import Link from "next/link";
import { useActionState } from "react";
import { saveCustomer } from "@/app/(app)/sell/customers/actions";
import type { t } from "@/db";

type Customer = typeof t.customers.$inferSelect;

const TERMS = ["COD", "7 days", "14 days", "20th of the month following", "Net 30", "Prepaid"];

function Field({ label, name, defaultValue, type = "text", wide, list, placeholder }: {
  label: string;
  name: string;
  defaultValue?: string | null;
  type?: string;
  wide?: boolean;
  list?: string;
  placeholder?: string;
}) {
  return (
    <label className={`grid gap-1 text-xs text-muted ${wide ? "sm:col-span-2" : ""}`}>
      {label}
      <input id={name} name={name} type={type} defaultValue={defaultValue ?? ""} list={list} placeholder={placeholder} step={type === "number" ? "any" : undefined} className="input text-sm text-ink" />
    </label>
  );
}

export function CustomerForm({
  customer,
  entity,
  priceLists,
}: {
  customer?: Customer;
  entity: { id: string; currency: string; businessNumberLabel: string };
  priceLists: { id: string; name: string; isDefault: boolean }[];
}) {
  const [state, action, pending] = useActionState(saveCustomer, undefined);
  const c = customer;
  return (
    <form action={action} className="mx-auto grid max-w-4xl gap-4">
      <input type="hidden" name="id" value={c?.id ?? ""} />
      <datalist id="terms-options">
        {TERMS.map((x) => (
          <option key={x} value={x} />
        ))}
      </datalist>
      <h1 className="text-xl font-medium">{c ? `Edit ${c.name}` : "New customer"}</h1>

      <section className="grid gap-4 rounded border border-line bg-surface p-5 sm:grid-cols-4">
        <label className="grid gap-1 text-xs text-muted sm:col-span-3">
          Name *
          <input id="name" name="name" required defaultValue={c?.name ?? ""} className="input text-sm text-ink" />
        </label>
        <Field label="Customer ID" name="code" defaultValue={c?.code} />
        <Field label="Contact name" name="contactName" defaultValue={c?.contactName} />
        <Field label="Phone" name="phone" defaultValue={c?.phone} />
        <Field label="Email" name="email" type="email" defaultValue={c?.email} wide />
      </section>

      <section className="grid gap-4 rounded border border-line bg-surface p-5 sm:grid-cols-4">
        <h2 className="font-medium sm:col-span-4">Billing address</h2>
        <Field label="Address line 1" name="billingLine1" defaultValue={c?.billingLine1} wide />
        <Field label="Address line 2" name="billingLine2" defaultValue={c?.billingLine2} wide />
        <Field label="City" name="billingCity" defaultValue={c?.billingCity} />
        <Field label={entity.id === "AUS" ? "State" : "Region"} name="billingRegion" defaultValue={c?.billingRegion} />
        <Field label="Postcode" name="billingPostcode" defaultValue={c?.billingPostcode} />
        <Field label="Country" name="billingCountry" defaultValue={c?.billingCountry ?? (entity.id === "AUS" ? "Australia" : "New Zealand")} />
      </section>

      <section className="grid gap-4 rounded border border-line bg-surface p-5 sm:grid-cols-4">
        <h2 className="font-medium sm:col-span-4">Terms & credit</h2>
        <Field label={entity.businessNumberLabel} name="businessNumber" defaultValue={c?.businessNumber} />
        <Field label="Payment terms" name="paymentTerms" defaultValue={c?.paymentTerms} list="terms-options" />
        <label className="grid gap-1 text-xs text-muted">
          Price list
          <select id="priceListId" name="priceListId" defaultValue={c?.priceListId ?? ""} className="input text-sm text-ink">
            <option value="">Default ({priceLists.find((p) => p.isDefault)?.name ?? "none"})</option>
            {priceLists
              .filter((p) => !p.isDefault)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>
        <Field label={`Credit limit (${entity.currency})`} name="creditLimit" type="number" defaultValue={c?.creditLimit ? String(Number(c.creditLimit)) : ""} />
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" name="creditHold" defaultChecked={c?.creditHold ?? false} />
          <span>
            <b>Credit hold</b>: no new sales orders until released
          </span>
        </label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" name="active" value="on" defaultChecked={c?.active ?? true} onChange={(e) => {
            const hidden = e.currentTarget.form?.elements.namedItem("activeOff") as HTMLInputElement | null;
            if (hidden) hidden.disabled = e.currentTarget.checked;
          }} />
          Active (untick to hide from the order screens)
        </label>
        <input type="hidden" name="active" value="off" id="activeOff" disabled={c?.active ?? true} />
      </section>

      <section className="rounded border border-line bg-surface p-5">
        <label className="grid gap-1 text-xs text-muted">
          Notes (internal)
          <textarea id="notes" name="notes" rows={4} defaultValue={c?.notes ?? ""} className="input text-sm text-ink" />
        </label>
      </section>

      <div className="flex items-center justify-end gap-3">
        {state?.error && (
          <p role="alert" className="mr-auto text-sm text-bad">
            {state.error}
          </p>
        )}
        <Link href={c ? `/sell/customers/${c.id}` : "/sell/customers"} className="btn-secondary">
          Cancel
        </Link>
        <button className="btn-primary" disabled={pending}>
          {pending ? "Saving…" : c ? "Save changes" : "Create customer"}
        </button>
      </div>
    </form>
  );
}
