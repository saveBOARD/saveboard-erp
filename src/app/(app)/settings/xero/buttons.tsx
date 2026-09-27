"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { checkXero, disconnectXero, refreshNow, type XeroActionResult } from "./actions";

export function XeroButtons({ connected, orgName }: { connected: boolean; orgName: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<XeroActionResult | null>(null);
  const run = (action: () => Promise<XeroActionResult>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setResult(null);
    startTransition(async () => {
      setResult(await action());
      router.refresh();
    });
  };
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {/* A plain link on purpose: a full page load to the route handler, which sends the browser to Xero's sign-in. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/api/xero/connect" className={connected ? "btn-secondary" : "btn-primary"}>
          {connected ? "Reconnect" : "Connect to Xero"}
        </a>
        {connected && (
          <>
            <button type="button" className="btn-secondary" disabled={pending} onClick={() => run(checkXero)}>
              Check settings
            </button>
            <button type="button" className="btn-secondary" disabled={pending} onClick={() => run(refreshNow)}>
              Refresh payments now
            </button>
            <button type="button" className="btn-secondary text-bad" disabled={pending} onClick={() => run(disconnectXero, `Disconnect from ${orgName}? Invoices already in Xero stay there.`)}>
              Disconnect
            </button>
          </>
        )}
        {pending && <span className="text-sm text-muted">Talking to Xero…</span>}
      </div>
      {result?.ok && <p className="text-sm text-ok">{result.ok}</p>}
      {result?.error && <p className="text-sm text-bad">{result.error}</p>}
    </div>
  );
}
