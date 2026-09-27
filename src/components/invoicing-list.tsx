"use client";

import { Download, FileSpreadsheet, Undo2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { exportAgain, invoiceAndExport, undoInvoiced, type CsvResult } from "@/app/(app)/sell/invoicing/actions";

export type InvoiceRow = {
  id: string;
  number: string;
  title: string | null;
  customer: string;
  reference: string | null;
  shippedOn: string | null;
  invoicedOn: string | null;
  dueOn: string | null;
  total: number;
  currency: string;
  export: boolean;
};

const money = (n: number, c: string) => `${n.toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}`;

function download({ csv, filename }: CsvResult) {
  const url = URL.createObjectURL(new Blob([csv!], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename!;
  a.click();
  URL.revokeObjectURL(url);
}

export function InvoicingList({ mode, rows, today, entityCurrency }: { mode: "to_invoice" | "invoiced"; rows: InvoiceRow[]; today: string; entityCurrency: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [invoiceDate, setInvoiceDate] = useState(today);
  const all = rows.length > 0 && selected.size === rows.length;
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const chosen = rows.filter((r) => selected.has(r.id));
  const totals = new Map<string, number>();
  for (const r of chosen) totals.set(r.currency, (totals.get(r.currency) ?? 0) + r.total);

  function run(action: () => Promise<CsvResult>, after?: (res: CsvResult) => void) {
    setError(null);
    setDone(null);
    startTransition(async () => {
      const res = await action();
      if (res.error) return setError(res.error);
      if (res.csv) download(res);
      after?.(res);
      setSelected(new Set());
      router.refresh();
    });
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3 rounded border border-line bg-surface px-4 py-3">
        {mode === "to_invoice" ? (
          <>
            <label className="flex items-center gap-2 text-sm">
              Invoice date
              <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="input" />
            </label>
            <button
              type="button"
              disabled={pending || !selected.size}
              className="btn-primary"
              onClick={() =>
                run(
                  () => invoiceAndExport({ orderIds: [...selected], invoiceDate }),
                  () => setDone(`${selected.size} order${selected.size === 1 ? "" : "s"} marked Invoiced. Import the downloaded file into Xero (see below).`),
                )
              }
            >
              <FileSpreadsheet className="h-4 w-4" /> Invoice {selected.size || ""} & download Xero file
            </button>
          </>
        ) : (
          <button type="button" disabled={pending || !selected.size} className="btn-secondary" onClick={() => run(() => exportAgain([...selected]))}>
            <Download className="h-4 w-4" /> Download Xero file again ({selected.size})
          </button>
        )}
        <span className="ml-auto text-sm text-muted">
          {selected.size
            ? `Selected: ${[...totals].map(([c, n]) => money(n, c)).join(" + ")} ex GST`
            : `${rows.length} order${rows.length === 1 ? "" : "s"}`}
        </span>
        {pending && <span className="text-sm text-muted">Working…</span>}
      </div>
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      {done && <p className="rounded bg-ok/15 px-3 py-2 text-sm text-ok">{done}</p>}

      <div className="overflow-x-auto rounded border border-line bg-surface">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="w-10 border-b border-line px-3 py-2">
                <input type="checkbox" aria-label="Select all" checked={all} onChange={() => setSelected(all ? new Set() : new Set(rows.map((r) => r.id)))} />
              </th>
              <th className="border-b border-line px-3 py-2 font-normal">Order #</th>
              <th className="border-b border-line px-3 py-2 font-normal">Customer</th>
              <th className="border-b border-line px-3 py-2 font-normal">Customer reference</th>
              <th className="border-b border-line px-3 py-2 font-normal">Shipped</th>
              {mode === "invoiced" && <th className="border-b border-line px-3 py-2 font-normal">Invoice date</th>}
              {mode === "invoiced" && <th className="border-b border-line px-3 py-2 font-normal">Due</th>}
              <th className="border-b border-line px-3 py-2 text-right font-normal">Total ex GST</th>
              {mode === "invoiced" && <th className="w-10 border-b border-line" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={selected.has(r.id) ? "bg-[#eef5fc]" : "hover:bg-[#f7f9fb]"}>
                <td className="border-b border-line px-3 py-2">
                  <input type="checkbox" aria-label={`Select ${r.number}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                </td>
                <td className="border-b border-line px-3 py-2 whitespace-nowrap">
                  <Link href={`/sell/orders/${r.id}`} className="text-link hover:underline">
                    {r.number}
                    {r.title && ` / ${r.title}`}
                  </Link>
                  {r.export && <span className="ml-2 rounded bg-pending px-1.5 py-0.5 text-xs">Export</span>}
                </td>
                <td className="border-b border-line px-3 py-2">{r.customer}</td>
                <td className="border-b border-line px-3 py-2 text-muted">{r.reference}</td>
                <td className="border-b border-line px-3 py-2 whitespace-nowrap">{r.shippedOn}</td>
                {mode === "invoiced" && <td className="border-b border-line px-3 py-2 whitespace-nowrap">{r.invoicedOn}</td>}
                {mode === "invoiced" && <td className="border-b border-line px-3 py-2 whitespace-nowrap">{r.dueOn}</td>}
                <td className="border-b border-line px-3 py-2 text-right tabular-nums whitespace-nowrap">
                  {money(r.total, r.currency)}
                  {r.currency !== entityCurrency && <span className="text-xs text-muted"> (foreign)</span>}
                </td>
                {mode === "invoiced" && (
                  <td className="border-b border-line px-1">
                    <button
                      type="button"
                      className="icon-btn"
                      title="Undo: back to Shipped"
                      aria-label={`Undo invoiced for ${r.number}`}
                      disabled={pending}
                      onClick={() => {
                        if (window.confirm(`Put ${r.number} back to Shipped (not invoiced)? Only do this if the invoice isn't in Xero, or has been voided there.`)) run(() => undoInvoiced(r.id));
                      }}
                    >
                      <Undo2 className="h-4 w-4" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={9} className="px-3 py-4 text-muted">
                  {mode === "to_invoice" ? "Nothing to invoice: orders appear here once fully shipped." : "No invoiced orders yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
