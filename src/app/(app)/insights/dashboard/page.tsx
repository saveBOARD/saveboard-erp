import clsx from "clsx";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { db, t } from "@/db";
import { getEntityContext } from "@/lib/dal";
import { fyStart } from "@/lib/periods";
import { stockPosition } from "@/lib/queries/availability";
import { productsWithStock } from "@/lib/queries/products";
import { foreignHistory, salesByCustomer, salesByMonth, salesByProduct, salesTotal } from "@/lib/queries/sales";
import { entityToday } from "@/lib/queries/stock-items";

export const metadata: Metadata = { title: "Dashboard · saveBOARD ERP" };

const money0 = (n: number) => n.toLocaleString("en-NZ", { maximumFractionDigits: 0 });
const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
/** Same calendar day one year earlier (29 Feb -> 28 Feb). */
function yearBefore(d: string) {
  const y = Number(d.slice(0, 4)) - 1;
  const m = Number(d.slice(5, 7)) - 1;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return iso(y, m, Math.min(Number(d.slice(8, 10)), lastDay));
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function Card({ label, value, sub, href, tone }: { label: string; value: string; sub?: React.ReactNode; href?: string; tone?: "bad" | "warn" }) {
  const body = (
    <>
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className={clsx("text-2xl font-medium tabular-nums", tone === "bad" && "text-bad", tone === "warn" && "text-warn")}>{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </>
  );
  return href ? (
    <Link href={href} className="grid gap-0.5 rounded border border-line bg-surface p-4 hover:border-primary">
      {body}
    </Link>
  ) : (
    <div className="grid gap-0.5 rounded border border-line bg-surface p-4">{body}</div>
  );
}

function Change({ now, before }: { now: number; before: number }) {
  if (!before) return null;
  const pct = Math.round(((now - before) / Math.abs(before)) * 100);
  return <span className={pct >= 0 ? "text-ok" : "text-bad"}>{pct >= 0 ? "▲" : "▼"} {Math.abs(pct)}%</span>;
}

export default async function DashboardPage() {
  const { entity } = await getEntityContext();
  const cur = entity.currency;
  const today = entityToday(entity.id);
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7)) - 1;
  const monthStart = iso(y, m, 1);
  const fy = fyStart(entity.id, today);
  const chartFrom = iso(y, m - 12, 1);
  const so = t.salesOrders;
  const orderValue = sql<string>`coalesce(sum(${so.subtotal} * ${so.fxRate}), 0)`;

  const [
    thisMonth,
    lastYearMonth,
    thisFy,
    lastFyToDate,
    months,
    topCustomers,
    topProducts,
    statusRows,
    overdue,
    stock,
    position,
    lateMos,
    returnsWaiting,
    foreign,
  ] = await Promise.all([
    salesTotal(entity.id, cur, { from: monthStart, to: today }),
    salesTotal(entity.id, cur, { from: yearBefore(monthStart), to: yearBefore(today) }),
    salesTotal(entity.id, cur, { from: fy, to: today }),
    salesTotal(entity.id, cur, { from: yearBefore(fy), to: yearBefore(today) }),
    salesByMonth(entity.id, cur, { from: chartFrom, to: today }),
    salesByCustomer(entity.id, cur, { from: fy, to: today }, 8),
    salesByProduct(entity.id, cur, { from: fy, to: today }, 8),
    db
      .select({ status: so.status, quoteStatus: so.quoteStatus, n: sql<number>`count(*)::int`, value: orderValue })
      .from(so)
      .where(and(eq(so.entityId, entity.id), inArray(so.status, ["quote", "open", "picked", "shipped"])))
      .groupBy(so.status, so.quoteStatus),
    db
      .select({ n: sql<number>`count(*)::int`, value: orderValue })
      .from(so)
      .where(and(eq(so.entityId, entity.id), inArray(so.status, ["open", "picked"]), lt(so.deliveryDeadline, today))),
    productsWithStock(entity.id, "all", true),
    stockPosition(entity.id),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(t.manufacturingOrders)
      .where(and(eq(t.manufacturingOrders.entityId, entity.id), inArray(t.manufacturingOrders.status, ["not_started", "in_progress"]), lt(t.manufacturingOrders.productionDeadline, today))),
    db
      .select({ open: sql<number>`count(*) filter (where ${t.salesReturns.status} = 'open')::int`, uncredited: sql<number>`count(*) filter (where ${t.salesReturns.creditedOn} is null)::int` })
      .from(t.salesReturns)
      .where(and(eq(t.salesReturns.entityId, entity.id), sql`${t.salesReturns.status} <> 'cancelled'`)),
    foreignHistory(entity.id, cur),
  ]);

  const status = (s: string, quote?: boolean) => {
    const r = statusRows.filter((x) => x.status === s && (!quote || ["draft", "sent"].includes(x.quoteStatus ?? "")));
    return { n: r.reduce((a, x) => a + x.n, 0), value: r.reduce((a, x) => a + Number(x.value), 0) };
  };
  const quotes = status("quote", true);
  const open = status("open");
  const picked = status("picked");
  const toInvoice = status("shipped");
  const stockValue = stock.reduce((s, p) => s + p.value, 0);
  const negatives = stock.filter((p) => p.inStock < 0).length;
  const belowSafety = stock.filter((p) => Number(p.safetyStock) > 0 && p.inStock - (position.committed.get(p.id) ?? 0) < Number(p.safetyStock)).length;
  const shortOrders = [...position.orderAvailability.values()].filter((a) => a === "not_available").length;

  // 13 months, including empty ones
  const byMonth = new Map(months.map((x) => [x.month, x.amount]));
  const chart = Array.from({ length: 13 }, (_, i) => {
    const d = iso(y, m - 12 + i, 1);
    return { key: d.slice(0, 7), label: `${MONTHS[Number(d.slice(5, 7)) - 1]}${d.slice(5, 7) === "01" || i === 0 ? ` ${d.slice(2, 4)}` : ""}`, amount: byMonth.get(d.slice(0, 7)) ?? 0 };
  });
  const max = Math.max(1, ...chart.map((c) => c.amount));

  const attention = [
    { n: overdue[0]?.n ?? 0, text: "sales orders past their delivery deadline", href: "/sell/orders" },
    { n: shortOrders, text: "open orders with items not in stock", href: "/sell/orders" },
    { n: toInvoice.n, text: "shipped orders waiting to be invoiced", href: "/sell/invoicing" },
    { n: returnsWaiting[0]?.uncredited ?? 0, text: "returns without a credit note", href: "/sell/invoicing?tab=credits" },
    { n: returnsWaiting[0]?.open ?? 0, text: "returns waiting for the goods", href: "/sell/returns" },
    { n: lateMos[0]?.n ?? 0, text: "manufacturing orders past their production deadline", href: "/make/schedule" },
    { n: belowSafety, text: "items below safety stock (after committed orders)", href: "/stock/inventory" },
    { n: negatives, text: "items with negative stock", href: "/stock/inventory" },
  ].filter((a) => a.n > 0);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-medium">
          {entity.name} <span className="text-sm text-muted">· {today}</span>
        </h1>
        <span className="text-xs text-muted">All amounts {cur}, ex GST. Sales = shipped or invoiced, less credited returns, including Katana history.</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Card label="Sales this month" value={money0(thisMonth.amount)} sub={<>{thisMonth.orders} orders · <Change now={thisMonth.amount} before={lastYearMonth.amount} /> vs same days last year</>} href="/insights/sales-by-customer?period=this_month" />
        <Card label="Sales this financial year" value={money0(thisFy.amount)} sub={<>from {fy} · <Change now={thisFy.amount} before={lastFyToDate.amount} /> vs last year to date</>} href="/insights/sales-by-customer?period=this_fy" />
        <Card label="Open orders" value={money0(open.value + picked.value)} sub={`${open.n + picked.n} orders (${picked.n} picked)`} href="/sell/orders" />
        <Card label="Open quotes" value={money0(quotes.value)} sub={`${quotes.n} quotes sent or in draft`} href="/sell/quotes" />
        <Card label="To invoice" value={money0(toInvoice.value)} sub={`${toInvoice.n} shipped orders`} href="/sell/invoicing" tone={toInvoice.n ? "warn" : undefined} />
        <Card label="Stock value" value={money0(stockValue)} sub="on hand at standard cost" href="/stock/inventory" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded border border-line bg-surface p-4 lg:col-span-2">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-medium">Sales by month</h2>
            <Link href="/insights/sales-lines?period=last_12" className="text-xs text-link hover:underline">
              See the lines
            </Link>
          </div>
          <div className="flex h-48 items-end gap-1.5" role="img" aria-label="Sales by month for the last 13 months">
            {chart.map((c, i) => (
              <div key={c.key} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${c.key}: ${money0(c.amount)} ${cur}`}>
                <span className="text-[10px] tabular-nums text-muted">{c.amount ? `${Math.round(c.amount / 1000)}k` : ""}</span>
                <div className={clsx("w-full rounded-t", i === chart.length - 1 ? "bg-primary/60" : "bg-primary")} style={{ height: `${Math.max(c.amount > 0 ? 2 : 0, (c.amount / max) * 100)}%` }} />
                <span className="text-[10px] text-muted">{c.label}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">The last bar is this month so far.</p>
        </section>

        <section className="rounded border border-line bg-surface p-4">
          <h2 className="mb-2 font-medium">Needs attention</h2>
          {attention.length ? (
            <ul className="grid gap-1.5 text-sm">
              {attention.map((a) => (
                <li key={a.text}>
                  <Link href={a.href} className="hover:underline">
                    <b className="tabular-nums">{a.n}</b> {a.text}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ok">Nothing overdue or short. 👍</p>
          )}
          <h2 className="mt-4 mb-2 font-medium">Orders by status</h2>
          <table className="w-full text-sm">
            <tbody>
              {[
                ["Quotes (open)", quotes, "/sell/quotes"],
                ["Open", open, "/sell/orders"],
                ["Picked", picked, "/sell/orders"],
                ["Shipped, not invoiced", toInvoice, "/sell/invoicing"],
              ].map(([label, s, href]) => (
                <tr key={label as string}>
                  <td className="py-0.5">
                    <Link href={href as string} className="text-link hover:underline">
                      {label as string}
                    </Link>
                  </td>
                  <td className="py-0.5 text-right tabular-nums">{(s as { n: number }).n}</td>
                  <td className="py-0.5 text-right tabular-nums">{money0((s as { value: number }).value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {[
          { title: "Top customers this financial year", href: "/insights/sales-by-customer?period=this_fy", rows: topCustomers.map((c) => ({ key: c.customerId ?? c.customer, name: c.customer, sub: `${c.orders} orders`, amount: c.amount })) },
          { title: "Top products this financial year", href: "/insights/sales-by-product?period=this_fy", rows: topProducts.map((p) => ({ key: p.productId ?? p.item, name: p.item, sub: p.sku ?? "", amount: p.amount })) },
        ].map((block) => (
          <section key={block.title} className="rounded border border-line bg-surface p-4">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="font-medium">{block.title}</h2>
              <Link href={block.href} className="text-xs text-link hover:underline">
                Full report
              </Link>
            </div>
            {block.rows.length ? (
              <ul className="grid gap-1.5 text-sm">
                {block.rows.map((r) => {
                  const top = block.rows[0].amount || 1;
                  return (
                    <li key={r.key} className="grid grid-cols-[1fr_auto] items-center gap-x-3">
                      <span className="truncate">
                        {r.name} <span className="text-xs text-muted">{r.sub}</span>
                      </span>
                      <span className="tabular-nums">{money0(r.amount)}</span>
                      <span className="col-span-2 h-1.5 rounded bg-page">
                        <span className="block h-1.5 rounded bg-primary/70" style={{ width: `${Math.max(0, (r.amount / top) * 100)}%` }} />
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted">No sales yet this financial year.</p>
            )}
          </section>
        ))}
      </div>
      {foreign.length > 0 && (
        <p className="text-xs text-muted">
          Not included: {foreign.map((f) => `${f.lines} Katana history lines in ${f.currency} (${money0(Number(f.amount))} ${f.currency})`).join(", ")}; the exchange rate
          isn&apos;t known.
        </p>
      )}
    </div>
  );
}
