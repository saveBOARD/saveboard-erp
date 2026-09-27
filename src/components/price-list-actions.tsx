"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deletePriceList, makeDefault } from "@/app/(app)/sell/price-lists/actions";

export function PriceListActions({ id, name, isDefault }: { id: string; name: string; isDefault: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (isDefault) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        className="btn-secondary"
        onClick={() => {
          if (!window.confirm(`Make "${name}" the default price list? Customers without a list of their own will get its prices.`)) return;
          setError(null);
          startTransition(async () => {
            const res = await makeDefault(id);
            if (res.error) return setError(res.error);
            router.refresh();
          });
        }}
      >
        Make default
      </button>
      <button
        type="button"
        disabled={pending}
        className="btn-secondary text-bad"
        onClick={() => {
          if (!window.confirm(`Delete the "${name}" price list and all its prices?`)) return;
          setError(null);
          startTransition(async () => {
            const res = await deletePriceList(id);
            if (res.error) return setError(res.error);
            router.push("/sell/price-lists");
            router.refresh();
          });
        }}
      >
        Delete
      </button>
      {error && <span className="text-sm text-bad">{error}</span>}
    </div>
  );
}
