/**
 * Imports master data from the Excel MVP workbooks into the database:
 *   suppliers, customers (+ a default delivery site), products, opening stock, document number sequences.
 * Re-runnable: rows are matched on (entity, name) / (entity, SKU) and updated; opening stock is replaced.
 *
 *   npm run db:import                     # uses ../saveBOARD_NZ_ERP_MVP.xlsx and ../saveBOARD_AUS_ERP_MVP_3.xlsx
 *   npm run db:import -- NZ=path AUS=path # other files
 *   npm run db:import:prod                # into Supabase (reads .env.production.local)
 */
import "./env";
import { fixMojibake } from "./text-fix";
import ExcelJS from "exceljs";
import { and, eq, sql } from "drizzle-orm";
import { createDb, type Db } from "../src/db/client";
import { customers, entities, numberSequences, products, stockMovements, suppliers } from "../src/db/schema";

const FILES: Record<string, string> = {
  NZ: "../saveBOARD_NZ_ERP_MVP.xlsx",
  AUS: "../saveBOARD_AUS_ERP_MVP_3.xlsx",
};
for (const arg of process.argv.slice(2)) {
  const [k, v] = arg.split("=");
  if (k in FILES && v) FILES[k] = v;
}

const OPENING_STOCK_DATE = new Date("2026-09-11T00:00:00+12:00"); // Katana snapshot the workbooks were loaded from
const MATERIAL_CATEGORIES = new Set(["Facing Materials", "Finishing Materials", "Input Materials", "Packaging & Handling"]);
// Last numbers seen in Katana NZ screens on 26/9/26 (newer than the 11/9 exports).
const KATANA_KNOWN_LAST: Record<string, Record<string, number>> = {
  NZ: { SO: 1585, MO: 350, PO: 22, SA: 80, STK: 22 },
  AUS: {},
};

type Cell = ExcelJS.CellValue;
function val(v: Cell): string | number | boolean | Date | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && !(v instanceof Date)) {
    if ("result" in v) return val(v.result as Cell);
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    if ("text" in v) return String(v.text);
    if ("error" in v) return null;
    return null;
  }
  return v as string | number | boolean | Date;
}
const str = (v: Cell) => {
  const x = val(v);
  if (x === null) return null;
  const s = (x instanceof Date ? x.toISOString().slice(0, 10) : String(x)).trim();
  return s === "" ? null : fixMojibake(s);
};
const num = (v: Cell) => {
  const x = val(v);
  if (x === null || x === "") return null;
  const n = typeof x === "number" ? x : Number(String(x).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
};

function rows(ws: ExcelJS.Worksheet, firstRow = 2) {
  const out: ExcelJS.Row[] = [];
  for (let r = firstRow; r <= ws.rowCount; r++) out.push(ws.getRow(r));
  return out;
}

/**
 * Last document number actually in use: the highest number among the most recent six months of history,
 * ignoring outliers. Katana history has references that aren't the running sequence — old formats
 * ("MO-2021-001") and numbers typed straight onto a date code ("MO-666250861" = MO-666 + 250861) —
 * so a plain maximum would jump the sequence by millions.
 */
function lastNumber(ws: ExcelJS.Worksheet | undefined, numCol: number, dateCol: number, prefix: string, firstRow: number) {
  if (!ws) return 0;
  const re = new RegExp(`^${prefix}-(\\d+)`, "i");
  const found: { n: number; date: number }[] = [];
  for (const row of rows(ws, firstRow)) {
    const m = str(row.getCell(numCol).value)?.match(re);
    const d = Date.parse(str(row.getCell(dateCol).value) ?? "");
    if (m && Number.isFinite(d)) found.push({ n: Number(m[1]), date: d });
  }
  if (!found.length) return 0;
  const latest = Math.max(...found.map((f) => f.date));
  const recent = found.filter((f) => f.date >= latest - 183 * 86_400_000).map((f) => f.n).sort((a, b) => a - b);
  const median = recent[Math.floor(recent.length / 2)];
  return Math.max(...recent.filter((n) => n <= median * 1.5 + 50));
}

async function importEntity(db: Db, entityId: string, file: string) {
  const [entity] = await db.select().from(entities).where(eq(entities.id, entityId));
  if (!entity) throw new Error(`Entity ${entityId} missing — run npm run db:seed first.`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const sheet = (name: string) => {
    const ws = wb.getWorksheet(name);
    if (!ws) throw new Error(`${file}: sheet "${name}" not found`);
    return ws;
  };

  // ---- suppliers
  const supplierRows = rows(sheet("Suppliers"))
    .map((r) => ({
      entityId,
      name: str(r.getCell(1).value),
      contactName: str(r.getCell(2).value),
      phone: str(r.getCell(3).value),
      email: str(r.getCell(4).value),
      leadTimeDays: num(r.getCell(5).value),
      paymentTerms: str(r.getCell(6).value),
      notes: str(r.getCell(7).value),
    }))
    .filter((s): s is typeof s & { name: string } => !!s.name);
  if (supplierRows.length)
    await db
      .insert(suppliers)
      .values(supplierRows)
      .onConflictDoUpdate({
        target: [suppliers.entityId, suppliers.name],
        set: {
          contactName: sql`excluded.contact_name`,
          phone: sql`excluded.phone`,
          email: sql`excluded.email`,
          leadTimeDays: sql`excluded.lead_time_days`,
          paymentTerms: sql`excluded.payment_terms`,
          notes: sql`excluded.notes`,
        },
      });
  const supplierIds = new Map(
    (await db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(eq(suppliers.entityId, entityId))).map(
      (s) => [s.name, s.id],
    ),
  );

  // ---- customers
  const customerRows = rows(sheet("Customers"))
    .map((r) => {
      const hold = str(r.getCell(16).value);
      return {
        entityId,
        code: str(r.getCell(1).value),
        name: str(r.getCell(2).value),
        billingLine1: str(r.getCell(3).value),
        billingLine2: str(r.getCell(4).value),
        billingCity: str(r.getCell(5).value),
        billingRegion: str(r.getCell(6).value),
        billingPostcode: str(r.getCell(7).value),
        billingCountry: str(r.getCell(8).value),
        contactName: str(r.getCell(9).value),
        phone: str(r.getCell(10).value),
        email: str(r.getCell(11).value),
        businessNumber: str(r.getCell(12).value),
        paymentTerms: str(r.getCell(13).value),
        priceTier: str(r.getCell(14).value),
        creditLimit: num(r.getCell(15).value)?.toString() ?? null,
        creditHold: hold?.toLowerCase() === "yes",
        notes: str(r.getCell(17).value),
      };
    })
    .filter((c): c is typeof c & { name: string } => !!c.name);
  if (customerRows.length)
    await db
      .insert(customers)
      .values(customerRows)
      .onConflictDoUpdate({
        target: [customers.entityId, customers.name],
        set: Object.fromEntries(
          [
            "code", "billing_line1", "billing_line2", "billing_city", "billing_region", "billing_postcode",
            "billing_country", "contact_name", "phone", "email", "business_number", "payment_terms", "price_tier",
            "credit_limit", "credit_hold", "notes",
          ].map((c) => [c.replace(/_([a-z0-9])/g, (_, ch) => ch.toUpperCase()), sql.raw(`excluded.${c}`)]),
        ),
      });
  // default delivery site = billing address, only for customers that have no sites yet
  const sitesAdded = await db.execute(sql`
    insert into customer_sites (customer_id, name, line1, line2, city, region, postcode, country, is_default)
    select c.id, 'Main', c.billing_line1, c.billing_line2, c.billing_city, c.billing_region, c.billing_postcode,
           c.billing_country, true
    from customers c
    where c.entity_id = ${entityId} and c.billing_line1 is not null
      and not exists (select 1 from customer_sites s where s.customer_id = c.id)`);

  // ---- products
  const productRows = rows(sheet("Products"))
    .map((r) => {
      const category = str(r.getCell(3).value);
      const track = (str(r.getCell(13).value) ?? "Yes").toLowerCase() !== "no";
      return {
        entityId,
        sku: str(r.getCell(1).value),
        name: str(r.getCell(2).value) ?? "",
        category,
        type: (!track ? "service" : category && MATERIAL_CATEGORIES.has(category) ? "material" : "product") as
          | "service"
          | "material"
          | "product",
        defaultSupplierId: supplierIds.get(str(r.getCell(4).value) ?? "") ?? null,
        uom: str(r.getCell(5).value),
        standardCost: (num(r.getCell(6).value) ?? 0).toString(),
        opening: num(r.getCell(8).value) ?? 0,
        safetyStock: (num(r.getCell(10).value) ?? 0).toString(),
        trackStock: track,
      };
    })
    .filter((p): p is typeof p & { sku: string } => !!p.sku)
    .filter((p, i, all) => {
      const first = all.findIndex((q) => q.sku === p.sku) === i;
      if (!first) console.warn(`${entityId}: duplicate SKU ${p.sku} ("${p.name}") skipped — first row kept`);
      return first;
    });
  if (productRows.length)
    await db
      .insert(products)
      .values(productRows.map(({ opening, ...p }) => (void opening, p)))
      .onConflictDoUpdate({
        target: [products.entityId, products.sku],
        set: {
          name: sql`excluded.name`,
          category: sql`excluded.category`,
          type: sql`excluded.type`,
          defaultSupplierId: sql`excluded.default_supplier_id`,
          uom: sql`excluded.uom`,
          standardCost: sql`excluded.standard_cost`,
          safetyStock: sql`excluded.safety_stock`,
          trackStock: sql`excluded.track_stock`,
        },
      });
  const productIds = new Map(
    (await db.select({ id: products.id, sku: products.sku }).from(products).where(eq(products.entityId, entityId))).map(
      (p) => [p.sku, p.id],
    ),
  );

  // ---- opening stock (replaced on every import)
  await db.delete(stockMovements).where(and(eq(stockMovements.entityId, entityId), eq(stockMovements.kind, "opening")));
  const openings = productRows
    .filter((p) => p.trackStock && p.opening !== 0)
    .map((p) => ({
      entityId,
      productId: productIds.get(p.sku)!,
      kind: "opening" as const,
      qty: p.opening.toString(),
      unitCost: p.standardCost,
      occurredAt: OPENING_STOCK_DATE,
      note: "Opening stock from Katana snapshot 11/9/26 (Excel workbook)",
    }));
  if (openings.length) await db.insert(stockMovements).values(openings);

  // ---- number sequences: continue after the highest number seen in Katana history
  const last: Record<string, number> = {
    SO: lastNumber(wb.getWorksheet("SalesOrders_History"), 2, 4, "SO", 5),
    PO: lastNumber(wb.getWorksheet("PurchaseOrders_History"), 2, 3, "PO", 5),
    MO: lastNumber(wb.getWorksheet("ManufacturingOrders_History"), 2, 17, "MO", 5),
    SA: 0,
    STK: 0,
  };
  for (const [kind, n] of Object.entries(KATANA_KNOWN_LAST[entityId] ?? {})) last[kind] = Math.max(last[kind] ?? 0, n);
  for (const [kind, n] of Object.entries(last)) {
    await db
      .insert(numberSequences)
      .values({ entityId, kind, prefix: `${kind}-`, nextValue: n + 1 })
      .onConflictDoUpdate({
        target: [numberSequences.entityId, numberSequences.kind],
        set: { nextValue: sql`greatest(${numberSequences.nextValue}, excluded.next_value)` },
      });
  }

  const negative = productRows.filter((p) => p.trackStock && p.opening < 0).length;
  console.log(
    `${entityId}: ${supplierRows.length} suppliers, ${customerRows.length} customers ` +
      `(${siteCount(sitesAdded)} new delivery sites), ` +
      `${productRows.length} products, ${openings.length} opening stock rows (${negative} negative), ` +
      `next numbers: ${Object.entries(last).map(([k, n]) => `${k}-${n + 1}`).join(" ")}`,
  );
}

/** Rows affected by a raw insert: PGlite reports `affectedRows`, postgres-js reports `count`. */
function siteCount(result: unknown) {
  const r = result as { affectedRows?: number; count?: number; rowCount?: number };
  return r.affectedRows ?? r.count ?? r.rowCount ?? 0;
}

async function main() {
  const db = createDb();
  for (const [entityId, file] of Object.entries(FILES)) await importEntity(db, entityId, file);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
