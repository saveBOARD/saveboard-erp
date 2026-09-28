"use client";

import { Trash2, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteCustomer, restoreCustomer, type DeleteResult } from "@/app/(app)/sell/customers/actions";

/**
 * Two-step delete: the button opens a confirmation ("Are you sure…?"); only "Yes, delete customer" deletes.
 * A deleted customer's page shows Restore instead.
 */
export function DeleteCustomer({
  id,
  name,
  deleted,
  blockers,
  hasHistory,
}: {
  id: string;
  name: string;
  deleted: boolean;
  blockers: string[];
  hasHistory: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState<DeleteResult | null>(null);

  const run = (action: () => Promise<DeleteResult>) =>
    startTransition(async () => {
      const res = await action();
      setResult(res);
      setAsking(false);
      if (res.gone) router.push("/sell/customers");
      router.refresh();
    });

  if (deleted)
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-secondary" disabled={pending} onClick={() => run(() => restoreCustomer(id))}>
          <Undo2 className="h-4 w-4" /> Restore customer
        </button>
        {result?.ok && <span className="text-sm text-ok">{result.ok}</span>}
        {result?.error && <span className="text-sm text-bad">{result.error}</span>}
      </div>
    );

  return (
    <div className="grid gap-2">
      {!asking ? (
        <div>
          <button type="button" className="btn-secondary text-bad" disabled={pending} onClick={() => (setResult(null), setAsking(true))}>
            <Trash2 className="h-4 w-4" /> Delete customer
          </button>
        </div>
      ) : (
        <div role="alertdialog" aria-label="Confirm delete" className="grid gap-3 rounded border border-bad/40 bg-bad/5 p-4">
          <p className="font-medium">Are you sure you want to delete customer {name}?</p>
          {blockers.length ? (
            <div className="text-sm">
              <p className="text-bad">They can&apos;t be deleted yet. First sort out:</p>
              <ul className="ml-5 list-disc">
                {blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-muted">
              {hasHistory
                ? "They'll disappear from the customer list and the quote and order screens. Their past orders, returns and sales history are kept and still show their name. You can restore them later from Customers → Deleted."
                : "They have no quotes, orders or history, so they'll be removed completely, with their delivery sites. This can't be undone."}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {!blockers.length && (
              <button type="button" className="btn-primary bg-bad" disabled={pending} onClick={() => run(() => deleteCustomer(id))}>
                <Trash2 className="h-4 w-4" /> {pending ? "Deleting…" : "Yes, delete customer"}
              </button>
            )}
            <button type="button" className="btn-secondary" disabled={pending} onClick={() => setAsking(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {result?.ok && <p className="text-sm text-ok">{result.ok}</p>}
      {result?.error && <p className="text-sm text-bad">{result.error}</p>}
    </div>
  );
}
