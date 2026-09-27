"use client";

import { PackageCheck, Pencil, Printer, Send } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cancelPO, placePO, setBilled, type ActionResult } from "@/app/(app)/buy/actions";

function Btn({ onClick, children, primary, disabled }: { onClick: () => void; children: React.ReactNode; primary?: boolean; disabled: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={primary ? "btn-primary" : "btn-secondary"}>
      {children}
    </button>
  );
}

export function POActions({ id, status, billed }: { id: string; status: string; billed: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
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
        {(status === "draft" || status === "open") && (
          <Link href={`/buy/orders/${id}/edit`} className="btn-secondary">
            <Pencil className="h-4 w-4" /> Edit
          </Link>
        )}
        <Link href={`/print/po/${id}`} target="_blank" className="btn-secondary">
          <Printer className="h-4 w-4" /> Purchase order PDF
        </Link>
        {status !== "draft" && status !== "cancelled" && (
          <Btn disabled={pending} onClick={() => run(() => setBilled(id, !billed))}>
            {billed ? "Mark not billed" : "Mark billed"}
          </Btn>
        )}
        {(status === "draft" || status === "open") && (
          <Btn disabled={pending} onClick={() => run(() => cancelPO(id), "Cancel this purchase order?")}>
            Cancel order
          </Btn>
        )}
        {status === "draft" && (
          <Btn disabled={pending} primary onClick={() => run(() => placePO(id), "Place this order? It moves to Open, ready to receive against.")}>
            <Send className="h-4 w-4" /> Place order
          </Btn>
        )}
        {status === "open" && (
          <Link href={`/buy/orders/${id}/receive`} className="btn-primary">
            <PackageCheck className="h-4 w-4" /> Receive
          </Link>
        )}
        {pending && <span className="text-sm text-muted">Working…</span>}
      </div>
      {error && <p className="text-sm text-bad">{error}</p>}
    </div>
  );
}
