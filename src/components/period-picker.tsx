import clsx from "clsx";
import Link from "next/link";
import { PERIODS, type Period } from "@/lib/periods";

/** Period links for a report page (keeps the page, swaps ?period=). Custom ranges use ?from=&to=. */
export function PeriodPicker({ basePath, period }: { basePath: string; period: Period }) {
  return (
    <div className="no-print flex flex-wrap items-center gap-1 text-sm">
      {PERIODS.map((p) => (
        <Link
          key={p.key}
          href={`${basePath}?period=${p.key}`}
          className={clsx("rounded border px-3 py-1", period.key === p.key ? "border-primary bg-primary text-white" : "border-line bg-surface hover:bg-page")}
        >
          {p.label}
        </Link>
      ))}
      <form action={basePath} className="ml-2 flex items-center gap-1 text-xs text-muted">
        <input type="date" name="from" defaultValue={period.key === "custom" ? period.from : ""} className="input py-1" aria-label="From" />
        to
        <input type="date" name="to" defaultValue={period.key === "custom" ? period.to : ""} className="input py-1" aria-label="To" />
        <button type="submit" className="btn-secondary px-2 py-1 text-xs">
          Go
        </button>
      </form>
      <span className="ml-2 text-xs text-muted">
        {period.from === "2000-01-01" ? "All history" : `${period.from} to ${period.to}`}
      </span>
    </div>
  );
}
