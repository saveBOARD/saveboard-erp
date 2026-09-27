"use client";

import { useActionState } from "react";
import { saveCompany } from "./actions";

type Values = { address: string | null; phone: string | null; email: string | null; website: string | null; taxNumber: string | null; quoteTerms: string | null };

export function CompanyForm({ entityId, values, taxLabel }: { entityId: string; values: Values; taxLabel: string }) {
  const [state, action, pending] = useActionState(saveCompany, undefined);
  return (
    <form action={action} className="grid gap-4 rounded border border-line bg-surface p-5">
      <input type="hidden" name="entityId" value={entityId} />
      <label className="grid gap-1 text-sm">
        Address (as it should print)
        <textarea id="address" name="address" rows={3} defaultValue={values.address ?? ""} className="input" />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          Phone
          <input id="phone" name="phone" defaultValue={values.phone ?? ""} className="input" />
        </label>
        <label className="grid gap-1 text-sm">
          Email
          <input id="email" name="email" type="email" defaultValue={values.email ?? ""} className="input" />
        </label>
        <label className="grid gap-1 text-sm">
          Website
          <input id="website" name="website" defaultValue={values.website ?? ""} className="input" />
        </label>
        <label className="grid gap-1 text-sm">
          {taxLabel}
          <input id="taxNumber" name="taxNumber" defaultValue={values.taxNumber ?? ""} className="input" />
        </label>
      </div>
      <label className="grid gap-1 text-sm">
        Quote terms (printed at the bottom of every quote)
        <textarea id="quoteTerms" name="quoteTerms" rows={4} defaultValue={values.quoteTerms ?? ""} className="input" placeholder="e.g. Prices valid for 30 days. Freight quoted separately…" />
      </label>
      <div className="flex items-center gap-4">
        <button className="btn-primary" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </button>
        {state && <p className={state.error ? "text-sm text-bad" : "text-sm text-ok"}>{state.error ?? state.ok}</p>}
      </div>
    </form>
  );
}
