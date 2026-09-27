/**
 * Deletes a product created by mistake — only if nothing references it (no stock movements, no order lines).
 *   npm run db:remove-empty-product -- NZ SBEXP1012003000_WN-2      (add --prod for Supabase)
 */
import "./env";
import { and, eq, sql } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { auditLog, orderLines, products, stockMovements } from "../src/db/schema";

const [entityId, sku] = process.argv.slice(2).filter((a) => !a.startsWith("--"));

async function main() {
  const db = createDb();
  const [p] = await db.select().from(products).where(and(eq(products.entityId, entityId), eq(products.sku, sku)));
  if (!p) return console.log(`${entityId} ${sku}: not found, nothing to do.`);
  const [m] = await db.select({ n: sql<number>`count(*)::int` }).from(stockMovements).where(eq(stockMovements.productId, p.id));
  const [l] = await db.select({ n: sql<number>`count(*)::int` }).from(orderLines).where(eq(orderLines.productId, p.id));
  if (m.n || l.n) throw new Error(`${sku} is in use (${m.n} stock movements, ${l.n} order lines) — not deleted.`);
  await db.delete(products).where(eq(products.id, p.id));
  await db.insert(auditLog).values({ entityId, tableName: "products", recordId: p.id, action: "delete", changes: { sku, name: p.name, reason: "created by mistake during inventory import" } });
  console.log(`${entityId} ${sku} ("${p.name}") deleted.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
