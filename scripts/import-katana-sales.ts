/**
 * Imports quotes and open sales orders from a Katana "SalesOrders" export (Sell > Quotes or
 * Sell > Sales orders > Open > download) into sales_orders. Re-runnable: matched on (entity, number) and replaced,
 * except that a status changed in the app (expired, accepted, shipped…) is kept.
 *
 *   npm run db:import-katana -- AUS "../AUS SalesOrders-2026-09-27-16_03.xlsx"
 *   npm run db:import-katana:prod -- NZ "../NZ OpenSalesOrders-2026-09-27-16_29.xlsx"
 *
 * Katana shipping status -> our status:  Pending = quote (sent) · Not shipped = open · Packed = picked.
 * - Customers not yet in the customer list are created from the order (name + delivery address).
 * - Lines whose SKU isn't a known product keep their SKU text and description (product link left empty).
 * - Every order's total is checked against Katana's own line totals; any mismatch stops the import.
 * - The SO number sequence is moved past the highest imported number (quotes and orders share it).
 * - No stock moves: open orders only commit stock; it leaves when they are shipped in the app.
 */
import "./env";
import ExcelJS from "exceljs";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { customers, entities, numberSequences, orderLines, products, salesOrders } from "../src/db/schema";

const [entityId, file] = process.argv.slice(2).filter((a) => a !== "--prod");
if (!entityId || !file) {
  console.error('Usage: npm run db:import-katana -- <NZ|AUS> "<path to Katana export.xlsx>"');
  process.exit(1);
}

type Raw = Record<string, string | number | Date | null>;
const text = (v: unknown) => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object" && v && "result" in v) return text((v as { result: unknown }).result);
  const s = String(v).trim();
  return s === "" ? null : s;
};
const num = (v: unknown) => {
  const s = text(v);
  if (s === null) return 0;
  const n = Number(s.replace(/[%,$]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const round = (n: number, dp = 4) => Math.round(n * 10 ** dp) / 10 ** dp;
/**
 * Katana exports discounts two ways: as text ("15.00%") or as an Excel percentage cell (0.15).
 * Returns a fraction (0.15 = 15%).
 */
const discountFraction = (v: unknown) => {
  const raw = v && typeof v === "object" && "result" in v ? (v as { result: unknown }).result : v;
  if (typeof raw === "number") return raw > 1 ? raw / 100 : raw;
  return num(raw) / 100;
};
const isoDate = (v: unknown) => {
  const s = text(v);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

/** "SO-132 - Chris Tramix" -> { number: "SO-132", title: "Chris Tramix" } */
function splitNumber(raw: string) {
  const m = raw.match(/^(Q?SO-\d+)\s*[-/:]?\s*(.*)$/i);
  if (!m) return { number: raw, title: null };
  return { number: m[1].toUpperCase(), title: m[2].trim() || null };
}

async function main() {
  const db = createDb();
  const [entity] = await db.select().from(entities).where(eq(entities.id, entityId));
  if (!entity) throw new Error(`Unknown entity ${entityId}`);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  const header = (ws.getRow(1).values as unknown[]).map((v) => text(v) ?? "");
  const rows: Raw[] = [];
  ws.eachRow((row, i) => {
    if (i === 1) return;
    const r: Raw = {};
    header.forEach((h, c) => h && (r[h] = (row.getCell(c).value as Raw[string]) ?? null));
    if (text(r["SO #"])) rows.push(r);
  });

  // group lines by quote, keeping Katana's order
  const byQuote = new Map<string, Raw[]>();
  for (const r of rows) {
    const key = text(r["SO #"])!;
    byQuote.set(key, [...(byQuote.get(key) ?? []), r]);
  }

  const productBySku = new Map(
    (await db.select({ id: products.id, sku: products.sku }).from(products).where(eq(products.entityId, entityId))).map((p) => [
      p.sku.toLowerCase(),
      p.id,
    ]),
  );
  const customerByName = new Map(
    (await db.select({ id: customers.id, name: customers.name }).from(customers).where(eq(customers.entityId, entityId))).map(
      (c) => [c.name.trim().toLowerCase(), c.id],
    ),
  );

  let newCustomers = 0;
  let unknownSkuLines = 0;
  let maxNumber = 0;
  let grandTotal = 0;
  const quoteNumbers: string[] = [];
  const statusCounts: Record<string, number> = {};

  for (const [rawNumber, lines] of byQuote) {
    const head = lines[0];
    const { number, title } = splitNumber(rawNumber);
    quoteNumbers.push(number);
    maxNumber = Math.max(maxNumber, Number(number.replace(/\D/g, "")));

    // ---- customer (match on name, else create from the quote's delivery details)
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
          notes: `Created from Katana order ${number} during import`,
        })
        .returning({ id: customers.id });
      customerId = c.id;
      customerByName.set(customerName.toLowerCase(), customerId);
      newCustomers++;
    }

    // ---- lines
    let subtotal = 0;
    let tax = 0;
    let katanaEx = 0;
    let katanaInc = 0;
    const lineValues = lines.map((l, i) => {
      const sku = text(l["Variant code / SKU"]);
      const productId = sku ? productBySku.get(sku.toLowerCase()) ?? null : null;
      if (sku && !productId) unknownSkuLines++;
      const qty = num(l["Quantity"]);
      const unitPrice = num(l["Price per unit"]);
      const discountPct = round(discountFraction(l["Discount"]), 6);
      const taxRate = round(num(l["Tax rate"]) / 100, 6);
      const lineSubtotal = round(qty * unitPrice * (1 - discountPct), 4);
      const lineTax = round(lineSubtotal * taxRate, 4);
      subtotal += lineSubtotal;
      tax += lineTax;
      katanaEx += num(l["Total price without tax"]);
      katanaInc += num(l["Total price with tax"]);
      return {
        lineNo: i + 1,
        productId,
        sku,
        description: text(l["Item variant"]) ?? sku ?? "(no description)",
        qty: String(qty),
        unitPrice: String(unitPrice),
        discountPct: String(discountPct),
        taxRate: String(taxRate),
        lineSubtotal: String(lineSubtotal),
        lineTax: String(lineTax),
      };
    });
    if (Math.abs(subtotal - katanaEx) > 0.02 || Math.abs(subtotal + tax - katanaInc) > 0.02) {
      throw new Error(
        `${number}: totals don't match Katana (ours ${subtotal.toFixed(2)} / ${(subtotal + tax).toFixed(2)}, ` +
          `Katana ${katanaEx.toFixed(2)} / ${katanaInc.toFixed(2)}). Nothing after this quote was imported.`,
      );
    }
    grandTotal += subtotal * (num(head["Conversion rate"]) || 1);

    // ---- header (replace any previous import of the same order)
    const katanaStatus = lines.map((l) => text(l["Shipping status"])).filter(Boolean) as string[];
    const status = katanaStatus.every((s) => s === "Pending")
      ? ("quote" as const)
      : katanaStatus.length && katanaStatus.every((s) => s === "Packed")
        ? ("picked" as const)
        : katanaStatus.some((s) => s === "Delivered") && katanaStatus.every((s) => s === "Delivered")
          ? ("shipped" as const)
          : ("open" as const);
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
    const values = {
      entityId,
      number,
      title,
      status,
      quoteStatus: status === "quote" ? ("sent" as const) : ("accepted" as const),
      customerId,
      customerReference: text(head["Customer ref"]),
      orderDate: isoDate(head["Created date"]) ?? new Date().toISOString().slice(0, 10),
      deliveryDeadline: isoDate(head["Del. deadline"]),
      ...shipTo,
      notes: text(lines.map((l) => text(l["Additional info"])).find(Boolean)),
      currency: text(head["Order currency"]) ?? entity.currency,
      fxRate: String(num(head["Conversion rate"]) || 1),
      subtotal: subtotal.toFixed(4),
      tax: tax.toFixed(4),
      total: (subtotal + tax).toFixed(4),
      source: "katana",
    };
    const [order] = await db
      .insert(salesOrders)
      .values(values)
      // On re-import keep any status decided in the app (a quote marked expired, an order shipped…),
      // except that a quote Katana has since turned into an order moves forward to that order status.
      .onConflictDoUpdate({
        target: [salesOrders.entityId, salesOrders.number],
        set: {
          ...values,
          status: sql`case when ${salesOrders.status} = 'quote' and excluded.status <> 'quote' then excluded.status else ${salesOrders.status} end`,
          quoteStatus: sql`case when ${salesOrders.status} = 'quote' and excluded.status <> 'quote' then 'accepted'::quote_status else ${salesOrders.quoteStatus} end`,
          updatedAt: new Date(),
        },
      })
      .returning({ id: salesOrders.id });
    await db.delete(orderLines).where(eq(orderLines.orderId, order.id));
    await db.insert(orderLines).values(lineValues.map((l) => ({ ...l, orderId: order.id })));
  }

  // quotes and orders share the SO sequence: never hand out a number Katana already used
  await db
    .insert(numberSequences)
    .values({ entityId, kind: "SO", prefix: "SO-", nextValue: maxNumber + 1 })
    .onConflictDoUpdate({
      target: [numberSequences.entityId, numberSequences.kind],
      set: { nextValue: sql`greatest(${numberSequences.nextValue}, excluded.next_value)` },
    });
  const [seq] = await db
    .select()
    .from(numberSequences)
    .where(and(eq(numberSequences.entityId, entityId), eq(numberSequences.kind, "SO")));

  const imported = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(salesOrders)
    .where(and(eq(salesOrders.entityId, entityId), inArray(salesOrders.number, quoteNumbers)));
  console.log(
    `${entityId}: ${imported[0].n} orders [${Object.entries(statusCounts).map(([s, n]) => `${n} ${s}`).join(", ")}] (${rows.length} lines, ${grandTotal.toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ` +
      `${entity.currency} ex tax, all totals match Katana), ${newCustomers} new customers, ` +
      `${unknownSkuLines} lines with SKUs not in the product list. Next SO number: SO-${seq.nextValue}.`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
