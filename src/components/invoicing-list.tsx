"use client";

import { Download, FileSpreadsheet, Undo2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  creditAndExport,
  exportAgain,
  exportCreditsAgain,
  invoiceAndExport,
  undoCredited,
  undoInvoiced,
  type CsvResult,
} from "@/app/(app)/sell/invoicing/actions";

export type InvoicingMode = "to_invoice" | "invoiced" | "credits" | "credited";

export type InvoiceRow = {
  id: string;
  href: string;
  number: string;
  title: string | null; // order title, or the sales order a return is against
  customer: string;
  reference: string | null;
  eventOn: string | null; // shipped (orders) / received or raised (returns)
  invoicedOn: string | null; // invoice or credit date
  dueOn: string | null;
  total: number;
  currency: string;
  export: boolean;
};

const money = (n: number, c: string) => `${n.toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}`;

const MODE = {
  to_invoice: { doc: "Order #", event: "Shipped", date: null, empty: "Nothing to invoice: orders appear here once fully shipped.", pending: true },
  invoiced: { doc: "Order #", event: "Shipped", date: "Invoice date", empty: "No invoiced orders yet.", pending: false },
  credits: { doc: "Return #", event: "Returned", date: null, empty: "No returns waiting for a credit note.", pending: true },
  credited: { doc: "Return #", event: "Returned", date: "Credit date", empty: "No credit notes yet.", pending: false },
} as const;

function download({ csv, filename }: CsvResult) {
  const url = URL.createObjectURL(new Blob([csv!], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename!;
  a.click();
  URL.revokeObjectURL(url);
}

export function InvoicingList({ mode, rows, today, entityCurrency }: { mode: InvoicingMode; rows: InvoiceRow[]; today: string; entityCurrency: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [docDate, setDocDate] = useState(today);
  const m = MODE[mode];
  const credit = mode === "credits" || mode === "credited";
  const all = rows.length > 0 && selected.size === rows.length;
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const totals = new Map<string, number>();
  for (const r of rows.filter((r) => selected.has(r.id))) totals.set(r.currency, (totals.get(r.currency) ?? 0) + r.total);

  function run(action: () => Promise<CsvResult>, message?: string) {
    setError(null);
    setDone(null);
    startTransition(async () => {
      const res = await action();
      if (res.error) return setError(res.error);
      if (res.csv) download(res);
      if (message) setDone(message);
      setSelected(new Set());
      router.refresh();
    });
  }

  function issue() {
    const n = selected.size;
    const ids = [...selected];
    if (credit)
      run(() => creditAndExport({ returnIds: ids, creditDate: docDate }), `${n} credit note${n === 1 ? "" : "s"} marked credited. Import the downloaded file into Xero (see below).`);
    else run(() => invoiceAndExport({ orderIds: ids, invoiceDate: docDate }), `${n} order${n === 1 ? "" : "s"} marked Invoiced. Import the downloaded file into Xero (see below).`);
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3 rounded border border-line bg-surface px-4 py-3">
        {m.pending ? (
          <>
            <label className="flex items-center gap-2 text-sm">
              {credit ? "Credit note date" : "Invoice date"}
              <input type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} className="input" />
            </label>
            <button type="button" disabled={pending || !selected.size} className="btn-primary" onClick={issue}>
              <FileSpreadsheet className="h-4 w-4" /> {credit ? "Credit" : "Invoice"} {selected.size || ""} & download Xero file
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={pending || !selected.size}
            className="btn-secondary"
            onClick={() => run(() => (credit ? exportCreditsAgain([...selected]) : exportAgain([...selected])))}
          >
            <Download className="h-4 w-4" /> Download Xero file again ({selected.size})
          </button>
        )}
        <span className="ml-auto text-sm text-muted">
          {selected.size
            ? `Selected: ${[...totals].map(([c, n]) => money(n, c)).join(" + ")} ex GST`
            : `${rows.length} ${credit ? "return" : "order"}${rows.length === 1 ? "" : "s"}`}
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
              <th className="border-b border-line px-3 py-2 font-normal">{m.doc}</th>
              <th className="border-b border-line px-3 py-2 font-normal">Customer</th>
              <th className="border-b border-line px-3 py-2 font-normal">Customer reference</th>
              <th className="border-b border-line px-3 py-2 font-normal">{m.event}</th>
              {m.date && <th className="border-b border-line px-3 py-2 font-normal">{m.date}</th>}
              {mode === "invoiced" && <th className="border-b border-line px-3 py-2 font-normal">Due</th>}
              <th className="border-b border-line px-3 py-2 text-right font-normal">{credit ? "Credit ex GST" : "Total ex GST"}</th>
              {!m.pending && <th className="w-10 border-b border-line" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={selected.has(r.id) ? "bg-[#eef5fc]" : "hover:bg-[#f7f9fb]"}>
                <td className="border-b border-line px-3 py-2">
                  <input type="checkbox" aria-label={`Select ${r.number}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                </td>
                <td className="border-b border-line px-3 py-2 whitespace-nowrap">
                  <Link href={r.href} className="text-link hover:underline">
                    {r.number}
                    {r.title && ` / ${r.title}`}
                  </Link>
                  {r.export && <span className="ml-2 rounded bg-pending px-1.5 py-0.5 text-xs">Export</span>}
                </td>
                <td className="border-b border-line px-3 py-2">{r.customer}</td>
                <td className="border-b border-line px-3 py-2 text-muted">{r.reference}</td>
                <td className="border-b border-line px-3 py-2 whitespace-nowrap">{r.eventOn}</td>
                {m.date && <td className="border-b border-line px-3 py-2 whitespace-nowrap">{r.invoicedOn}</td>}
                {mode === "invoiced" && <td className="border-b border-line px-3 py-2 whitespace-nowrap">{r.dueOn}</td>}
                <td className="border-b border-line px-3 py-2 text-right tabular-nums whitespace-nowrap">
                  {money(r.total, r.currency)}
                  {r.currency !== entityCurrency && <span className="text-xs text-muted"> (foreign)</span>}
                </td>
                {!m.pending && (
                  <td className="border-b border-line px-1">
                    <button
                      type="button"
                      className="icon-btn"
                      title={credit ? "Undo: not credited" : "Undo: back to Shipped"}
                      aria-label={`Undo ${r.number}`}
                      disabled={pending}
                      onClick={() => {
                        const q = credit
                          ? `Mark ${r.number} as not credited? Only do this if the credit note isn't in Xero, or has been voided there.`
                          : `Put ${r.number} back to Shipped (not invoiced)? Only do this if the invoice isn't in Xero, or has been voided there.`;
                        if (window.confirm(q)) run(() => (credit ? undoCredited(r.id) : undoInvoiced(r.id)));
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
                  {m.empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
