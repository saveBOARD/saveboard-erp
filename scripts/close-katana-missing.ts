/**
 * Switchover tidy-up. After re-importing Katana's final exports, anything imported from Katana earlier that is no
 * longer in them was finished (or deleted) in Katana in the meantime:
 *  - Katana sales orders still Open/Picked here but not in the final open-orders export -> Closed (they shipped in
 *    Katana, so they must stop committing stock). Orders with a shipment recorded in the app are left alone.
 *  - Katana quotes still Draft/Sent here but in neither final export -> Expired.
 * Only rows with source = "katana" are touched; anything created in the app is never changed.
 *
 *   npx tsx scripts/close-katana-missing.ts NZ "<OpenSalesOrders.xlsx>" "<SalesOrders (quotes).xlsx>"           # preview
 *   npx tsx scripts/close-katana-missing.ts NZ "<OpenSalesOrders.xlsx>" "<SalesOrders (quotes).xlsx>" --apply   # write
 *   add --prod for Supabase
 */
import "./env";
import ExcelJS from "exceljs";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { auditLog, salesOrders, shipments } from "../src/db/schema";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const apply = process.argv.includes("--apply");
const [entityId, openFile, quotesFile] = args;
if (!entityId || !openFile || !quotesFile) {
  console.error('Usage: npx tsx scripts/close-katana-missing.ts <NZ|AUS> "<open orders export>" "<quotes export>" [--apply] [--prod]');
  process.exit(1);
}

/** The SO numbers in a Katana SalesOrders export ("SO-132 - Chris Tramix" -> "SO-132"). */
async function numbersIn(file: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  const header = (ws.getRow(1).values as unknown[]).map((v) => String(v ?? "").trim());
  const col = header.indexOf("SO #");
  if (col < 1) throw new Error(`${file}: no "SO #" column — is this a Katana sales orders export?`);
  const out = new Set<string>();
  ws.eachRow((row, i) => {
    if (i === 1) return;
    const raw = String(row.getCell(col).value ?? "").trim();
    const m = raw.match(/^(Q?SO-\d+)/i);
    if (m) out.add(m[1].toUpperCase());
  });
  return out;
}

async function main() {
  const [openNumbers, quoteNumbers] = await Promise.all([numbersIn(openFile), numbersIn(quotesFile)]);
  if (!openNumbers.size && !quoteNumbers.size) throw new Error("Both files are empty — refusing to close everything.");
  const db = createDb();

  const openHere = await db
    .select({ id: salesOrders.id, number: salesOrders.number, status: salesOrders.status })
    .from(salesOrders)
    .where(and(eq(salesOrders.entityId, entityId), eq(salesOrders.source, "katana"), inArray(salesOrders.status, ["open", "picked"])));
  const shipped = new Set(
    (
      await db
        .selectDistinct({ orderId: shipments.orderId })
        .from(shipments)
        .where(and(eq(shipments.entityId, entityId), sql`${shipments.reversedAt} is null`))
    ).map((s) => s.orderId),
  );
  const toClose = openHere.filter((o) => !openNumbers.has(o.number) && !shipped.has(o.id));
  const keptShipped = openHere.filter((o) => !openNumbers.has(o.number) && shipped.has(o.id));

  const quotesHere = await db
    .select({ id: salesOrders.id, number: salesOrders.number, quoteStatus: salesOrders.quoteStatus })
    .from(salesOrders)
    .where(and(eq(salesOrders.entityId, entityId), eq(salesOrders.source, "katana"), eq(salesOrders.status, "quote"), inArray(salesOrders.quoteStatus, ["draft", "sent"])));
  const toExpire = quotesHere.filter((q) => !quoteNumbers.has(q.number) && !openNumbers.has(q.number));

  console.log(`${entityId}: final Katana exports have ${openNumbers.size} open orders and ${quoteNumbers.size} quotes.`);
  console.log(`  Orders to close (finished in Katana): ${toClose.length ? toClose.map((o) => o.number).join(", ") : "none"}`);
  if (keptShipped.length) console.log(`  Left open (already shipped in the app, check by hand): ${keptShipped.map((o) => o.number).join(", ")}`);
  console.log(`  Quotes to expire (gone from Katana): ${toExpire.length ? toExpire.map((q) => q.number).join(", ") : "none"}`);

  if (apply && (toClose.length || toExpire.length)) {
    await db.transaction(async (tx) => {
      if (toClose.length) {
        await tx.update(salesOrders).set({ status: "closed", updatedAt: new Date() }).where(inArray(salesOrders.id, toClose.map((o) => o.id)));
        await tx.insert(auditLog).values(
          toClose.map((o) => ({
            entityId,
            tableName: "sales_orders",
            recordId: o.id,
            action: "order_status",
            changes: { number: o.number, status: { from: o.status, to: "closed" }, reason: "Not in Katana's final open orders (finished in Katana)" },
          })),
        );
      }
      if (toExpire.length) {
        await tx.update(salesOrders).set({ quoteStatus: "expired", updatedAt: new Date() }).where(inArray(salesOrders.id, toExpire.map((q) => q.id)));
        await tx.insert(auditLog).values(
          toExpire.map((q) => ({
            entityId,
            tableName: "sales_orders",
            recordId: q.id,
            action: "expire_quote",
            changes: { number: q.number, quoteStatus: { from: q.quoteStatus, to: "expired" }, reason: "Not in Katana's final exports" },
          })),
        );
      }
    });
    console.log("  Written.");
  } else if (!apply) console.log("  PREVIEW ONLY — nothing written. Add --apply to write.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
