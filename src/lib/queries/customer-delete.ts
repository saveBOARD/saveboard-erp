import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * What stands in the way of deleting a customer, and whether they have history to keep.
 * Blockers: unfinished business (open quotes, orders not yet invoiced, unpaid invoices, returns not finished).
 * History: any order, return or Katana sales history — then the customer is hidden, not erased, so past records keep them.
 */
export async function customerDeleteCheck(customerId: string) {
  const r = await db.execute<{ quotes: number; orders: number; unpaid: number; returns: number; history: number }>(sql`
    select
      (select count(*)::int from sales_orders o where o.customer_id = ${customerId} and o.status = 'quote' and o.quote_status in ('draft', 'sent')) as quotes,
      (select count(*)::int from sales_orders o where o.customer_id = ${customerId} and o.status in ('open', 'picked', 'shipped')) as orders,
      (select count(*)::int from sales_orders o where o.customer_id = ${customerId} and o.status = 'invoiced' and coalesce(o.xero_amount_due, 0) > 0) as unpaid,
      (select count(*)::int from sales_returns r where r.customer_id = ${customerId} and r.status <> 'cancelled' and (r.status = 'open' or r.credited_on is null)) as returns,
      (select count(*)::int from sales_orders o where o.customer_id = ${customerId})
        + (select count(*)::int from sales_returns r where r.customer_id = ${customerId})
        + (select count(*)::int from sales_history h where h.customer_id = ${customerId}) as history`);
  const row = (Array.isArray(r) ? r : (r as unknown as { rows: (typeof r)[number][] }).rows)[0];
  const blockers = [
    row.quotes && `${row.quotes} open quote${row.quotes === 1 ? "" : "s"} (mark declined or expired)`,
    row.orders && `${row.orders} sales order${row.orders === 1 ? "" : "s"} not yet invoiced (finish or cancel)`,
    row.unpaid && `${row.unpaid} unpaid invoice${row.unpaid === 1 ? "" : "s"} in Xero`,
    row.returns && `${row.returns} return${row.returns === 1 ? "" : "s"} not finished (receive and credit, or cancel)`,
  ].filter((x): x is string => !!x);
  return { blockers, hasHistory: row.history > 0 };
}
