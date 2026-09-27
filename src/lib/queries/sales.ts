import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";

/**
 * Every sale line for an entity, from three places, in the entity's currency, ex GST:
 *  - Katana history (sales_history), dated by Katana's picked date (else the order date);
 *  - orders shipped / invoiced / closed in the app, dated by invoice date, else last shipment, else order date
 *    (orders also in the Katana history are skipped, so nothing is counted twice);
 *  - returns (not cancelled) as negative lines, dated by credit date, else received, else raised.
 * Katana history lines in another currency (a few old USD exports) are left out of the totals: no exchange rate.
 */
function salesLines(entityId: string, currency: string): SQL {
  return sql`
    with sales_lines as (
      select 'katana' as source, h.so_number as doc, h.title, null::uuid as order_id,
             coalesce(h.shipped_on, h.order_date) as sale_date,
             h.customer_id, coalesce(c.name, h.customer_name) as customer,
             h.product_id, coalesce(p.sku, h.sku) as sku, coalesce(p.name, h.description) as item,
             coalesce(h.category, p.category) as category, h.qty::numeric as qty, h.subtotal::numeric as amount,
             p.standard_cost::numeric as unit_cost
      from sales_history h
      left join customers c on c.id = h.customer_id
      left join products p on p.id = h.product_id
      where h.entity_id = ${entityId} and h.currency = ${currency}
      union all
      select 'app', o.number, o.title, o.id,
             coalesce(o.invoiced_on, (select max(s.shipped_on) from shipments s where s.order_id = o.id and s.reversed_at is null), o.order_date),
             o.customer_id, c.name, l.product_id, coalesce(p.sku, l.sku), coalesce(p.name, l.description), p.category,
             l.qty::numeric, (l.line_subtotal * o.fx_rate)::numeric, p.standard_cost::numeric
      from order_lines l
      join sales_orders o on o.id = l.order_id
      join customers c on c.id = o.customer_id
      left join products p on p.id = l.product_id
      where o.entity_id = ${entityId} and o.status in ('shipped', 'invoiced', 'closed')
        and not exists (select 1 from sales_history h where h.entity_id = o.entity_id and h.so_number = o.number)
      union all
      select 'return', r.number, o.number, o.id,
             coalesce(r.credited_on, r.received_on, r.return_date),
             r.customer_id, c.name, rl.product_id, coalesce(p.sku, rl.sku), coalesce(p.name, rl.description), p.category,
             -rl.qty::numeric, -(rl.line_subtotal * o.fx_rate)::numeric, p.standard_cost::numeric
      from return_lines rl
      join sales_returns r on r.id = rl.return_id
      join sales_orders o on o.id = r.order_id
      join customers c on c.id = r.customer_id
      left join products p on p.id = rl.product_id
      where r.entity_id = ${entityId} and r.status <> 'cancelled'
    )`;
}

async function rows<T>(query: SQL): Promise<T[]> {
  const r = await db.execute(query);
  return (Array.isArray(r) ? r : (r as unknown as { rows: T[] }).rows) as T[];
}

export type Range = { from: string; to: string };
const inRange = (r: Range) => sql`sale_date between ${r.from}::date and ${r.to}::date`;

export async function salesTotal(entityId: string, currency: string, r: Range) {
  const [x] = await rows<{ amount: string | null; orders: number }>(
    sql`${salesLines(entityId, currency)} select sum(amount) as amount, count(distinct doc) filter (where source <> 'return')::int as orders from sales_lines where ${inRange(r)}`,
  );
  return { amount: Number(x?.amount ?? 0), orders: x?.orders ?? 0 };
}

/** Revenue per calendar month for the months starting at `from` (YYYY-MM-01) through `to`. */
export async function salesByMonth(entityId: string, currency: string, r: Range) {
  return (
    await rows<{ month: string; amount: string }>(
      sql`${salesLines(entityId, currency)} select to_char(date_trunc('month', sale_date), 'YYYY-MM') as month, sum(amount) as amount
          from sales_lines where ${inRange(r)} group by 1 order by 1`,
    )
  ).map((m) => ({ month: m.month, amount: Number(m.amount) }));
}

export async function salesByCustomer(entityId: string, currency: string, r: Range, limit?: number) {
  return (
    await rows<{ customer_id: string | null; customer: string; orders: number; amount: string; cost: string | null; last_sale: string }>(
      sql`${salesLines(entityId, currency)}
          select customer_id, max(customer) as customer, count(distinct doc) filter (where source <> 'return')::int as orders,
                 sum(amount) as amount, sum(qty * unit_cost) as cost, max(sale_date)::text as last_sale
          from sales_lines where ${inRange(r)}
          group by customer_id, case when customer_id is null then customer end
          order by sum(amount) desc ${limit ? sql`limit ${limit}` : sql``}`,
    )
  ).map((c) => ({ customerId: c.customer_id, customer: c.customer, orders: c.orders, amount: Number(c.amount), cost: c.cost === null ? null : Number(c.cost), lastSale: c.last_sale }));
}

export async function salesByProduct(entityId: string, currency: string, r: Range, limit?: number) {
  return (
    await rows<{ product_id: string | null; sku: string | null; item: string; category: string | null; qty: string; amount: string; customers: number; cost: string | null }>(
      sql`${salesLines(entityId, currency)}
          select product_id, max(sku) as sku, max(item) as item, max(category) as category, sum(qty) as qty, sum(amount) as amount,
                 count(distinct coalesce(customer_id::text, customer))::int as customers, sum(qty * unit_cost) as cost
          from sales_lines where ${inRange(r)}
          group by product_id, case when product_id is null then coalesce(sku, item) end
          order by sum(amount) desc ${limit ? sql`limit ${limit}` : sql``}`,
    )
  ).map((p) => ({
    productId: p.product_id,
    sku: p.sku,
    item: p.item,
    category: p.category,
    qty: Number(p.qty),
    amount: Number(p.amount),
    customers: p.customers,
    cost: p.cost === null ? null : Number(p.cost),
  }));
}

export async function salesLineRows(entityId: string, currency: string, r: Range) {
  return (
    await rows<{ source: string; doc: string; title: string | null; order_id: string | null; sale_date: string; customer_id: string | null; customer: string; sku: string | null; item: string; category: string | null; qty: string; amount: string }>(
      sql`${salesLines(entityId, currency)}
          select source, doc, title, order_id, sale_date::text, customer_id, customer, sku, item, category, qty, amount
          from sales_lines where ${inRange(r)} order by sale_date desc, doc desc limit 20000`,
    )
  ).map((l) => ({ ...l, qty: Number(l.qty), amount: Number(l.amount) }));
}

/** Katana history lines left out of totals because they're in another currency. */
export async function foreignHistory(entityId: string, currency: string) {
  return rows<{ currency: string; lines: number; amount: string }>(
    sql`select currency, count(*)::int as lines, sum(subtotal) as amount from sales_history where entity_id = ${entityId} and currency <> ${currency} group by currency`,
  );
}
