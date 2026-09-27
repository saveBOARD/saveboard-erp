/** Reads price list workbooks the way the Price list upload does: npx tsx scripts/check-price-upload.ts "<file.xlsx>" … */
import ExcelJS from "exceljs";
import { readPriceSheet } from "../src/lib/price-upload";

async function main() {
  for (const file of process.argv.slice(2)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const { prices, broken } = readPriceSheet(wb);
    console.log(`${file}: ${prices.length} prices, e.g. ${prices.slice(3, 6).map((p) => `${p.sku}=${p.price}`).join(", ")}`);
    if (broken.length) console.log(`  skipped (not a number): ${broken.join(", ")}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
