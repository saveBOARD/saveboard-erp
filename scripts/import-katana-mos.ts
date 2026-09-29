/**
 * Loads Katana's completed manufacturing orders (Make > Manufacturing orders > Done > download, plus the
 * "ingredients" export) as Done MOs, and builds recipes from them.
 *
 *   npx tsx scripts/import-katana-mos.ts NZ "../NZ ManufacturingOrders-….xlsx" "../NZ ManufacturingOrdersIngredients-….xlsx" [--prod]
 *
 * Manufacturing orders
 *  - Status Done, with planned/actual quantity, batch, done date and Katana's costs; materials from the ingredients
 *    export (planned and actual quantity, batch, cost). NO stock movements: Katana's stock already includes them.
 *  - Katana's MO "number" is free text and one text is often shared by several orders (one per product). A shared
 *    text gets the product SKU added ("24/04/24 SB EX CUSTOM · SBEXP1212003000_CUSTOM") so every order has its own number.
 *  - Re-runnable: an MO whose number is already in the app is left alone.
 *  - Products and ingredients that Katana has archived (so they aren't in its inventory export) are added as
 *    INACTIVE products (no stock, hidden from order screens) so every order and old sales line links to them.
 *  - The MO number sequence only moves forward, and only from "MO-123" numbers done in the last 6 months.
 * Recipes
 *  - For each product that has NO recipe in the app yet: the ingredients of its most recent completed MO, per unit
 *    (planned ingredient qty ÷ planned product qty). Recipes already in the app are never changed.
 */
import "./env";
import { randomUUID } from "node:crypto";
import { fixMojibake } from "./text-fix";
import ExcelJS from "exceljs";
import { eq, sql } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { entities, manufacturingOrders, moMaterials, numberSequences, products, recipeLines } from "../src/db/schema";

const [entityId, moFile, ingFile] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!entityId || !moFile || !ingFile) {
  console.error('Usage: npx tsx scripts/import-katana-mos.ts <NZ|AUS> "<ManufacturingOrders export>" "<ManufacturingOrdersIngredients export>" [--prod]');
  process.exit(1);
}

type Cell = ExcelJS.CellValue;
const text = (v: Cell): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object" && "result" in v) return text(v.result as Cell);
  if (typeof v === "object" && "richText" in v) return text(v.richText.map((r) => r.text).join(""));
  const s = String(v).trim();
  return s === "" ? null : fixMojibake(s);
};
const num = (v: Cell) => {
  const s = text(v);
  if (s === null) return 0;
  const n = Number(s.replace(/[%,$\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const isoDate = (v: Cell) => {
  const s = text(v);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const skuOf = (variant: string | null) => variant?.match(/^\[([^\]]+)\]/)?.[1] ?? null;

async function readSheet(file: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  const header = (ws.getRow(1).values as Cell[]).map((v) => text(v) ?? "");
  const rows: Record<string, Cell>[] = [];
  ws.eachRow((row, i) => {
    if (i === 1) return;
    const r: Record<string, Cell> = {};
    // Some columns appear twice (e.g. "Supplier item code"); the first one wins.
    header.forEach((h, c) => h && !(h in r) && (r[h] = row.getCell(c).value ?? null));
    rows.push(r);
  });
  return rows;
}

async function main() {
  const [moRows, ingRows] = await Promise.all([readSheet(moFile), readSheet(ingFile)]);
  if (!moRows.length || !("MO #" in moRows[0])) throw new Error(`${moFile}: not a Katana manufacturing orders export.`);

  const db = createDb();
  const [entity] = await db.select().from(entities).where(eq(entities.id, entityId));
  if (!entity) throw new Error(`Unknown entity ${entityId}`);
  const productBySku = new Map(
    (await db.select({ id: products.id, sku: products.sku }).from(products).where(eq(products.entityId, entityId))).map((p) => [p.sku.toLowerCase(), p]),
  );
  // Archived Katana items become inactive products so their history links up.
  const added: string[] = [];
  async function ensureProduct(sku: string, name: string | null, category: string | null, uom: string | null, type: "product" | "material") {
    const found = productBySku.get(sku.toLowerCase());
    if (found) return found;
    const [p] = await db
      .insert(products)
      .values({ entityId, sku, name: name ?? sku, type, category, uom, active: false })
      .onConflictDoNothing()
      .returning({ id: products.id, sku: products.sku });
    const row = p ?? (await db.select({ id: products.id, sku: products.sku }).from(products).where(sql`${products.entityId} = ${entityId} and lower(${products.sku}) = lower(${sku})`))[0];
    productBySku.set(sku.toLowerCase(), row);
    if (p) added.push(sku);
    return row;
  }
  for (const r of moRows) {
    const variant = text(r["Product variant"]);
    const sku = skuOf(variant);
    if (sku) await ensureProduct(sku, variant!.replace(/^\[[^\]]+\]\s*/, ""), text(r["Category"]), text(r["Unit of measure"]), "product");
  }
  for (const g of ingRows) {
    const sku = text(g["Ingredient variant code/SKU"]);
    if (sku) await ensureProduct(sku, text(g["Ingredient variant"]), null, text(g["Ingredient Unit of measure"]), "material");
  }
  const existingNumbers = new Set(
    (await db.select({ number: manufacturingOrders.number }).from(manufacturingOrders).where(eq(manufacturingOrders.entityId, entityId))).map((m) => m.number),
  );

  // Ingredients grouped by Katana MO text + product SKU.
  const ingByKey = new Map<string, Record<string, Cell>[]>();
  for (const r of ingRows) {
    const key = `${text(r["MO #"])}|${(text(r["Product variant code/SKU"]) ?? "").toLowerCase()}`;
    ingByKey.set(key, [...(ingByKey.get(key) ?? []), r]);
  }

  // Unique numbers: a text shared by several orders gets the product SKU added.
  const textCount = new Map<string, number>();
  for (const r of moRows) {
    const t = text(r["MO #"]);
    if (t) textCount.set(t, (textCount.get(t) ?? 0) + 1);
  }
  const used = new Set<string>();
  const sixMonthsAgo = new Date(Date.now() - 183 * 86400000).toISOString().slice(0, 10);

  const mos: (typeof manufacturingOrders.$inferInsert)[] = [];
  const mats: (typeof moMaterials.$inferInsert)[] = [];
  const unknownProducts = new Map<string, number>();
  let unknownIngredients = 0;
  let skippedExisting = 0;
  let maxMo = 0;
  // For recipes: latest completed MO per product (by done date), with its ingredient rows.
  const latest = new Map<string, { done: string; qty: number; ing: Record<string, Cell>[] }>();

  for (const r of moRows) {
    const katanaNo = text(r["MO #"]);
    const variant = text(r["Product variant"]);
    const sku = skuOf(variant);
    if (!katanaNo || !sku) continue;
    const done = isoDate(r["Done date"]) ?? isoDate(r["Prod. deadline"]) ?? "2021-01-01";
    const m = katanaNo.match(/^MO-(\d+)\b/);
    if (m && done >= sixMonthsAgo) maxMo = Math.max(maxMo, Number(m[1]));
    const product = productBySku.get(sku.toLowerCase());
    const ing = ingByKey.get(`${katanaNo}|${sku.toLowerCase()}`) ?? [];
    const plannedQty = num(r["Planned quantity"]);
    if (product && ing.length && plannedQty > 0) {
      const prev = latest.get(product.id);
      if (!prev || done > prev.done) latest.set(product.id, { done, qty: plannedQty, ing });
    }
    if (!product) {
      unknownProducts.set(sku, (unknownProducts.get(sku) ?? 0) + 1);
      continue;
    }
    let number = (textCount.get(katanaNo) ?? 0) > 1 ? `${katanaNo} · ${sku}` : katanaNo;
    for (let n = 2; used.has(number); n++) number = `${(textCount.get(katanaNo) ?? 0) > 1 ? `${katanaNo} · ${sku}` : katanaNo} #${n}`;
    used.add(number);
    if (existingNumbers.has(number)) {
      skippedExisting++;
      continue;
    }
    const id = randomUUID();
    const batch = text(r["Batch number"]);
    mos.push({
      id,
      entityId,
      number,
      productId: product.id,
      plannedQty: String(plannedQty),
      actualQty: String(num(r["Actual quantity"]) || plannedQty),
      status: "done",
      productionDeadline: isoDate(r["Prod. deadline"]),
      deliveryDeadline: isoDate(r["Del. deadline"]),
      batchNo: batch,
      notes: `Completed in Katana${text(r["Customer"]) ? ` for ${text(r["Customer"])}` : ""} (imported history). No stock movement: Katana's stock already includes it.`,
      materialsCost: String(r4(num(r["Materials cost"]) + num(r["Sub-assemblies cost"]))),
      operationsCost: String(r4(num(r["Operations cost"]))),
      completedAt: new Date(`${done}T00:00:00Z`),
      createdAt: new Date(`${isoDate(ing[0]?.["Created date"] ?? null) ?? done}T00:00:00Z`),
    });
    ing.forEach((g, i) => {
      const ingSku = text(g["Ingredient variant code/SKU"]);
      const ip = ingSku ? productBySku.get(ingSku.toLowerCase()) : undefined;
      if (!ip) return void unknownIngredients++;
      const actual = num(g["Actual quantity of ingredient"]);
      const cost = num(g["Ingredient cost"]);
      mats.push({
        moId: id,
        productId: ip.id,
        plannedQty: String(num(g["Planned quantity of ingredient"])),
        actualQty: String(actual),
        unitCost: actual ? String(r4(cost / actual)) : null,
        batchNo: text(g["Ingredient Batch number"]),
        note: text(g["Ingredient notes"]),
        sortOrder: i,
      });
    });
  }

  // Recipes for products that don't have one yet.
  const withRecipe = new Set((await db.selectDistinct({ productId: recipeLines.productId }).from(recipeLines)).map((r) => r.productId));
  const recipes: (typeof recipeLines.$inferInsert)[] = [];
  let recipeProducts = 0;
  for (const [productId, { qty, ing }] of latest) {
    if (withRecipe.has(productId)) continue;
    const lines = new Map<string, { qty: number; note: string | null }>();
    for (const g of ing) {
      const ingSku = text(g["Ingredient variant code/SKU"]);
      const ip = ingSku ? productBySku.get(ingSku.toLowerCase()) : undefined;
      const planned = num(g["Planned quantity of ingredient"]);
      if (!ip || ip.id === productId || planned <= 0) continue;
      const cur = lines.get(ip.id);
      lines.set(ip.id, { qty: (cur?.qty ?? 0) + planned / qty, note: cur?.note ?? text(g["Ingredient notes"]) });
    }
    if (!lines.size) continue;
    recipeProducts++;
    [...lines].forEach(([ingredientId, l], i) => recipes.push({ productId, ingredientId, qtyPerUnit: String(r4(l.qty)), note: l.note, sortOrder: i }));
  }

  await db.transaction(async (tx) => {
    for (let i = 0; i < mos.length; i += 200) await tx.insert(manufacturingOrders).values(mos.slice(i, i + 200));
    for (let i = 0; i < mats.length; i += 500) await tx.insert(moMaterials).values(mats.slice(i, i + 500));
    for (let i = 0; i < recipes.length; i += 500) await tx.insert(recipeLines).values(recipes.slice(i, i + 500));
    if (maxMo)
      await tx
        .insert(numberSequences)
        .values({ entityId, kind: "MO", prefix: "MO-", nextValue: maxMo + 1 })
        .onConflictDoUpdate({ target: [numberSequences.entityId, numberSequences.kind], set: { nextValue: sql`greatest(${numberSequences.nextValue}, excluded.next_value)` } });
  });

  // Link quote/order lines and Katana sales history to products added above (matched on SKU).
  await db.execute(sql`update order_lines l set product_id = p.id, updated_at = now() from sales_orders o, products p
    where l.order_id = o.id and o.entity_id = ${entityId} and p.entity_id = o.entity_id and lower(p.sku) = lower(l.sku) and l.product_id is null and l.sku is not null`);
  await db.execute(sql`update sales_history h set product_id = p.id from products p
    where h.entity_id = ${entityId} and p.entity_id = h.entity_id and lower(p.sku) = lower(h.sku) and h.product_id is null and h.sku is not null`);

  const [seq] = await db.select().from(numberSequences).where(sql`${numberSequences.entityId} = ${entityId} and ${numberSequences.kind} = 'MO'`);
  console.log(
    `${entityId}: ${mos.length} completed MOs loaded (${mats.length} material lines)${skippedExisting ? `, ${skippedExisting} already in the app` : ""} · ` +
      `${added.length} archived Katana items added as inactive products · ${recipeProducts} products given a recipe (${recipes.length} lines; ${withRecipe.size} already had one, left as they were) · next MO number MO-${seq?.nextValue}.`,
  );
  if (unknownProducts.size)
    console.log(`  Skipped: ${[...unknownProducts.values()].reduce((a, b) => a + b, 0)} MOs for ${unknownProducts.size} products no longer in the product list (${[...unknownProducts.keys()].slice(0, 12).join(", ")}${unknownProducts.size > 12 ? "…" : ""})`);
  if (unknownIngredients) console.log(`  Skipped: ${unknownIngredients} ingredient lines whose SKU isn't in the product list.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
