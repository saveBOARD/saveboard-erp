import type ExcelJS from "exceljs";

/** Cell text; formulas give their result; Excel errors (#REF!, #N/A…) come back as "#ERROR:<code>". */
function cellText(v: unknown): string {
  if (v && typeof v === "object" && "error" in v) return `#ERROR:${String((v as { error: unknown }).error)}`;
  if (v && typeof v === "object" && "result" in v) return cellText((v as { result: unknown }).result);
  if (v && typeof v === "object" && "richText" in v) return (v as { richText: { text: string }[] }).richText.map((r) => r.text).join("");
  return v == null ? "" : String(v).trim();
}

/**
 * Reads SKU + Price columns (found by their headings in row 1) from the first sheet of a price list workbook.
 * Blank prices are ignored; prices that aren't numbers (#REF! etc.) are reported, not fatal. Prices are rounded to
 * 4 decimals (what the database stores).
 */
export function readPriceSheet(wb: ExcelJS.Workbook) {
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("The file has no sheets.");
  let skuCol = 0;
  let priceCol = 0;
  // eachCell skips empty cells, so gaps in the heading row are harmless.
  ws.getRow(1).eachCell((cell, col) => {
    const h = cellText(cell.value).toLowerCase();
    if (!skuCol && h.includes("sku")) skuCol = col;
    if (!priceCol && h.startsWith("price")) priceCol = col;
  });
  if (!skuCol || !priceCol) throw new Error('The first row needs a "SKU" column and a "Price" column.');
  const prices: { sku: string; price: number }[] = [];
  const broken: string[] = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const sku = cellText(row.getCell(skuCol).value);
    const raw = cellText(row.getCell(priceCol).value);
    if (!sku || raw === "") return;
    const price = Number(raw.replace(/[$,\s]/g, ""));
    if (raw.startsWith("#") || !Number.isFinite(price) || price < 0) return void broken.push(`${sku} (${raw.replace("#ERROR:", "")})`);
    prices.push({ sku, price: Math.round(price * 10000) / 10000 });
  });
  return { prices, broken };
}
