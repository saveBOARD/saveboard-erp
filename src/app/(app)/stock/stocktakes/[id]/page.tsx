import clsx from "clsx";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StocktakeCount } from "@/components/stocktake-count";
import { getEntityContext } from "@/lib/dal";
import { getStocktake } from "@/lib/queries/stocktake";

export const metadata: Metadata = { title: "Stocktake · saveBOARD ERP" };

const STATUS: Record<string, { label: string; className: string }> = {
  counting: { label: "In progress", className: "bg-pending text-ink" },
  completed: { label: "Completed", className: "bg-ok text-white" },
  cancelled: { label: "Cancelled", className: "bg-bad text-white" },
};

export default async function StocktakePage(props: PageProps<"/stock/stocktakes/[id]">) {
  const { id } = await props.params;
  const { entity } = await getEntityContext();
  const found = await getStocktake(entity.id, id);
  if (!found) notFound();
  const { st } = found;
  const tz = entity.id === "AUS" ? "Australia/Sydney" : "Pacific/Auckland";
  const when = (d: Date) => d.toLocaleString("en-NZ", { timeZone: tz, dateStyle: "medium", timeStyle: "short" });
  const status = STATUS[st.status];

  return (
    <div className="mx-auto grid max-w-6xl gap-4">
      <Link href="/stock/stocktakes" className="no-print inline-flex items-center gap-1 text-sm text-link hover:underline">
        <ArrowLeft className="h-4 w-4" /> Stocktakes
      </Link>
      <section className="grid gap-2 rounded border border-line bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted">Stocktake</div>
            <h1 className="text-2xl font-medium">
              {st.number} <span className="text-muted">/ {st.reason}</span>
            </h1>
          </div>
          <span className={clsx("rounded px-4 py-1.5 text-sm font-medium", status.className)}>{status.label}</span>
        </div>
        <div className="flex flex-wrap gap-x-8 gap-y-1 text-sm text-muted">
          <span>{st.scope}</span>
          <span>Expected quantities as at {when(st.snapshotAt)}</span>
          {found.by && <span>Started by {found.by}</span>}
          {st.completedAt && <span>Completed {when(st.completedAt)}</span>}
          {st.adjustmentId && (
            <span>
              Posted as{" "}
              <Link href={`/stock/adjustments/${st.adjustmentId}`} className="font-medium text-link hover:underline">
                {found.adjustment}
              </Link>
            </span>
          )}
          {st.status === "completed" && !st.adjustmentId && <span>No differences — nothing posted</span>}
        </div>
        {st.notes && <p className="rounded bg-page px-3 py-2 text-sm">{st.notes}</p>}
        {st.status === "counting" && (
          <p className="text-xs text-muted">
            Count what is physically there now. Stock that moves during the count (shipments, adjustments) is posted separately, so
            count before goods leave or note it against the line.
          </p>
        )}
      </section>
      <StocktakeCount id={id} number={st.number} editable={st.status === "counting"} lines={found.lines} currency={entity.currency} />
    </div>
  );
}
