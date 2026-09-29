/**
 * Compares the app's stock on hand with a Katana inventory export, item by item, WITHOUT changing anything.
 * Differences are listed with the app movements since opening stock that may explain them.
 *
 *   npx tsx scripts/compare-katana-stock.ts AUS "../AUS InventoryItems-….xlsx" [--prod]
 * Katana's negative balances count as 0 (the app's opening-stock policy).
 */
import "./env";
import { fixMojibake } from "./text-fix";
import ExcelJS from "exceljs";
import { and, eq, ne, sql } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { products, stockMovements } from "../src/db/schema";

const [entityId, file] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!entityId || !file) {
  console.error('Usage: npx tsx scripts/compare-katana-stock.ts <NZ|AUS> "<Katana InventoryItems export>" [--prod]');
  process.exit(1);
}
const text = (v: ExcelJS.CellValue): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && "result" in v) return text(v.result as ExcelJS.CellValue);
  const s = String(v).trim();
  return s === "" ? null : fixMojibake(s);
};

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  const header = (ws.getRow(1).values as ExcelJS.CellValue[]).map((v) => text(v) ?? "");
  const col = (h: string) => header.indexOf(h);
  const katanaRows: { sku: string | null; name: string; qty: number }[] = [];
  ws.eachRow((row, i) => {
    if (i === 1) return;
    katanaRows.push({
      sku: text(row.getCell(col("Variant code / SKU")).value),
      name: text(row.getCell(col("Name")).value) ?? "",
      qty: Math.max(0, Number(text(row.getCell(col("In stock")).value) ?? 0) || 0),
    });
  });

  const db = createDb();
  // Match Katana items the way the stock import does: by SKU (a repeated code's second item is "<code>-2"),
  // or by name for items without a SKU. Quantities compared to 4 decimals (what the app stores).
  const skuByName = new Map(
    (await db.select({ sku: products.sku, name: products.name }).from(products).where(eq(products.entityId, entityId))).map((p) => [p.name.trim().toLowerCase(), p.sku]),
  );
  const katana = new Map<string, { name: string; qty: number }>();
  for (const k of katanaRows) {
    let key = k.sku ?? skuByName.get(k.name.trim().toLowerCase()) ?? null;
    if (!key) continue;
    if (katana.has(key.toLowerCase())) key = `${key}-2`;
    katana.set(key.toLowerCase(), { name: k.name, qty: Math.round(k.qty * 10000) / 10000 });
  }
  const onHand = await db
    .select({ id: products.id, sku: products.sku, name: products.name, track: products.trackStock, qty: sql<string>`coalesce((select sum(m.qty) from stock_movements m where m.product_id = "products"."id"), 0)` })
    .from(products)
    .where(eq(products.entityId, entityId));
  const moves = await db
    .select({ productId: stockMovements.productId, ref: stockMovements.refNumber, kind: stockMovements.kind, qty: stockMovements.qty })
    .from(stockMovements)
    .where(and(eq(stockMovements.entityId, entityId), ne(stockMovements.kind, "opening")));

  const diffs: { sku: string; name: string; katana: number; app: number; why: string }[] = [];
  const seen = new Set<string>();
  for (const p of onHand) {
    if (!p.track) continue;
    const k = katana.get(p.sku.toLowerCase());
    seen.add(p.sku.toLowerCase());
    const app = Math.round(Number(p.qty) * 10000) / 10000;
    const kq = k?.qty ?? 0;
    if (Math.abs(app - kq) < 0.00015) continue;
    const why = moves
      .filter((m) => m.productId === p.id)
      .map((m) => `${m.ref ?? m.kind} ${Number(m.qty) > 0 ? "+" : ""}${Number(m.qty)}`)
      .join(", ");
    diffs.push({ sku: p.sku, name: p.name, katana: kq, app, why: why || "no app movements (changed in Katana since the opening stock)" });
  }
  for (const [sku, k] of katana) if (!seen.has(sku) && k.qty) diffs.push({ sku, name: k.name, katana: k.qty, app: 0, why: "not in the app's product list" });

  console.log(`${entityId}: ${katana.size} Katana items compared with the app · ${diffs.length} differ${diffs.length ? ":" : " — stock matches Katana exactly."}`);
  for (const d of diffs) console.log(`  ${d.sku} (${d.name.slice(0, 40)}): Katana ${d.katana}, app ${d.app}, difference ${Math.round((d.app - d.katana) * 10000) / 10000} — ${d.why}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
