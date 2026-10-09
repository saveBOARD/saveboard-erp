"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveXeroCoding, type XeroActionResult } from "./actions";

/** Choose the sales account and tax rates used on this entity's Xero invoices and credit notes. */
export function XeroCodingForm({
  accounts,
  taxRates,
  current,
}: {
  accounts: { code: string; name: string }[];
  taxRates: { name: string; rate: number }[];
  current: { accountCode: string; taxOnIncome: string; taxZeroRated: string };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<XeroActionResult | null>(null);
  const has = (list: string[], v: string) => list.includes(v);
  const [accountCode, setAccountCode] = useState(has(accounts.map((a) => a.code), current.accountCode) ? current.accountCode : "");
  const [taxIncome, setTaxIncome] = useState(has(taxRates.map((r) => r.name), current.taxOnIncome) ? current.taxOnIncome : "");
  const [taxZero, setTaxZero] = useState(has(taxRates.map((r) => r.name), current.taxZeroRated) ? current.taxZeroRated : "");
  const missing = [
    !accountCode && `sales account ${current.accountCode}`,
    !taxIncome && `tax rate "${current.taxOnIncome}"`,
    !taxZero && `tax rate "${current.taxZeroRated}"`,
  ].filter(Boolean);

  return (
    <div className="grid gap-3">
      {missing.length > 0 && (
        <p role="alert" className="rounded bg-bad/10 px-3 py-2 text-sm text-bad">
          This Xero organisation has no {missing.join(" or ")}. Choose what to use below and save; invoices can&apos;t be sent to Xero until then.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="grid gap-1 text-xs text-muted">
          Sales account
          <select id="xeroAccount" value={accountCode} onChange={(e) => setAccountCode(e.target.value)} className="input text-sm text-ink">
            <option value="">Choose…</option>
            {accounts.map((a) => (
              <option key={a.code} value={a.code}>
                {a.code} · {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-muted">
          Tax rate for lines with GST
          <select id="xeroTaxIncome" value={taxIncome} onChange={(e) => setTaxIncome(e.target.value)} className="input text-sm text-ink">
            <option value="">Choose…</option>
            {taxRates.map((r) => (
              <option key={r.name} value={r.name}>
                {r.name} ({r.rate}%)
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-muted">
          Tax rate for zero-rated lines (exports)
          <select id="xeroTaxZero" value={taxZero} onChange={(e) => setTaxZero(e.target.value)} className="input text-sm text-ink">
            <option value="">Choose…</option>
            {taxRates.map((r) => (
              <option key={r.name} value={r.name}>
                {r.name} ({r.rate}%)
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-primary"
          disabled={pending || !accountCode || !taxIncome || !taxZero}
          onClick={() =>
            startTransition(async () => {
              setResult(await saveXeroCoding({ accountCode, taxIncome, taxZero }));
              router.refresh();
            })
          }
        >
          {pending ? "Saving…" : "Save invoice coding"}
        </button>
        {result?.ok && <span className="text-sm text-ok">{result.ok}</span>}
        {result?.error && <span className="text-sm text-bad">{result.error}</span>}
      </div>
    </div>
  );
}
