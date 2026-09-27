"use client";

import { MapPin, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { useActionState, useState } from "react";
import { deleteSite, saveSite } from "@/app/(app)/sell/customers/actions";
import type { t } from "@/db";

type Site = typeof t.customerSites.$inferSelect;

function SiteForm({ customerId, site, onDone, regionLabel }: { customerId: string; site?: Site; onDone: () => void; regionLabel: string }) {
  const [state, action, pending] = useActionState(async (prev: Awaited<ReturnType<typeof saveSite>>, fd: FormData) => {
    const res = await saveSite(prev, fd);
    if (res?.ok) onDone();
    return res;
  }, undefined);
  const f = (label: string, name: keyof Site, wide = false) => (
    <label className={`grid gap-1 text-xs text-muted ${wide ? "sm:col-span-2" : ""}`}>
      {label}
      <input name={name} defaultValue={(site?.[name] as string | null) ?? ""} className="input text-sm text-ink" />
    </label>
  );
  return (
    <form action={action} className="grid gap-3 rounded border border-primary/30 bg-[#f5f8fc] p-4 sm:grid-cols-4">
      <input type="hidden" name="customerId" value={customerId} />
      <input type="hidden" name="siteId" value={site?.id ?? ""} />
      {f("Site name", "name")}
      {f("Site contact", "contactName")}
      {f("Contact phone", "contactPhone")}
      <label className="flex items-end gap-2 pb-2 text-sm">
        <input type="checkbox" name="isDefault" defaultChecked={site?.isDefault ?? false} /> Default delivery site
      </label>
      {f("Address line 1", "line1", true)}
      {f("Address line 2", "line2", true)}
      {f("City", "city")}
      {f(regionLabel, "region")}
      {f("Postcode", "postcode")}
      {f("Country", "country")}
      <div className="flex items-center gap-2 sm:col-span-4">
        <button className="btn-primary" disabled={pending}>
          {pending ? "Saving…" : "Save site"}
        </button>
        <button type="button" onClick={onDone} className="btn-secondary">
          Cancel
        </button>
        {state?.error && <span className="text-sm text-bad">{state.error}</span>}
      </div>
    </form>
  );
}

export function CustomerSites({ customerId, sites, regionLabel }: { customerId: string; sites: Site[]; regionLabel: string }) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  return (
    <section className="grid gap-3 rounded border border-line bg-surface p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Delivery sites</h2>
        {editing === null && (
          <button type="button" onClick={() => setEditing("new")} className="btn-secondary">
            <Plus className="h-4 w-4" /> Add site
          </button>
        )}
      </div>
      {editing === "new" && <SiteForm customerId={customerId} onDone={() => setEditing(null)} regionLabel={regionLabel} />}
      {sites.length === 0 && editing !== "new" && <p className="text-sm text-muted">No delivery sites yet.</p>}
      <ul className="grid gap-2">
        {sites.map((s) =>
          editing === s.id ? (
            <li key={s.id}>
              <SiteForm customerId={customerId} site={s} onDone={() => setEditing(null)} regionLabel={regionLabel} />
            </li>
          ) : (
            <li key={s.id} className="flex flex-wrap items-start justify-between gap-2 rounded border border-line px-4 py-3 text-sm">
              <div className="flex gap-2">
                <MapPin className="mt-0.5 h-4 w-4 text-muted" />
                <div>
                  <div className="font-medium">
                    {s.name}
                    {s.isDefault && (
                      <span className="ml-2 inline-flex items-center gap-1 rounded bg-[#eef3f8] px-1.5 text-xs text-primary">
                        <Star className="h-3 w-3" /> Default
                      </span>
                    )}
                  </div>
                  <div className="text-muted">
                    {[s.line1, s.line2, [s.city, s.region, s.postcode].filter(Boolean).join(" "), s.country].filter(Boolean).join(", ") || "No address"}
                  </div>
                  {(s.contactName || s.contactPhone) && <div className="text-muted">{[s.contactName, s.contactPhone].filter(Boolean).join(" · ")}</div>}
                </div>
              </div>
              <div className="flex gap-1">
                <button type="button" onClick={() => setEditing(s.id)} className="icon-btn" aria-label={`Edit ${s.name}`}>
                  <Pencil className="h-4 w-4" />
                </button>
                <form
                  action={deleteSite}
                  onSubmit={(e) => {
                    if (!window.confirm(`Delete the site "${s.name}"? Existing orders keep their address.`)) e.preventDefault();
                  }}
                >
                  <input type="hidden" name="customerId" value={customerId} />
                  <input type="hidden" name="siteId" value={s.id} />
                  <button className="icon-btn text-bad" aria-label={`Delete ${s.name}`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </form>
              </div>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}
