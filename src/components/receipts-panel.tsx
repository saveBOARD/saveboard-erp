"use client";

import clsx from "clsx";
import { PackageCheck, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { reverseReceipt } from "@/app/(app)/buy/actions";

export type ReceiptSummary = {
  id: string;
  ref: string;
  receivedOn: string;
  supplierRef: string | null;
  notes: string | null;
  by: string | null;
  reversed: string | null;
  lines: { description: string; sku: string | null; qty: number; uom: string | null; batchNo: string | null }[];
};

const fmt = (n: number) => n.toLocaleString("en-NZ", { maximumFractionDigits: 4 });

export function ReceiptsPanel({ receipts, canReverse }: { receipts: ReceiptSummary[]; canReverse: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!receipts.length) return null;
  return (
    <section className="grid gap-3 rounded border border-line bg-surface p-5">
      <h2 className="flex items-center gap-2 font-medium">
        <PackageCheck className="h-4 w-4" /> Goods received
      </h2>
      {error && <p className="text-sm text-bad">{error}</p>}
      {receipts.map((r) => (
        <div key={r.id} className={clsx("rounded border border-line", r.reversed && "opacity-60")}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-page px-4 py-2 text-sm">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <b className={clsx(r.reversed && "line-through")}>{r.ref}</b>
              <span>Received {r.receivedOn}</span>
              {r.supplierRef && <span>Supplier ref {r.supplierRef}</span>}
              {r.by && <span className="text-muted">by {r.by}</span>}
              {r.reversed && <span className="font-medium text-bad">Reversed {r.reversed}</span>}
            </div>
            {!r.reversed && canReverse && (
              <button
                type="button"
                disabled={pending}
                className="btn-secondary no-print px-2 py-1 text-xs text-bad"
                onClick={() => {
                  if (!window.confirm(`Reverse receipt ${r.ref}? The stock is taken back out and the items become outstanding again.`)) return;
                  setError(null);
                  startTransition(async () => {
                    const res = await reverseReceipt(r.id);
                    if (res.error) return setError(res.error);
                    router.refresh();
                  });
                }}
              >
                <Undo2 className="h-3.5 w-3.5" /> Reverse
              </button>
            )}
          </div>
          <table className="w-full text-sm">
            <tbody>
              {r.lines.map((l, i) => (
                <tr key={i}>
                  <td className="px-4 py-1.5">
                    {l.sku && <span className="mr-1 font-mono text-xs text-muted">[{l.sku}]</span>}
                    {l.description}
                  </td>
                  <td className="px-4 py-1.5 text-right tabular-nums whitespace-nowrap">
                    {fmt(l.qty)} {l.uom}
                  </td>
                  <td className="px-4 py-1.5 font-mono text-xs whitespace-nowrap">{l.batchNo ? `Batch ${l.batchNo}` : <span className="text-muted">No batch</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {r.notes && <p className="border-t border-line px-4 py-2 text-xs text-muted">{r.notes}</p>}
        </div>
      ))}
    </section>
  );
}
