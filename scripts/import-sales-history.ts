/**
 * Loads Katana sales history (shipped orders, one row per line) into sales_history, for reports only.
 * Accepts the workbook's "SalesOrders_History" sheet or a Katana export of Sell > Sales orders > Done (same columns).
 * Re-runnable and merge-safe: orders in the file replace their earlier copy; orders not in the file are kept,
 * so a later export covering only recent months just adds to the history.
 *
 *   npx tsx scripts/import-sales-history.ts NZ "../saveBOARD_NZ_ERP_MVP.xlsx"            (reads the SalesOrders_History sheet)
 *   npx tsx scripts/import-sales-history.ts NZ "../NZ DoneSalesOrders-2026-10-30.xlsx"   (first sheet)
 *   add --prod for Supabase
 */
import "./env";
import { fixMojibake } from "./text-fix";
import ExcelJS from "exceljs";
import { and, eq, inArray } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { customers, entities, products, salesHistory } from "../src/db/schema";

const [entityId, file] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!entityId || !file) {
  console.error('Usage: npx tsx scripts/import-sales-history.ts <NZ|AUS> "<workbook or Katana done-orders export>" [--prod]');
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
/** Katana writes percentages as "15.00%", "10.000" or 15, and Excel sometimes as 0.15: return a fraction. */
const fraction = (v: Cell) => {
  const raw = v && typeof v === "object" && "result" in v ? (v.result as Cell) : v;
  const n = num(raw);
  return typeof raw === "number" && n <= 1 ? n : n / 100;
};
const isoDate = (v: Cell) => {
  const s = text(v);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};
function splitNumber(raw: string) {
  const m = raw.match(/^(Q?SO-\d+)\s*[-/:]?\s*(.*)$/i);
  return m ? { number: m[1].toUpperCase(), title: m[2].trim() || null } : { number: raw, title: null };
}

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet("SalesOrders_History") ?? wb.worksheets[0];
  let headerRow = 0;
  for (let r = 1; r <= 10 && !headerRow; r++) if ((ws.getRow(r).values as Cell[]).some((v) => text(v) === "SO #")) headerRow = r;
  if (!headerRow) throw new Error(`${file}: no "SO #" header in the first 10 rows of sheet "${ws.name}".`);
  const header = (ws.getRow(headerRow).values as Cell[]).map((v) => text(v) ?? "");
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 1) throw new Error(`Column "${name}" not found in sheet "${ws.name}".`);
    return i;
  };
  const C = {
    customer: col("Customer"),
    so: col("SO #"),
    created: col("Created date"),
    category: col("Item category"),
    sku: col("Variant code / SKU"),
    item: col("Item variant"),
    qty: col("Quantity"),
    price: col("Price per unit"),
    discount: col("Discount"),
    tax: col("Tax rate"),
    total: col("Total price without tax"),
    currency: col("Order currency"),
    picked: col("SO picked date"),
    ref: header.indexOf("Customer ref"),
  };

  const db = createDb();
  const [entity] = await db.select().from(entities).where(eq(entities.id, entityId));
  if (!entity) throw new Error(`Unknown entity ${entityId}`);
  const productBySku = new Map(
    (await db.select({ id: products.id, sku: products.sku }).from(products).where(eq(products.entityId, entityId))).map((p) => [p.sku.toLowerCase(), p.id]),
  );
  const customerByName = new Map(
    (await db.select({ id: customers.id, name: customers.name }).from(customers).where(eq(customers.entityId, entityId))).map((c) => [c.name.trim().toLowerCase(), c.id]),
  );

  const rows: (typeof salesHistory.$inferInsert)[] = [];
  const currencies: Record<string, number> = {};
  const noCustomer = new Set<string>();
  let noProduct = 0;
  ws.eachRow((row, i) => {
    if (i <= headerRow) return;
    const rawSo = text(row.getCell(C.so).value);
    if (!rawSo) return;
    const { number, title } = splitNumber(rawSo);
    const customerName = text(row.getCell(C.customer).value) ?? "Unknown customer";
    const customerId = customerByName.get(customerName.toLowerCase()) ?? null;
    if (!customerId) noCustomer.add(customerName);
    const sku = text(row.getCell(C.sku).value);
    const productId = sku ? (productBySku.get(sku.toLowerCase()) ?? null) : null;
    if (sku && !productId) noProduct++;
    const orderDate = isoDate(row.getCell(C.created).value);
    if (!orderDate) return;
    const currency = text(row.getCell(C.currency).value) ?? entity.currency;
    const subtotal = num(row.getCell(C.total).value);
    currencies[currency] = (currencies[currency] ?? 0) + subtotal;
    rows.push({
      entityId,
      soNumber: number,
      title,
      customerName,
      customerId,
      orderDate,
      shippedOn: isoDate(row.getCell(C.picked).value),
      productId,
      sku,
      description: text(row.getCell(C.item).value) ?? sku ?? "(no description)",
      category: text(row.getCell(C.category).value),
      qty: String(num(row.getCell(C.qty).value)),
      unitPrice: String(num(row.getCell(C.price).value)),
      discountPct: String(fraction(row.getCell(C.discount).value)),
      taxRate: String(fraction(row.getCell(C.tax).value)),
      subtotal: String(subtotal),
      currency,
      customerRef: C.ref > 0 ? text(row.getCell(C.ref).value) : null,
    });
  });
  if (!rows.length) throw new Error("No sales lines found.");

  const numbers = [...new Set(rows.map((r) => r.soNumber))];
  await db.transaction(async (tx) => {
    for (let i = 0; i < numbers.length; i += 500)
      await tx.delete(salesHistory).where(and(eq(salesHistory.entityId, entityId), inArray(salesHistory.soNumber, numbers.slice(i, i + 500))));
    for (let i = 0; i < rows.length; i += 500) await tx.insert(salesHistory).values(rows.slice(i, i + 500));
  });

  const dates = rows.map((r) => r.shippedOn ?? r.orderDate).sort();
  console.log(
    `${entityId}: ${rows.length} history lines from ${numbers.length} orders (${dates[0]} to ${dates.at(-1)}) · ` +
      Object.entries(currencies)
        .map(([c, v]) => `${v.toLocaleString("en-NZ", { maximumFractionDigits: 2 })} ${c} ex tax`)
        .join(" + ") +
      ` · ${noCustomer.size} customer names not in the app (kept as text) · ${noProduct} lines with SKUs not in the product list.`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
