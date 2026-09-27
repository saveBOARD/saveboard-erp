"use client";

import Link from "next/link";
import { useActionState } from "react";
import { saveSupplier } from "@/app/(app)/buy/actions";
import type { t } from "@/db";

type Supplier = typeof t.suppliers.$inferSelect;

function Field({ label, name, value, type = "text", wide }: { label: string; name: string; value?: string | number | null; type?: string; wide?: boolean }) {
  return (
    <label className={`grid gap-1 text-xs text-muted ${wide ? "sm:col-span-2" : ""}`}>
      {label}
      <input id={name} name={name} type={type} defaultValue={value ?? ""} className="input text-sm text-ink" />
    </label>
  );
}

export function SupplierForm({ supplier }: { supplier?: Supplier }) {
  const [state, action, pending] = useActionState(saveSupplier, undefined);
  const s = supplier;
  return (
    <form action={action} className="mx-auto grid max-w-3xl gap-4">
      <input type="hidden" name="id" value={s?.id ?? ""} />
      <h1 className="text-xl font-medium">{s ? `Edit ${s.name}` : "New supplier"}</h1>
      <section className="grid gap-4 rounded border border-line bg-surface p-5 sm:grid-cols-2">
        <label className="grid gap-1 text-xs text-muted sm:col-span-2">
          Name *
          <input id="name" name="name" required defaultValue={s?.name ?? ""} className="input text-sm text-ink" />
        </label>
        <Field label="Contact name" name="contactName" value={s?.contactName} />
        <Field label="Phone" name="phone" value={s?.phone} />
        <Field label="Email (for sending POs)" name="email" type="email" value={s?.email} wide />
        <Field label="Lead time (days)" name="leadTimeDays" type="number" value={s?.leadTimeDays} />
        <Field label="Payment terms" name="paymentTerms" value={s?.paymentTerms} />
        <label className="grid gap-1 text-xs text-muted sm:col-span-2">
          Notes
          <textarea id="notes" name="notes" rows={3} defaultValue={s?.notes ?? ""} className="input text-sm text-ink" />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={s?.active ?? true} /> Active
        </label>
      </section>
      <div className="flex items-center justify-end gap-3">
        {state?.error && <p className="mr-auto text-sm text-bad">{state.error}</p>}
        <Link href={s ? `/buy/suppliers/${s.id}` : "/buy/suppliers"} className="btn-secondary">
          Cancel
        </Link>
        <button className="btn-primary" disabled={pending}>
          {pending ? "Saving…" : s ? "Save changes" : "Create supplier"}
        </button>
      </div>
    </form>
  );
}
