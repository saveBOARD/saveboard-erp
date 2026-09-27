"use client";

import { Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { reverseAdjustment } from "@/app/(app)/stock/actions";

export function ReverseAdjustmentButton({ id, number }: { id: string; number: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-sm text-bad">{error}</span>}
      <button
        type="button"
        disabled={pending}
        className="btn-secondary text-bad"
        onClick={() => {
          if (!window.confirm(`Reverse ${number}? A new adjustment with the opposite quantities is posted.`)) return;
          setError(null);
          startTransition(async () => {
            const res = await reverseAdjustment(id);
            if (res.error) return setError(res.error);
            router.push(`/stock/adjustments/${res.id}`);
            router.refresh();
          });
        }}
      >
        <Undo2 className="h-4 w-4" /> {pending ? "Reversing…" : "Reverse"}
      </button>
    </div>
  );
}
