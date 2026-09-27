/**
 * Links quote/order lines to products by SKU where the product was added after the line was imported
 * (e.g. new Katana SKUs). Only fills in missing links; never changes prices or quantities.
 *   npx tsx scripts/relink-order-lines.ts            (add --prod for Supabase)
 */
import "./env";
import { sql } from "drizzle-orm";
import { createDb } from "../src/db/client";

async function main() {
  const db = createDb();
  const result = await db.execute(sql`
    update order_lines l set product_id = p.id, updated_at = now()
    from sales_orders o, products p
    where l.order_id = o.id and p.entity_id = o.entity_id and lower(p.sku) = lower(l.sku)
      and l.product_id is null and l.sku is not null`);
  const r = result as unknown as { count?: number; affectedRows?: number };
  console.log(`Linked ${r.count ?? r.affectedRows ?? 0} order lines to products by SKU.`);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
