/** Lists each entity's price lists and how many prices / customers they have: npx tsx scripts/list-price-lists.ts [--prod] */
import "./env";
import { sql } from "drizzle-orm";
import { createDb } from "../src/db/client";

createDb()
  .execute(
    sql`select l.entity_id, l.name, l.is_default, l.adjust_pct,
          (select count(*)::int from price_list_items i where i.price_list_id = l.id) as prices,
          (select count(*)::int from customers c where c.price_list_id = l.id) as customers
        from price_lists l order by l.entity_id, l.is_default desc, l.name`,
  )
  .then((r) => {
    console.table(Array.isArray(r) ? r : (r as unknown as { rows: unknown[] }).rows);
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
