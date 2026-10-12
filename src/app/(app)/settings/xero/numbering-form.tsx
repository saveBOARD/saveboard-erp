"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { renumberXeroDrafts, setNextInvoiceNumber, type XeroActionResult } from "./actions";

/** Next invoice number, and renumbering Xero drafts that still carry the sales order number. */
export function InvoiceNumberingForm({ prefix, next, drafts }: { prefix: string; next: number; drafts: string[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(String(next));
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState<XeroActionResult | null>(null);
  const run = (action: () => Promise<XeroActionResult>) =>
    startTransition(async () => {
      setResult(await action());
      setAsking(false);
      router.refresh();
    });

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs text-muted">
          Next invoice number
          <span className="flex items-center gap-1 text-sm text-ink">
            {prefix}
            <input id="nextInvoice" type="number" min="1" step="1" value={value} onChange={(e) => setValue(e.target.value)} className="input w-28 text-right" />
          </span>
        </label>
        <button type="button" className="btn-secondary" disabled={pending || Number(value) === next} onClick={() => run(() => setNextInvoiceNumber(Number(value)))}>
          Save
        </button>
      </div>

      {drafts.length > 0 && (
        <div className="grid gap-2 rounded bg-[#eef3f8] px-4 py-3 text-sm">
          <p>
            <b>{drafts.length}</b> draft invoice{drafts.length === 1 ? " is" : "s are"} in Xero with the sales order number instead of an invoice number:{" "}
            {drafts.join(", ")}. Renumbering gives them {prefix}
            {next} onwards, oldest first, and changes the drafts in Xero (the SO number moves to the Reference).
          </p>
          {!asking ? (
            <div>
              <button type="button" className="btn-primary" disabled={pending} onClick={() => (setResult(null), setAsking(true))}>
                Renumber {drafts.length} draft{drafts.length === 1 ? "" : "s"} in Xero
              </button>
            </div>
          ) : (
            <div role="alertdialog" aria-label="Confirm renumbering" className="grid gap-2 rounded border border-line bg-surface p-3">
              <p className="font-medium">
                Renumber {drafts.length} draft invoice{drafts.length === 1 ? "" : "s"} in Xero as {prefix}
                {next}
                {drafts.length > 1 ? `–${prefix}${next + drafts.length - 1}` : ""}?
              </p>
              <p className="text-muted">Only drafts are changed. Anything already approved in Xero is left as it is and listed afterwards.</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-primary" disabled={pending} onClick={() => run(renumberXeroDrafts)}>
                  {pending ? "Renumbering…" : "Yes, renumber them"}
                </button>
                <button type="button" className="btn-secondary" disabled={pending} onClick={() => setAsking(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {result?.ok && <p className="text-sm text-ok">{result.ok}</p>}
      {result?.error && (
        <p role="alert" className="text-sm text-bad">
          {result.error}
        </p>
      )}
    </div>
  );
}
