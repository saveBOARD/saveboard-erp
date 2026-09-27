"use client";

import { CheckCircle2, Pencil, Play, Printer, Undo2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setMOStatus, undoCompletion, type ActionResult } from "@/app/(app)/make/actions";

function Btn({ onClick, children, disabled }: { onClick: () => void; children: React.ReactNode; disabled: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="btn-secondary">
      {children}
    </button>
  );
}

export function MOActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const open = status === "not_started" || status === "in_progress";
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
        {open && (
          <Link href={`/make/orders/${id}/edit`} className="btn-secondary">
            <Pencil className="h-4 w-4" /> Edit
          </Link>
        )}
        <Link href={`/print/mo/${id}`} target="_blank" className="btn-secondary">
          <Printer className="h-4 w-4" /> Work order PDF
        </Link>
        {status === "not_started" && (
          <Btn disabled={pending} onClick={() => run(() => setMOStatus(id, "in_progress"))}>
            <Play className="h-4 w-4" /> Start
          </Btn>
        )}
        {status === "in_progress" && (
          <Btn disabled={pending} onClick={() => run(() => setMOStatus(id, "not_started"))}>
            Back to not started
          </Btn>
        )}
        {open && (
          <Btn disabled={pending} onClick={() => run(() => setMOStatus(id, "cancelled"), "Cancel this manufacturing order? Its materials stop being committed.")}>
            Cancel order
          </Btn>
        )}
        {status === "done" && (
          <Btn
            disabled={pending}
            onClick={() => run(() => undoCompletion(id), "Undo this completion? The materials go back into stock, the finished goods come out, and the order returns to In progress.")}
          >
            <Undo2 className="h-4 w-4" /> Undo completion
          </Btn>
        )}
        {open && (
          <Link href={`/make/orders/${id}/complete`} className="btn-primary">
            <CheckCircle2 className="h-4 w-4" /> Complete
          </Link>
        )}
        {pending && <span className="text-sm text-muted">Working…</span>}
      </div>
      {error && <p className="text-sm text-bad">{error}</p>}
    </div>
  );
}
