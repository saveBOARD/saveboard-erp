import { desc, eq, sql } from "drizzle-orm";
import type { Metadata } from "next";
import { DataTable, type Column } from "@/components/data-table";
import { ListHeader } from "@/components/list-header";
import { db, t } from "@/db";
import { getEntityContext } from "@/lib/dal";

export const metadata: Metadata = { title: "Stock adjustments · saveBOARD ERP" };

export default async function AdjustmentsPage() {
  const { entity } = await getEntityContext();
  const a = t.stockAdjustments;
  const rows = await db
    .select({
      id: a.id,
      number: a.number,
      adjustedOn: a.adjustedOn,
      reason: a.reason,
      notes: a.notes,
      by: t.users.displayName,
      lines: sql<number>`(select count(*)::int from stock_adjustment_lines l where l.adjustment_id = ${a.id})`,
      value: sql<string>`(select coalesce(sum(l.qty * l.unit_cost), 0) from stock_adjustment_lines l where l.adjustment_id = ${a.id})`,
    })
    .from(a)
    .leftJoin(t.users, eq(t.users.id, a.createdBy))
    .where(eq(a.entityId, entity.id))
    .orderBy(desc(a.adjustedOn), desc(a.createdAt));

  const columns: Column[] = [
    { key: "number", label: "SA #", href: "/stock/adjustments/{id}", width: 90 },
    { key: "adjustedOn", label: "Adjusted date" },
    { key: "location", label: "Location" },
    { key: "reason", label: "Reason", width: 320 },
    { key: "lines", label: "Lines", kind: "number" },
    { key: "value", label: "Value", kind: "money", total: true },
    { key: "by", label: "By" },
  ];
  return (
    <>
      <ListHeader newLabel="Stock adjustment" newHref="/stock/adjustments/new" />
      <DataTable
        columns={columns}
        rows={rows.map((r) => ({ ...r, location: entity.locationName, value: Math.round(Number(r.value) * 100) / 100 || 0 }))}
        currency={entity.currency}
        exportName={`stock-adjustments-${entity.id}`}
        noun="adjustments"
      />
      <p className="mt-2 text-xs text-muted">Katana stock adjustments before the switch (e.g. NZ SA-1 to SA-80) stay in Katana; numbering here continues after them.</p>
    </>
  );
}
