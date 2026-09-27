"use client";

import { ArrowRightLeft, FileText, Pencil, Printer, Truck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { convertToOrder, setOrderStatus, setQuoteStatus, type ActionResult } from "@/app/(app)/sell/actions";

type Props = { id: string; kind: "quote" | "order"; status: string; quoteStatus: string | null };

function Btn({ onClick, children, primary, disabled }: { onClick: () => void; children: React.ReactNode; primary?: boolean; disabled: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={primary ? "btn-primary" : "btn-secondary"}>
      {children}
    </button>
  );
}

export function OrderActions({ id, kind, status, quoteStatus }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<ActionResult>, confirmText?: string, goTo?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (res.error) return setError(res.error);
      if (goTo) router.push(goTo);
      router.refresh();
    });
  }

  return (
    <div className="no-print grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {kind === "quote" ? (
          <>
            <Link href={`/sell/quotes/${id}/edit`} className="btn-secondary">
              <Pencil className="h-4 w-4" /> Edit
            </Link>
            <Link href={`/print/quote/${id}`} target="_blank" className="btn-secondary">
              <Printer className="h-4 w-4" /> Quote PDF
            </Link>
            {quoteStatus === "draft" && <Btn disabled={pending} onClick={() => run(() => setQuoteStatus(id, "sent"))}>Mark as sent</Btn>}
            {(quoteStatus === "declined" || quoteStatus === "expired") && (
              <Btn disabled={pending} onClick={() => run(() => setQuoteStatus(id, "sent"))}>Reopen quote</Btn>
            )}
            {(quoteStatus === "draft" || quoteStatus === "sent") && (
              <>
                <Btn disabled={pending} onClick={() => run(() => setQuoteStatus(id, "declined"), "Mark this quote as declined?")}>Declined</Btn>
                <Btn
                  disabled={pending}
                  primary
                  onClick={() =>
                    run(() => convertToOrder(id), "Convert this quote to a sales order? It keeps the same number and all lines.", `/sell/orders/${id}`)
                  }
                >
                  <ArrowRightLeft className="h-4 w-4" /> Convert to sales order
                </Btn>
              </>
            )}
          </>
        ) : (
          <>
            {(status === "open" || status === "picked") && (
              <Link href={`/sell/orders/${id}/edit`} className="btn-secondary">
                <Pencil className="h-4 w-4" /> Edit
              </Link>
            )}
            <Link href={`/print/order/${id}`} target="_blank" className="btn-secondary">
              <FileText className="h-4 w-4" /> Order acknowledgement
            </Link>
            <details className="relative">
              <summary className="btn-secondary cursor-pointer list-none">
                <Printer className="h-4 w-4" /> Packing slip
              </summary>
              <div className="absolute z-20 mt-1 grid w-48 overflow-hidden rounded-md bg-surface text-sm shadow-lg ring-1 ring-line">
                {[
                  ["picker", "Picker copy"],
                  ["transport", "Transport copy"],
                  ["customer", "Customer copy"],
                  ["all", "All three copies"],
                ].map(([copy, label]) => (
                  <Link key={copy} href={`/print/packing-slip/${id}?copy=${copy}`} target="_blank" className="px-4 py-2 hover:bg-page">
                    {label}
                  </Link>
                ))}
              </div>
            </details>
            {status === "open" && <Btn disabled={pending} onClick={() => run(() => setOrderStatus(id, "picked"))}>Mark picked</Btn>}
            {status === "picked" && <Btn disabled={pending} onClick={() => run(() => setOrderStatus(id, "open"))}>Back to open</Btn>}
            {(status === "open" || status === "picked") && (
              <>
                <Btn disabled={pending} onClick={() => run(() => setOrderStatus(id, "cancelled"), "Cancel this sales order? Its stock is released.")}>Cancel order</Btn>
                <Link href={`/sell/orders/${id}/ship`} className="btn-primary">
                  <Truck className="h-4 w-4" /> Ship
                </Link>
              </>
            )}
            {status === "shipped" && (
              <Btn disabled={pending} primary onClick={() => run(() => setOrderStatus(id, "invoiced"))}>
                Mark invoiced
              </Btn>
            )}
            {status === "invoiced" && <Btn disabled={pending} onClick={() => run(() => setOrderStatus(id, "closed"))}>Close order</Btn>}
          </>
        )}
        {pending && <span className="text-sm text-muted">Working…</span>}
      </div>
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
    </div>
  );
}
