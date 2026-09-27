import clsx from "clsx";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { db, t } from "@/db";
import { getEntityContext } from "@/lib/dal";
import { AVAILABILITY_LABEL, stockPosition } from "@/lib/queries/availability";
import { MO_STATUS_LABEL } from "@/lib/queries/manufacturing-order";
import { entityToday } from "@/lib/queries/stock-items";

export const metadata: Metadata = { title: "Production schedule · saveBOARD ERP" };

const fmt = (n: number) => n.toLocaleString("en-NZ", { maximumFractionDigits: 2 });

/** Monday of the week containing an ISO date (dates only, no time zones involved). */
function weekStart(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
const longDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-NZ", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" });

/** Open manufacturing orders by week of production deadline, with planned hours per week. */
export default async function SchedulePage() {
  const { entity } = await getEntityContext();
  const mo = t.manufacturingOrders;
  const [rows, position] = await Promise.all([
    db
      .select({
        id: mo.id,
        number: mo.number,
        status: mo.status,
        productionDeadline: mo.productionDeadline,
        deliveryDeadline: mo.deliveryDeadline,
        plannedQty: mo.plannedQty,
        sku: t.products.sku,
        product: t.products.name,
        uom: t.products.uom,
        soNumber: t.salesOrders.number,
        customer: t.customers.name,
        hours: sql<string>`(select coalesce(sum(o.planned_hours), 0) from mo_operations o where o.mo_id = ${mo.id})`,
      })
      .from(mo)
      .innerJoin(t.products, eq(t.products.id, mo.productId))
      .leftJoin(t.salesOrders, eq(t.salesOrders.id, mo.salesOrderId))
      .leftJoin(t.customers, eq(t.customers.id, t.salesOrders.customerId))
      .where(and(eq(mo.entityId, entity.id), inArray(mo.status, ["not_started", "in_progress"])))
      .orderBy(sql`${mo.productionDeadline} asc nulls last`, asc(mo.number)),
    stockPosition(entity.id),
  ]);
  const today = entityToday(entity.id);
  const thisWeek = weekStart(today);

  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = r.productionDeadline ? (weekStart(r.productionDeadline) < thisWeek ? "overdue" : weekStart(r.productionDeadline)) : "none";
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const order = [...groups.keys()].sort((a, b) => (a === "overdue" ? -1 : b === "overdue" ? 1 : a === "none" ? 1 : b === "none" ? -1 : a.localeCompare(b)));
  const title = (k: string) =>
    k === "overdue" ? "Overdue (deadline before this week)" : k === "none" ? "No production deadline" : `${k === thisWeek ? "This week" : "Week of"} ${longDay(k)}`;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">Open manufacturing orders by week of production deadline. Set deadlines on each order to schedule it.</p>
        <Link href="/make/orders/new" className="btn-primary">
          + Manufacturing order
        </Link>
      </div>
      {!rows.length && <p className="rounded border border-line bg-surface p-5 text-sm text-muted">No open manufacturing orders.</p>}
      {order.map((k) => {
        const list = groups.get(k)!;
        const hours = list.reduce((s, r) => s + Number(r.hours), 0);
        return (
          <section key={k} className="overflow-x-auto rounded border border-line bg-surface">
            <div className={clsx("flex items-center justify-between border-b border-line px-4 py-2", k === "overdue" && "bg-bad/10")}>
              <span className={clsx("font-medium", k === "overdue" && "text-bad")}>{title(k)}</span>
              <span className="text-sm text-muted">
                {list.length} order{list.length === 1 ? "" : "s"} · {fmt(hours)} h planned
              </span>
            </div>
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="border-b border-line px-3 py-2 font-normal">Deadline</th>
                  <th className="border-b border-line px-3 py-2 font-normal">Order #</th>
                  <th className="border-b border-line px-3 py-2 font-normal">Product</th>
                  <th className="border-b border-line px-3 py-2 text-right font-normal">Quantity</th>
                  <th className="border-b border-line px-3 py-2 text-right font-normal">Hours</th>
                  <th className="border-b border-line px-3 py-2 text-center font-normal">Ingredients</th>
                  <th className="border-b border-line px-3 py-2 text-center font-normal">Status</th>
                  <th className="border-b border-line px-3 py-2 font-normal">Sales order</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => {
                  const a = position.moAvailability.get(r.id) ?? "not_tracked";
                  return (
                    <tr key={r.id}>
                      <td className="border-b border-line px-3 py-2 whitespace-nowrap">{r.productionDeadline ? longDay(r.productionDeadline) : "—"}</td>
                      <td className="border-b border-line px-3 py-2">
                        <Link href={`/make/orders/${r.id}`} className="text-link hover:underline">
                          {r.number}
                        </Link>
                      </td>
                      <td className="border-b border-line px-3 py-2">
                        <span className="mr-1 font-mono text-xs text-muted">[{r.sku}]</span>
                        {r.product}
                      </td>
                      <td className="border-b border-line px-3 py-2 text-right tabular-nums whitespace-nowrap">
                        {fmt(Number(r.plannedQty))} {r.uom}
                      </td>
                      <td className="border-b border-line px-3 py-2 text-right tabular-nums">{fmt(Number(r.hours))}</td>
                      <td className={clsx("border-b border-line px-3 py-2 text-center", a === "in_stock" && "bg-ok text-white", a === "not_available" && "bg-bad text-white")}>{AVAILABILITY_LABEL[a]}</td>
                      <td className={clsx("border-b border-line px-3 py-2 text-center", r.status === "in_progress" ? "bg-[#2f6fb0] text-white" : "bg-pending")}>{MO_STATUS_LABEL[r.status]}</td>
                      <td className="border-b border-line px-3 py-2">{r.soNumber ? `${r.soNumber} — ${r.customer}` : <span className="text-muted">Stock</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}
