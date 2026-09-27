/** Order maths shared by the editor (browser) and the server, so both always agree. */

export type LineInput = {
  qty: number;
  unitPrice: number;
  discountPct: number; // 0.1 = 10%
  taxRate: number; // 0.15 = 15%
};

const r4 = (n: number) => Math.round(n * 10_000) / 10_000;
export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function lineAmounts(l: LineInput) {
  const subtotal = r4(l.qty * l.unitPrice * (1 - l.discountPct));
  const tax = r4(subtotal * l.taxRate);
  return { subtotal, tax };
}

export function orderTotals(lines: LineInput[]) {
  let subtotal = 0;
  let tax = 0;
  for (const l of lines) {
    const a = lineAmounts(l);
    subtotal += a.subtotal;
    tax += a.tax;
  }
  return { subtotal: r4(subtotal), tax: r4(tax), total: r4(subtotal + tax) };
}

const HOME_COUNTRY: Record<string, string[]> = {
  NZ: ["new zealand", "nz", "aotearoa"],
  AUS: ["australia", "au", "aus"],
};

/** Delivery outside the entity's home country = export. Blank country = domestic. */
export function isExport(entityId: string, country: string | null | undefined) {
  const c = (country ?? "").trim().toLowerCase();
  return c !== "" && !(HOME_COUNTRY[entityId] ?? []).includes(c);
}

/**
 * Default GST for a new line. saveBOARD rule: goods on export orders are zero-rated; freight and other
 * services always carry GST.
 */
export function defaultTaxRate(opts: { gstRate: number; exportOrder: boolean; isService: boolean }) {
  return opts.exportOrder && !opts.isService ? 0 : opts.gstRate;
}
