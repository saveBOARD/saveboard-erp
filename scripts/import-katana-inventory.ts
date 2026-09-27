/**
 * Refreshes products and opening stock from a Katana "InventoryItems" export (Stock > Inventory > download).
 *
 *   npm run db:import-inventory -- NZ "../NZ InventoryItems-2026-09-27-16_53.xlsx"
 *   npm run db:import-inventory:prod -- AUS "../AUS InventoryItems-2026-09-27-16_50.xlsx"
 *
 * - Existing products (matched on SKU, or on name for Katana items without a SKU) get Katana's current name,
 *   category, unit, average cost and default supplier. New SKUs are added as products.
 * - Opening stock is REPLACED with Katana's "In stock", dated from the file name.
 * - Refuses to run once the app has recorded real stock movements (shipments, production, adjustments),
 *   because replacing opening stock after that would double count.
 */
import "./env";
import ExcelJS from "exceljs";
import { and, eq, ne, sql } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { entities, products, stockMovements, suppliers } from "../src/db/schema";

const [entityId, file] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!entityId || !file) {
  console.error('Usage: npm run db:import-inventory -- <NZ|AUS> "<path to Katana InventoryItems export.xlsx>"');
  process.exit(1);
}
const MATERIAL_CATEGORIES = new Set(["Facing Materials", "Finishing Materials", "Input Materials", "Packaging & Handling"]);

const text = (v: unknown) => {
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && "result" in (v as object)) return text((v as { result: unknown }).result);
  const s = String(v).trim();
  return s === "" ? null : s;
};
const num = (v: unknown) => {
  const n = Number(text(v) ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** "NZ InventoryItems-2026-09-27-16_53.xlsx" -> that time in the entity's timezone. */
function snapshotTime(path: string, entity: string) {
  const m = path.match(/(\d{4}-\d{2}-\d{2})-(\d{2})_(\d{2})/);
  if (!m) return new Date();
  const offset = entity === "AUS" ? "+10:00" : "+13:00"; // late September: NZDT / AEST
  return new Date(`${m[1]}T${m[2]}:${m[3]}:00${offset}`);
}

async function main() {
  const db = createDb();
  const [entity] = await db.select().from(entities).where(eq(entities.id, entityId));
  if (!entity) throw new Error(`Unknown entity ${entityId}`);

  const [real] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(stockMovements)
    .where(and(eq(stockMovements.entityId, entityId), ne(stockMovements.kind, "opening")));
  if (real.n > 0) {
    throw new Error(`${entityId} already has ${real.n} real stock movements in the app. Opening stock can't be replaced any more — use a stocktake instead.`);
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  const header = (ws.getRow(1).values as unknown[]).map((v) => text(v) ?? "");
  type Item = Record<string, unknown>;
  const items: Item[] = [];
  ws.eachRow((row, i) => {
    if (i === 1) return;
    const r: Item = {};
    header.forEach((h, c) => h && (r[h] = row.getCell(c).value));
    if (text(r["Name"]) || text(r["Variant code / SKU"])) items.push(r);
  });

  const existing = await db.select().from(products).where(eq(products.entityId, entityId));
  const bySku = new Map(existing.map((p) => [p.sku.toLowerCase(), p]));
  const byName = new Map(existing.map((p) => [p.name.trim().toLowerCase(), p]));
  const supplierIds = new Map(
    (await db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(eq(suppliers.entityId, entityId))).map(
      (s) => [s.name.toLowerCase(), s.id],
    ),
  );

  const seen = new Set<string>();
  const openings: { productId: string; qty: number; cost: number }[] = [];
  let updated = 0;
  let created = 0;
  const skipped: string[] = [];

  const firstStock = new Map<string, number>();
  for (const r of items) {
    let sku = text(r["Variant code / SKU"]);
    const name = text(r["Name"]) ?? sku!;
    let match = (sku && bySku.get(sku.toLowerCase())) || byName.get(name.toLowerCase());
    let key = match?.id ?? sku ?? name;
    if (seen.has(key)) {
      if (sku && num(r["In stock"]) !== firstStock.get(key)) {
        // Katana lets two different items share a code (e.g. LDPESCONBLK: standard and UV sheeting).
        // Keep both: the second becomes "<SKU>-2" so its stock isn't lost. Rename it in the app.
        sku = `${sku}-2`;
        match = bySku.get(sku.toLowerCase());
        key = match?.id ?? sku;
        skipped.push(`duplicate code ${sku.slice(0, -2)}: "${name}" kept as separate product ${sku} — give it its own SKU`);
      } else {
        skipped.push(`duplicate ${sku ?? name} (same stock ${num(r["In stock"])}) — listed twice in Katana, first row kept`);
        continue;
      }
    }
    seen.add(key);
    firstStock.set(key, num(r["In stock"]));

    const category = text(r["Category"]);
    const supplierName = text(r["Default supplier"]);
    let supplierId = supplierName ? supplierIds.get(supplierName.toLowerCase()) : undefined;
    if (supplierName && !supplierId) {
      const [s] = await db.insert(suppliers).values({ entityId, name: supplierName }).returning({ id: suppliers.id });
      supplierId = s.id;
      supplierIds.set(supplierName.toLowerCase(), s.id);
    }
    const cost = num(r["Average cost"]);
    const fields = {
      name,
      category,
      uom: text(r["Units of measure"]),
      standardCost: String(cost),
      defaultSupplierId: supplierId ?? null,
    };

    let productId: string;
    let track: boolean;
    if (match) {
      await db.update(products).set(fields).where(eq(products.id, match.id));
      productId = match.id;
      track = match.trackStock;
      updated++;
    } else if (sku) {
      const type = category && MATERIAL_CATEGORIES.has(category) ? "material" : "product";
      const [p] = await db
        .insert(products)
        .values({ entityId, sku, type, trackStock: true, safetyStock: String(num(r["Safety stock"])), ...fields })
        .returning({ id: products.id });
      productId = p.id;
      track = true;
      created++;
      console.log(`  + new product ${sku} — ${name}`);
    } else {
      skipped.push(`no SKU and no product named "${name}" — add it in the app first`);
      continue;
    }
    const qty = num(r["In stock"]);
    if (track && qty !== 0) openings.push({ productId, qty, cost });
  }

  const at = snapshotTime(file, entityId);
  const label = at.toLocaleString("en-NZ", { timeZone: entityId === "AUS" ? "Australia/Sydney" : "Pacific/Auckland", dateStyle: "short", timeStyle: "short" });
  await db.delete(stockMovements).where(and(eq(stockMovements.entityId, entityId), eq(stockMovements.kind, "opening")));
  if (openings.length)
    await db.insert(stockMovements).values(
      openings.map((o) => ({
        entityId,
        productId: o.productId,
        kind: "opening" as const,
        qty: String(o.qty),
        unitCost: String(o.cost),
        occurredAt: at,
        note: `Opening stock from Katana inventory export ${label}`,
      })),
    );

  for (const s of skipped) console.log(`  ! ${s}`);
  const negative = openings.filter((o) => o.qty < 0).length;
  const value = openings.reduce((v, o) => v + o.qty * o.cost, 0);
  console.log(
    `${entityId}: ${items.length} Katana items → ${updated} products updated, ${created} added; opening stock replaced ` +
      `(${openings.length} items, ${negative} negative, value ${value.toLocaleString("en-NZ", { maximumFractionDigits: 2 })} ${entity.currency}) as at ${label}.`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
