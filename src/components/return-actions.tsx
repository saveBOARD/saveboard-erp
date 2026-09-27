"use client";

import { PackageCheck, Undo2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cancelReturn, receiveReturn, undoReceive, type ActionResult } from "@/app/(app)/sell/returns/actions";

export function ReturnActions({ id, status, credited, today }: { id: string; status: string; credited: boolean; today: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [receivedOn, setReceivedOn] = useState(today);
  function run(action: () => Promise<ActionResult>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (res.error) return setError(res.error);
      router.refresh();
    });
  }
  return (
    <div className="no-print grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {status === "open" && (
          <>
            <label className="flex items-center gap-2 text-sm">
              Received on
              <input type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} className="input" />
            </label>
            <button type="button" disabled={pending} className="btn-primary" onClick={() => run(() => receiveReturn({ id, receivedOn }), "Mark the goods as received? Restock lines go back into stock.")}>
              <PackageCheck className="h-4 w-4" /> Goods received
            </button>
            {!credited && (
              <button type="button" disabled={pending} className="btn-secondary" onClick={() => run(() => cancelReturn(id), "Cancel this return? (e.g. the customer kept the goods)")}>
                Cancel return
              </button>
            )}
          </>
        )}
        {status === "received" && (
          <button
            type="button"
            disabled={pending}
            className="btn-secondary"
            onClick={() => run(() => undoReceive(id), "Undo the receipt? The restocked goods come back out of stock and the return goes back to Open.")}
          >
            <Undo2 className="h-4 w-4" /> Undo received
          </button>
        )}
        {status !== "cancelled" && !credited && (
          <Link href="/sell/invoicing?tab=credits" className="btn-secondary">
            Credit note in Invoicing →
          </Link>
        )}
        {pending && <span className="text-sm text-muted">Working…</span>}
      </div>
      {error && <p className="text-sm text-bad">{error}</p>}
    </div>
  );
}
