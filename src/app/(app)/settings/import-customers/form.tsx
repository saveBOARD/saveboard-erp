"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { type Column, DataTable } from "@/components/data-table";
import type { ImportResult } from "@/lib/imports/katana-customers";
import { runCustomerImport } from "./actions";

const columns: Column[] = [
  { key: "katanaName", label: "Katana name" },
  { key: "appName", label: "App customer" },
  {
    key: "outcome",
    label: "Outcome",
    tones: { "Filled in": "ok", Created: "info", Skipped: "bad", "Nothing missing": "pending", "In the app only": "pending" },
  },
  { key: "detail", label: "Details" },
  { key: "sitesAdded", label: "Delivery sites added", kind: "number", total: true },
  { key: "katanaIds", label: "Katana customer ID", hidden: true },
];

/** Skipped first (they need a person), then what changes, then the rest. */
const ORDER = ["Skipped", "Filled in", "Created", "Nothing missing", "In the app only"];

export function ImportCustomersForm({ entityId }: { entityId: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run(apply: boolean) {
    if (!file) return;
    if (apply && !confirm(`Save these changes to the ${entityId} customers?`)) return;
    const fd = new FormData();
    fd.set("file", file);
    fd.set("entityId", entityId);
    fd.set("apply", apply ? "1" : "");
    start(async () => {
      const res = await runCustomerImport(fd);
      setError(res.error ?? null);
      setResult(res.result ?? null);
    });
  }

  const c = result?.counts;
  const changes = c ? c.filled + c.created : 0;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3 rounded border border-line bg-surface p-4">
        <label className="grid gap-1 text-sm">
          Katana customer export
          <input
            type="file"
            accept=".xlsx"
            className="text-sm"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setResult(null);
              setError(null);
            }}
          />
        </label>
        <button type="button" className="btn-secondary" disabled={!file || pending} onClick={() => run(false)}>
          {pending && !result ? "Reading…" : "Preview"}
        </button>
        {result && !result.applied && changes > 0 && (
          <button type="button" className="btn-primary" disabled={pending} onClick={() => run(true)}>
            {pending ? "Saving…" : `Apply ${changes} change${changes > 1 ? "s" : ""}`}
          </button>
        )}
      </div>

      {error && <p className="text-sm text-bad">{error}</p>}

      {result && c && (
        <>
          <div className={`rounded border p-4 text-sm ${result.applied ? "border-ok bg-surface" : "border-line bg-surface"}`}>
            <p className="font-medium">
              {result.applied
                ? `Saved: ${c.filled} filled in, ${c.created} added, ${c.sites} delivery sites added.`
                : changes
                  ? "Preview — nothing has been saved yet. Check the list below, then click Apply."
                  : "Nothing to import — every customer in this file is already up to date."}
            </p>
            <ul className="mt-2 grid gap-x-6 gap-y-1 text-muted sm:grid-cols-3">
              <li>{c.katana} customers in the file</li>
              <li>
                <b className="text-ink">{c.filled}</b> {result.applied ? "filled in" : "to fill in"}
              </li>
              <li>
                <b className="text-ink">{c.created}</b> {result.applied ? "added" : "to add (not in the app yet)"}
              </li>
              <li>{c.unchanged} already complete</li>
              <li>
                <b className={c.skipped ? "text-bad" : "text-ink"}>{c.skipped}</b> skipped — name unclear (see Details)
              </li>
              <li>{c.appOnly} in the app but not in Katana (left alone)</li>
            </ul>
            {result.applied && (
              <p className="mt-2">
                <Link href="/sell/customers" className="text-link hover:underline">
                  Go to Customers
                </Link>
              </p>
            )}
          </div>
          <DataTable
            columns={columns}
            rows={[...result.rows].sort((a, b) => ORDER.indexOf(a.outcome) - ORDER.indexOf(b.outcome))}
            exportName={`customer-import-${result.applied ? "result" : "preview"}-${entityId}`}
            noun="customers"
          />
        </>
      )}
    </div>
  );
}
