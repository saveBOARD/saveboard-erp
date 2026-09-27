/**
 * One-off repair of Katana's double-encoded characters already in the database
 * (customer names/addresses, delivery sites, order titles/notes, line descriptions, product names).
 *   npx tsx scripts/repair-text.ts            (add --prod for Supabase)
 */
import "./env";
import { sql } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { fixMojibake } from "./text-fix";

const TARGETS: Record<string, string[]> = {
  customers: ["name", "billing_line1", "billing_line2", "billing_city", "billing_region", "contact_name", "notes"],
  customer_sites: ["name", "line1", "line2", "city", "region", "contact_name"],
  sales_orders: ["title", "customer_reference", "notes", "ship_to_name", "ship_to_line1", "ship_to_line2", "ship_to_city", "ship_to_region"],
  order_lines: ["description"],
  products: ["name"],
  suppliers: ["name", "notes"],
};

async function main() {
  const db = createDb();
  let total = 0;
  for (const [table, cols] of Object.entries(TARGETS)) {
    for (const col of cols) {
      const res = await db.execute(sql.raw(`select id, ${col} as v from ${table} where ${col} ~ '[ÃÂÅÄâ]'`));
      const rows = (Array.isArray(res) ? res : (res as unknown as { rows: unknown[] }).rows) as { id: string; v: string }[];
      for (const r of rows) {
        const fixed = fixMojibake(r.v);
        if (fixed === r.v) continue;
        if (table === "customers" && col === "name") {
          // don't create a duplicate name if the correctly spelt customer already exists
          const clash = await db.execute(sql`select 1 from customers c where c.name = ${fixed} and c.entity_id = (select entity_id from customers where id = ${r.id})`);
          const hit = (Array.isArray(clash) ? clash : (clash as unknown as { rows: unknown[] }).rows).length;
          if (hit) {
            console.log(`  ! customers.name "${r.v}" -> "${fixed}" skipped: that name already exists`);
            continue;
          }
        }
        await db.execute(sql`update ${sql.raw(table)} set ${sql.raw(col)} = ${fixed} where id = ${r.id}`);
        console.log(`  ${table}.${col}: "${r.v}" -> "${fixed}"`);
        total++;
      }
    }
  }
  console.log(`Repaired ${total} values.`);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
