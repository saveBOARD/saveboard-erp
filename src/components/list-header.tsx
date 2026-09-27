import clsx from "clsx";
import { Plus } from "lucide-react";
import Link from "next/link";

/** Katana-style list header: status tabs on the left, "+ New" on the right, blue rule underneath. */
export function ListHeader({
  tabs,
  newLabel,
  newHref,
  note,
}: {
  tabs?: { label: string; href: string; active: boolean }[];
  newLabel?: string;
  newHref?: string;
  note?: string;
}) {
  return (
    <div className="no-print mb-3 border-b-4 border-primary">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex">
          {tabs?.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              aria-current={t.active ? "page" : undefined}
              className={clsx(
                "border border-b-0 border-line px-5 py-1.5 text-sm",
                t.active ? "border-primary bg-primary font-medium text-white" : "bg-surface text-ink hover:bg-page",
              )}
            >
              {t.label}
            </Link>
          ))}
        </div>
        <div className="mb-2 flex items-center gap-3">
          {note && <span className="text-xs text-muted">{note}</span>}
          {newLabel &&
            (newHref ? (
              <Link href={newHref} className="btn-primary">
                <Plus className="h-4 w-4" /> {newLabel}
              </Link>
            ) : (
              <button type="button" disabled className="btn-primary" title="Coming in a later phase">
                <Plus className="h-4 w-4" /> {newLabel}
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}
