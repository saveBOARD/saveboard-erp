import { desc, eq, sql } from "drizzle-orm";
import type { Metadata } from "next";
import { DataTable, type Column } from "@/components/data-table";
import { ListHeader } from "@/components/list-header";
import { db, t } from "@/db";
import { getEntityContext } from "@/lib/dal";

export const metadata: Metadata = { title: "Stocktakes · saveBOARD ERP" };

const STATUS: Record<string, string> = { counting: "In progress", completed: "Completed", cancelled: "Cancelled" };

export default async function StocktakesPage() {
  const { entity } = await getEntityContext();
  const s = t.stocktakes;
  const rows = await db
    .select({
      id: s.id,
      number: s.number,
      reason: s.reason,
      scope: s.scope,
      status: s.status,
      createdAt: s.createdAt,
      completedAt: s.completedAt,
      adjustmentId: s.adjustmentId,
      adjustment: t.stockAdjustments.number,
      items: sql<number>`(select count(*)::int from stocktake_lines l where l.stocktake_id = ${s.id})`,
      counted: sql<number>`(select count(*)::int from stocktake_lines l where l.stocktake_id = ${s.id} and l.counted_qty is not null)`,
    })
    .from(s)
    .leftJoin(t.stockAdjustments, eq(t.stockAdjustments.id, s.adjustmentId))
    .where(eq(s.entityId, entity.id))
    .orderBy(desc(s.createdAt));

  const tz = entity.id === "AUS" ? "Australia/Sydney" : "Pacific/Auckland";
  const d = (x: Date | null) => (x ? new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(x) : null);
  const columns: Column[] = [
    { key: "number", label: "Stocktake #", href: "/stock/stocktakes/{id}", width: 100 },
    { key: "reason", label: "Stocktake reason", width: 260 },
    { key: "scope", label: "Items" },
    { key: "progress", label: "Counted" },
    { key: "created", label: "Created date" },
    { key: "completed", label: "Completed date" },
    { key: "adjustment", label: "Stock adjustment #", href: "/stock/adjustments/{adjustmentId}" },
    { key: "status", label: "Status", tones: { Completed: "ok", "In progress": "pending", Cancelled: "bad" } },
  ];
  return (
    <>
      <ListHeader newLabel="Stocktake" newHref="/stock/stocktakes/new" />
      <DataTable
        columns={columns}
        rows={rows.map((r) => ({
          id: r.id,
          number: r.number,
          reason: r.reason,
          scope: r.scope,
          progress: `${r.counted} / ${r.items}`,
          created: d(r.createdAt),
          completed: d(r.completedAt),
          adjustment: r.adjustment,
          adjustmentId: r.adjustmentId,
          status: STATUS[r.status],
        }))}
        exportName={`stocktakes-${entity.id}`}
        noun="stocktakes"
      />
    </>
  );
}
