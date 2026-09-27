import { and, asc, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ReverseAdjustmentButton } from "@/components/reverse-adjustment-button";
import { db, t } from "@/db";
import { getEntityContext } from "@/lib/dal";

export const metadata: Metadata = { title: "Stock adjustment · saveBOARD ERP" };

const fmt = (n: number) => n.toLocaleString("en-NZ", { maximumFractionDigits: 4 });
const money = (n: number, c: string) => `${n.toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}`;

export default async function AdjustmentPage(props: PageProps<"/stock/adjustments/[id]">) {
  const { id } = await props.params;
  const { entity } = await getEntityContext();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [row] = await db
    .select({ a: t.stockAdjustments, by: t.users.displayName })
    .from(t.stockAdjustments)
    .leftJoin(t.users, eq(t.users.id, t.stockAdjustments.createdBy))
    .where(and(eq(t.stockAdjustments.id, id), eq(t.stockAdjustments.entityId, entity.id)));
  if (!row) notFound();
  const { a } = row;
  const [lines, reversedBy, reverses, stocktake] = await Promise.all([
    db
      .select({ l: t.stockAdjustmentLines, sku: t.products.sku, name: t.products.name, uom: t.products.uom, productId: t.products.id })
      .from(t.stockAdjustmentLines)
      .innerJoin(t.products, eq(t.products.id, t.stockAdjustmentLines.productId))
      .where(eq(t.stockAdjustmentLines.adjustmentId, id))
      .orderBy(asc(t.products.name)),
    db.select({ id: t.stockAdjustments.id, number: t.stockAdjustments.number }).from(t.stockAdjustments).where(eq(t.stockAdjustments.reversesId, id)),
    a.reversesId ? db.select({ id: t.stockAdjustments.id, number: t.stockAdjustments.number }).from(t.stockAdjustments).where(eq(t.stockAdjustments.id, a.reversesId)) : [],
    a.stocktakeId ? db.select({ id: t.stocktakes.id, number: t.stocktakes.number }).from(t.stocktakes).where(eq(t.stocktakes.id, a.stocktakeId)) : [],
  ]);
  const total = lines.reduce((s, x) => s + Number(x.l.qty) * Number(x.l.unitCost), 0);

  return (
    <div className="mx-auto grid max-w-5xl gap-4">
      <Link href="/stock/adjustments" className="no-print inline-flex items-center gap-1 text-sm text-link hover:underline">
        <ArrowLeft className="h-4 w-4" /> Stock adjustments
      </Link>
      <section className="grid gap-3 rounded border border-line bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted">Stock adjustment</div>
            <h1 className="text-2xl font-medium">{a.number}</h1>
            <p className="text-sm">{a.reason}</p>
          </div>
          {!reversedBy.length && !a.reversesId && <ReverseAdjustmentButton id={id} number={a.number} />}
        </div>
        <div className="flex flex-wrap gap-x-8 gap-y-1 text-sm text-muted">
          <span>Adjusted {a.adjustedOn}</span>
          <span>{entity.locationName}</span>
          {row.by && <span>By {row.by}</span>}
          {stocktake[0] && (
            <span>
              From stocktake{" "}
              <Link className="text-link hover:underline" href={`/stock/stocktakes/${stocktake[0].id}`}>
                {stocktake[0].number}
              </Link>
            </span>
          )}
          {reverses[0] && (
            <span>
              Reverses{" "}
              <Link className="text-link hover:underline" href={`/stock/adjustments/${reverses[0].id}`}>
                {reverses[0].number}
              </Link>
            </span>
          )}
          {reversedBy[0] && (
            <span className="font-medium text-bad">
              Reversed by{" "}
              <Link className="underline" href={`/stock/adjustments/${reversedBy[0].id}`}>
                {reversedBy[0].number}
              </Link>
            </span>
          )}
        </div>
        {a.notes && <p className="rounded bg-page px-3 py-2 text-sm">{a.notes}</p>}
      </section>
      <section className="overflow-x-auto rounded border border-line bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="border-b border-line px-3 py-2 font-normal">Item</th>
              <th className="border-b border-line px-3 py-2 text-right font-normal">Quantity</th>
              <th className="border-b border-line px-3 py-2 text-right font-normal">Cost per unit</th>
              <th className="border-b border-line px-3 py-2 text-right font-normal">Value</th>
              <th className="border-b border-line px-3 py-2 font-normal">Batch</th>
              <th className="border-b border-line px-3 py-2 font-normal">Note</th>
            </tr>
          </thead>
          <tbody>
            {lines.map(({ l, sku, name, uom, productId }) => (
              <tr key={l.id}>
                <td className="border-b border-line px-3 py-2">
                  <Link href={`/items/products/${productId}`} className="text-link hover:underline">
                    <span className="mr-1 font-mono text-xs text-muted">[{sku}]</span>
                    {name}
                  </Link>
                </td>
                <td className={`border-b border-line px-3 py-2 text-right tabular-nums whitespace-nowrap ${Number(l.qty) < 0 ? "text-bad" : "text-ok"}`}>
                  {Number(l.qty) > 0 ? "+" : ""}
                  {fmt(Number(l.qty))} {uom}
                </td>
                <td className="border-b border-line px-3 py-2 text-right tabular-nums">{money(Number(l.unitCost), entity.currency)}</td>
                <td className="border-b border-line px-3 py-2 text-right tabular-nums">{money(Number(l.qty) * Number(l.unitCost), entity.currency)}</td>
                <td className="border-b border-line px-3 py-2 font-mono text-xs">{l.batchNo}</td>
                <td className="border-b border-line px-3 py-2 text-muted">{l.note}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-bold">
              <td colSpan={3} className="px-3 py-2 text-right">
                Total
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{money(total, entity.currency)}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </section>
    </div>
  );
}
