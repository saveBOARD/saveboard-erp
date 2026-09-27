/**
 * Fills in missing customer details from a Katana customer export — the same import as Settings > Import customers
 * (rules in src/lib/imports/katana-customers.ts).
 *
 *   npm run db:import-customers -- NZ "../NZ katana_customers_edit_2026-09-27.xlsx"            # preview only
 *   npm run db:import-customers -- NZ "../NZ katana_customers_edit_2026-09-27.xlsx" --apply    # write
 *   npm run db:import-customers:prod -- NZ "<file>" [--apply]                                  # Supabase
 *
 * Every run writes a report next to the input file listing each customer and what was (or would be) changed.
 */
import "./env";
import path from "node:path";
import ExcelJS from "exceljs";
import { eq } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { entities } from "../src/db/schema";
import { importKatanaCustomers, parseKatanaCustomers } from "../src/lib/imports/katana-customers";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const apply = process.argv.includes("--apply");
const [entityId, file] = args;
if (!entityId || !file) {
  console.error('Usage: npm run db:import-customers -- <NZ|AUS> "<path to katana_customers_edit.xlsx>" [--apply]');
  process.exit(1);
}

async function main() {
  const input = new ExcelJS.Workbook();
  await input.xlsx.readFile(file);
  const katana = parseKatanaCustomers(input);
  const db = createDb();
  const [entity] = await db.select().from(entities).where(eq(entities.id, entityId));
  if (!entity) throw new Error(`Entity ${entityId} not found.`);
  const { rows, counts } = await importKatanaCustomers(db, entityId, katana, { apply });

  const out = path.join(
    path.dirname(file),
    `${path.basename(file, path.extname(file))} - ${apply ? "import result" : "import preview"}.xlsx`,
  );
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Customers");
  ws.columns = [
    { header: "Katana name", key: "katanaName", width: 40 },
    { header: "App customer", key: "appName", width: 40 },
    { header: "Outcome", key: "outcome", width: 18 },
    { header: "Details", key: "detail", width: 60 },
    { header: "Delivery sites added", key: "sitesAdded", width: 12 },
    { header: "Katana customer ID", key: "katanaIds", width: 20 },
  ];
  ws.addRows(rows);
  ws.getRow(1).font = { bold: true };
  ws.autoFilter = { from: "A1", to: "F1" };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  await wb.xlsx.writeFile(out);

  console.log(
    `${entityId}: ${counts.katana} Katana customers · ${counts.filled} filled in · ${counts.unchanged} nothing missing · ` +
      `${counts.created} new · ${counts.skipped} skipped (name unclear — see report) · ${counts.sites} delivery sites · ` +
      `${counts.appOnly} app customers not in Katana (left alone)`,
  );
  console.log(apply ? `Written to the database. Report: ${out}` : `PREVIEW ONLY — nothing written. Report: ${out}\nRun again with --apply to write.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
