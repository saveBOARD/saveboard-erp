/**
 * Sets a product's standard cost by hand (e.g. correcting a bad Katana average cost). The cost is then
 * marked "set manually" so later Katana imports keep it, and the product's opening stock is revalued.
 *   npm run db:set-cost -- AUS SPRS 1.05          (add --prod for Supabase)
 */
import "./env";
import { and, eq } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { auditLog, products, stockMovements } from "../src/db/schema";

const [entityId, sku, costArg] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const cost = Number(costArg);
if (!entityId || !sku || !Number.isFinite(cost) || cost < 0) {
  console.error("Usage: npm run db:set-cost -- <NZ|AUS> <SKU> <cost>");
  process.exit(1);
}

async function main() {
  const db = createDb();
  const [p] = await db.select().from(products).where(and(eq(products.entityId, entityId), eq(products.sku, sku)));
  if (!p) throw new Error(`${entityId}: no product with SKU ${sku}`);
  await db.update(products).set({ standardCost: String(cost), costSetManually: true }).where(eq(products.id, p.id));
  await db
    .update(stockMovements)
    .set({ unitCost: String(cost) })
    .where(and(eq(stockMovements.productId, p.id), eq(stockMovements.kind, "opening")));
  await db.insert(auditLog).values({
    entityId,
    tableName: "products",
    recordId: p.id,
    action: "set_cost",
    changes: { sku, standardCost: { from: Number(p.standardCost), to: cost } },
  });
  console.log(`${entityId} ${sku} (${p.name}): cost ${Number(p.standardCost)} -> ${cost} per ${p.uom ?? "unit"}, marked as set manually.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
