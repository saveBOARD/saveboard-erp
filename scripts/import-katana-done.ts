/**
 * Loads Katana's completed sales orders (Sell > Sales orders > Done > download) as Closed sales orders, so they
 * show on Sell > Sales orders > Done, on customer pages and for returns.
 *  - Each order gets one delivery record (dated Katana's picked date, with its batch numbers) so it shows as
 *    Shipped. NO stock movements: Katana's stock figures already include these deliveries. These deliveries can't
 *    be reversed.
 *  - Re-runnable: an order already imported from Katana (quote, open, picked or closed) is replaced and closed.
 *    Anything done to an order in the app (shipments, returns, invoices) is never overwritten: those are skipped.
 *  - Katana's own line totals are kept as they are (older orders sometimes differ by rounding from qty × price).
 *  - Customers not in the app are created as inactive (history only), so they don't crowd the order screens.
 *  - The SO number sequence is only ever moved forward, and only by real "SO-123" numbers (Katana allowed free text).
 *
 *   npx tsx scripts/import-katana-done.ts NZ "../NZ DoneSalesOrders-2026-09-29-10_07.xlsx" [--prod]
 * Run scripts/import-sales-history.ts on the same file too, so the sales reports have the same orders.
 */
import "./env";
import { randomUUID } from "node:crypto";
import { fixMojibake } from "./text-fix";
import ExcelJS from "exceljs";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { customers, entities, numberSequences, orderLines, products, salesOrders, shipmentLines, shipments } from "../src/db/schema";

const [entityId, file] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!entityId || !file) {
  console.error('Usage: npx tsx scripts/import-katana-done.ts <NZ|AUS> "<Katana DoneSalesOrders export>" [--prod]');
  process.exit(1);
}

type Raw = Record<string, ExcelJS.CellValue>;
const text = (v: ExcelJS.CellValue): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object" && "result" in v) return text(v.result as ExcelJS.CellValue);
  if (typeof v === "object" && "richText" in v) return text(v.richText.map((r) => r.text).join(""));
  const s = String(v).trim();
  return s === "" ? null : fixMojibake(s);
};
const num = (v: ExcelJS.CellValue) => {
  const s = text(v);
  if (s === null) return 0;
  const n = Number(s.replace(/[%,$\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const fraction = (v: ExcelJS.CellValue) => {
  const raw = v && typeof v === "object" && "result" in v ? (v.result as ExcelJS.CellValue) : v;
  const n = num(raw);
  return typeof raw === "number" && n <= 1 ? n : n / 100;
};
const isoDate = (v: ExcelJS.CellValue) => {
  const s = text(v);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};
const r4 = (n: number) => Math.round(n * 10000) / 10000;
/** "SO-132 - Chris Tramix" -> SO-132 / "Chris Tramix"; free text (older Katana orders) is kept whole. */
function splitNumber(raw: string) {
  const m = raw.match(/^(Q?SO-\d+)\s*[-/:]?\s*(.*)$/i);
  return m ? { number: m[1].toUpperCase(), title: m[2].trim() || null } : { number: raw, title: null };
}

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  const header = (ws.getRow(1).values as ExcelJS.CellValue[]).map((v) => text(v) ?? "");
  if (!header.includes("SO #")) throw new Error(`${file}: this isn't a Katana sales orders export (no "SO #" column).`);
  const rows: Raw[] = [];
  ws.eachRow((row, i) => {
    if (i === 1) return;
    const r: Raw = {};
    header.forEach((h, c) => h && (r[h] = row.getCell(c).value ?? null));
    if (text(r["SO #"])) rows.push(r);
  });

  // Group by order number (two Katana references can mean the same SO number), keeping Katana's order.
  const groups = new Map<string, { title: string | null; lines: Raw[] }>();
  for (const r of rows) {
    const { number, title } = splitNumber(text(r["SO #"])!);
    const g = groups.get(number) ?? { title, lines: [] };
    g.title ??= title;
    g.lines.push(r);
    groups.set(number, g);
  }

  const db = createDb();
  const [entity] = await db.select().from(entities).where(eq(entities.id, entityId));
  if (!entity) throw new Error(`Unknown entity ${entityId}`);
  const productBySku = new Map(
    (await db.select({ id: products.id, sku: products.sku }).from(products).where(eq(products.entityId, entityId))).map((p) => [p.sku.toLowerCase(), p.id]),
  );
  const customerByName = new Map(
    (await db.select({ id: customers.id, name: customers.name }).from(customers).where(eq(customers.entityId, entityId))).map((c) => [c.name.trim().toLowerCase(), c.id]),
  );
  const existing = new Map(
    (
      await db
        .select({
          id: salesOrders.id,
          number: salesOrders.number,
          status: salesOrders.status,
          source: salesOrders.source,
          appShipments: sql<number>`(select count(*)::int from shipments s where s.order_id = ${salesOrders.id} and coalesce(s.carrier, '') <> 'Katana')`,
          returns: sql<number>`(select count(*)::int from sales_returns r where r.order_id = ${salesOrders.id})`,
        })
        .from(salesOrders)
        .where(eq(salesOrders.entityId, entityId))
    ).map((o) => [o.number, o]),
  );

  const skipped: string[] = [];
  const newCustomers: string[] = [];
  let replaced = 0;
  let created = 0;
  let adjustedTotals = 0;
  let maxSo = 0;
  let grand = 0;
  let lineCount = 0;
  type Prepared = {
    id: string;
    isNew: boolean;
    header: typeof salesOrders.$inferInsert;
    lines: (typeof orderLines.$inferInsert)[];
    shipment: typeof shipments.$inferInsert;
    shipLines: (typeof shipmentLines.$inferInsert)[];
  };
  const prepared: Prepared[] = [];

  for (const [number, { title, lines }] of groups) {
    const so = number.match(/^SO-(\d+)$/);
    if (so) maxSo = Math.max(maxSo, Number(so[1]));
    const prev = existing.get(number);
    if (prev && (prev.source !== "katana" || prev.appShipments > 0 || prev.returns > 0 || ["shipped", "invoiced"].includes(prev.status))) {
      skipped.push(number);
      continue;
    }

    const head = lines[0];
    const customerName = text(head["Customer"]) ?? "Unknown customer";
    let customerId = customerByName.get(customerName.toLowerCase());
    const withAddress = lines.find((l) => text(l["Ship to address line 1"])) ?? head;
    const shipTo = {
      shipToName: text(withAddress["Ship to name"]),
      shipToPhone: text(withAddress["Ship to phone number"]),
      shipToLine1: text(withAddress["Ship to address line 1"]),
      shipToLine2: text(withAddress["Ship to address line 2"]),
      shipToCity: text(withAddress["Ship to city"]),
      shipToRegion: text(withAddress["Ship to state"]),
      shipToPostcode: text(withAddress["Ship to zip code"]),
      shipToCountry: text(withAddress["Ship to country"]),
    };
    if (!customerId) {
      const [c] = await db
        .insert(customers)
        .values({
          entityId,
          name: customerName,
          billingLine1: shipTo.shipToLine1,
          billingLine2: shipTo.shipToLine2,
          billingCity: shipTo.shipToCity,
          billingRegion: shipTo.shipToRegion,
          billingPostcode: shipTo.shipToPostcode,
          billingCountry: shipTo.shipToCountry,
          active: false,
          notes: `Created from Katana order history (${number}) during import; inactive until they order again.`,
        })
        .returning({ id: customers.id });
      customerId = c.id;
      customerByName.set(customerName.toLowerCase(), customerId);
      newCustomers.push(customerName);
    }

    const orderId = prev?.id ?? randomUUID();
    let subtotal = 0;
    let tax = 0;
    const lineValues = lines.map((l, i) => {
      const sku = text(l["Variant code / SKU"]);
      const qty = num(l["Quantity"]);
      const unitPrice = num(l["Price per unit"]);
      const discountPct = r4(fraction(l["Discount"]));
      const taxRate = r4(num(l["Tax rate"]) / 100);
      const calc = r4(qty * unitPrice * (1 - discountPct));
      const ex = text(l["Total price without tax"]) === null ? calc : r4(num(l["Total price without tax"]));
      const inc = text(l["Total price with tax"]) === null ? r4(ex * (1 + taxRate)) : r4(num(l["Total price with tax"]));
      if (Math.abs(ex - calc) > 0.02) adjustedTotals++;
      subtotal += ex;
      tax += inc - ex;
      return {
        id: randomUUID(),
        orderId,
        lineNo: i + 1,
        productId: sku ? (productBySku.get(sku.toLowerCase()) ?? null) : null,
        sku,
        description: text(l["Item variant"]) ?? sku ?? "(no description)",
        qty: String(qty),
        unitPrice: String(unitPrice),
        discountPct: String(discountPct),
        taxRate: String(taxRate),
        lineSubtotal: String(ex),
        lineTax: String(r4(inc - ex)),
        batchNo: text(l["Batch no"]),
      };
    });
    const fx = num(head["Conversion rate"]) || 1;
    grand += subtotal * fx;
    lineCount += lineValues.length;
    const orderDate = isoDate(head["Created date"]) ?? new Date().toISOString().slice(0, 10);
    const shippedOn = isoDate(head["SO picked date"]) ?? isoDate(head["Fulfillment picked date"]) ?? orderDate;
    const shipmentId = randomUUID();
    prepared.push({
      id: orderId,
      isNew: !prev,
      header: {
        id: orderId,
        entityId,
        number,
        title,
        status: "closed",
        quoteStatus: "accepted",
        customerId,
        customerReference: text(head["Customer ref"]),
        orderDate,
        deliveryDeadline: isoDate(head["Del. deadline"]),
        ...shipTo,
        notes: text(lines.map((l) => text(l["Additional info"])).find(Boolean) ?? null),
        currency: text(head["Order currency"]) ?? entity.currency,
        fxRate: String(fx),
        subtotal: String(r4(subtotal)),
        tax: String(r4(tax)),
        total: String(r4(subtotal + tax)),
        source: "katana",
      },
      lines: lineValues,
      shipment: { id: shipmentId, entityId, orderId, seq: 1, shippedOn, carrier: "Katana", notes: "Delivered in Katana (imported history). No stock movement: Katana's stock already allowed for it." },
      shipLines: lineValues
        .filter((l) => Number(l.qty) > 0)
        .map((l) => ({ shipmentId, orderLineId: l.id, productId: l.productId, qty: l.qty, batchNo: l.batchNo })),
    });
    if (prev) replaced++;
    else created++;
  }

  // Write in batches of 100 orders, each batch in one transaction.
  for (let i = 0; i < prepared.length; i += 100) {
    const batch = prepared.slice(i, i + 100);
    const old = batch.filter((p) => !p.isNew).map((p) => p.id);
    await db.transaction(async (tx) => {
      if (old.length) {
        await tx.delete(shipments).where(inArray(shipments.orderId, old)); // Katana delivery records (lines cascade)
        await tx.delete(orderLines).where(inArray(orderLines.orderId, old));
      }
      await tx
        .insert(salesOrders)
        .values(batch.map((p) => p.header))
        .onConflictDoUpdate({
          target: [salesOrders.entityId, salesOrders.number],
          set: {
            title: sql`excluded.title`,
            status: sql`excluded.status`,
            quoteStatus: sql`excluded.quote_status`,
            customerId: sql`excluded.customer_id`,
            customerReference: sql`excluded.customer_reference`,
            orderDate: sql`excluded.order_date`,
            deliveryDeadline: sql`excluded.delivery_deadline`,
            shipToName: sql`excluded.ship_to_name`,
            shipToPhone: sql`excluded.ship_to_phone`,
            shipToLine1: sql`excluded.ship_to_line1`,
            shipToLine2: sql`excluded.ship_to_line2`,
            shipToCity: sql`excluded.ship_to_city`,
            shipToRegion: sql`excluded.ship_to_region`,
            shipToPostcode: sql`excluded.ship_to_postcode`,
            shipToCountry: sql`excluded.ship_to_country`,
            notes: sql`excluded.notes`,
            currency: sql`excluded.currency`,
            fxRate: sql`excluded.fx_rate`,
            subtotal: sql`excluded.subtotal`,
            tax: sql`excluded.tax`,
            total: sql`excluded.total`,
            updatedAt: new Date(),
          },
        });
      await tx.insert(orderLines).values(batch.flatMap((p) => p.lines));
      await tx.insert(shipments).values(batch.map((p) => p.shipment));
      const sl = batch.flatMap((p) => p.shipLines);
      for (let j = 0; j < sl.length; j += 500) await tx.insert(shipmentLines).values(sl.slice(j, j + 500));
    });
    process.stdout.write(`\r  ${Math.min(i + 100, prepared.length)} / ${prepared.length} orders written`);
  }
  process.stdout.write("\n");

  if (maxSo)
    await db
      .insert(numberSequences)
      .values({ entityId, kind: "SO", prefix: "SO-", nextValue: maxSo + 1 })
      .onConflictDoUpdate({ target: [numberSequences.entityId, numberSequences.kind], set: { nextValue: sql`greatest(${numberSequences.nextValue}, excluded.next_value)` } });
  const [seq] = await db.select().from(numberSequences).where(and(eq(numberSequences.entityId, entityId), eq(numberSequences.kind, "SO")));

  console.log(
    `${entityId}: ${prepared.length} completed orders loaded as Closed (${created} new, ${replaced} replacing earlier Katana imports), ${lineCount} lines, ` +
      `${grand.toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${entity.currency} ex tax · ` +
      `${adjustedTotals} lines where Katana's total differs from qty × price (Katana's kept) · ` +
      `${newCustomers.length} past customers added as inactive · next SO number SO-${seq?.nextValue}.`,
  );
  if (skipped.length) console.log(`  Left alone (already worked on in the app): ${skipped.join(", ")}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
