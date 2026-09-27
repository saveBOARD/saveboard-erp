"use client";

import clsx from "clsx";
import { Printer, Truck, Undo2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { reverseShipment } from "@/app/(app)/sell/actions";

export type ShipmentSummary = {
  id: string;
  ref: string;
  seq: number;
  shippedOn: string;
  carrier: string | null;
  consignmentNo: string | null;
  notes: string | null;
  by: string | null;
  reversed: string | null;
  lines: { description: string; sku: string | null; qty: number; uom: string | null; batchNo: string | null }[];
};

const fmt = (n: number) => n.toLocaleString("en-NZ", { maximumFractionDigits: 4 });

export function ShipmentsPanel({ orderId, shipments, canReverse }: { orderId: string; shipments: ShipmentSummary[]; canReverse: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!shipments.length) return null;

  function reverse(s: ShipmentSummary) {
    if (!window.confirm(`Reverse shipment ${s.ref}? Its stock is put back and the items become outstanding again.`)) return;
    setError(null);
    startTransition(async () => {
      const res = await reverseShipment(s.id);
      if (res.error) return setError(res.error);
      router.refresh();
    });
  }

  return (
    <section className="grid gap-3 rounded border border-line bg-surface p-5">
      <h2 className="flex items-center gap-2 font-medium">
        <Truck className="h-4 w-4" /> Shipments
      </h2>
      {error && <p className="text-sm text-bad">{error}</p>}
      {shipments.map((s) => (
        <div key={s.id} className={clsx("rounded border border-line", s.reversed && "opacity-60")}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-page px-4 py-2 text-sm">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <b className={clsx(s.reversed && "line-through")}>{s.ref}</b>
              <span>Shipped {s.shippedOn}</span>
              {s.carrier && <span>{s.carrier}</span>}
              {s.consignmentNo && <span>Consignment {s.consignmentNo}</span>}
              {s.by && <span className="text-muted">by {s.by}</span>}
              {s.reversed && <span className="font-medium text-bad">Reversed {s.reversed}</span>}
            </div>
            {!s.reversed && (
              <div className="no-print flex gap-2">
                <Link href={`/print/packing-slip/${orderId}?shipment=${s.seq}&copy=all`} target="_blank" className="btn-secondary px-2 py-1 text-xs">
                  <Printer className="h-3.5 w-3.5" /> Packing slips
                </Link>
                {canReverse && (
                  <button type="button" disabled={pending} onClick={() => reverse(s)} className="btn-secondary px-2 py-1 text-xs text-bad">
                    <Undo2 className="h-3.5 w-3.5" /> Reverse
                  </button>
                )}
              </div>
            )}
          </div>
          <table className="w-full text-sm">
            <tbody>
              {s.lines.map((l, i) => (
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
          {s.notes && <p className="border-t border-line px-4 py-2 text-xs text-muted">{s.notes}</p>}
        </div>
      ))}
    </section>
  );
}
