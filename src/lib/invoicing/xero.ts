/**
 * Xero "Sales invoice" CSV import (Business → Invoices → Import). One sales order = one invoice, numbered
 * with the SO number, like the Excel XeroExport sheet. Amounts are ex GST: choose "Tax exclusive" when importing.
 */

export type XeroSettings = { accountCode: string; taxOnIncome: string; taxZeroRated: string };

/** Per entity: account 200 "Sales" and the default Xero tax rate names (from the workbooks' XeroExport sheets). */
export const XERO_SETTINGS: Record<string, XeroSettings> = {
  NZ: { accountCode: "200", taxOnIncome: "15% GST on Income", taxZeroRated: "Zero Rated" },
  AUS: { accountCode: "200", taxOnIncome: "GST on Income", taxZeroRated: "GST Free Income" },
};

export const DEFAULT_DUE_DAYS = 30;

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * Due date from a customer's payment terms text: "7 days", "14 days net", "20th of the following month",
 * "20th of month following", "Cash"/"COD" (due on the invoice date). Anything else: 30 days.
 */
export function dueDate(invoiceDate: string, terms: string | null | undefined) {
  const s = (terms ?? "").toLowerCase();
  if (/\b(cod|cash|on delivery|due on receipt|prepa)/.test(s)) return invoiceDate;
  const dayOfMonth = s.match(/(\d{1,2})\s*(st|nd|rd|th)?\b/);
  if (dayOfMonth && !/days?\b/.test(s) && /(following|next)\s*month|month\s*following|\beom\b|end of month/.test(s)) {
    const day = Number(dayOfMonth[1]);
    const d = new Date(`${invoiceDate}T00:00:00Z`);
    const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(Math.max(day, 1), last));
    return target.toISOString().slice(0, 10);
  }
  const days = s.match(/(\d{1,3})\s*days?/);
  return addDays(invoiceDate, days ? Number(days[1]) : DEFAULT_DUE_DAYS);
}

export type InvoiceOrder = {
  number: string;
  reference: string | null;
  currency: string;
  invoicedOn: string;
  invoiceDueOn: string;
  customer: {
    name: string;
    email: string | null;
    line1: string | null;
    line2: string | null;
    city: string | null;
    region: string | null;
    postcode: string | null;
    country: string | null;
  };
  lines: { sku: string | null; description: string; qty: number; unitPrice: number; discountPct: number; taxRate: number }[];
};

const HEADER = [
  "*ContactName",
  "EmailAddress",
  "POAddressLine1",
  "POAddressLine2",
  "POAddressLine3",
  "POAddressLine4",
  "POCity",
  "PORegion",
  "POPostalCode",
  "POCountry",
  "*InvoiceNumber",
  "Reference",
  "*InvoiceDate",
  "*DueDate",
  "InventoryItemCode",
  "*Description",
  "*Quantity",
  "*UnitAmount",
  "Discount",
  "*AccountCode",
  "*TaxType",
  "TrackingName1",
  "TrackingOption1",
  "TrackingName2",
  "TrackingOption2",
  "Currency",
];

const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const cell = (v: string | number | null | undefined) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const num = (n: number) => String(Math.round(n * 10000) / 10000);

/** CSV text (with a BOM so Excel opens it as UTF-8) for a batch of orders from one entity. */
export function xeroInvoiceCsv(entityId: string, orders: InvoiceOrder[]) {
  const x = XERO_SETTINGS[entityId];
  if (!x) throw new Error(`No Xero settings for ${entityId}`);
  const rows: string[] = [HEADER.join(",")];
  for (const o of orders) {
    const c = o.customer;
    // Xero needs a quantity on every line, so zero-quantity lines (headings, notes) are left out.
    for (const l of o.lines.filter((l) => l.qty !== 0)) {
      rows.push(
        [
          c.name,
          c.email,
          c.line1,
          c.line2,
          "",
          "",
          c.city,
          c.region,
          c.postcode,
          c.country,
          o.number,
          o.reference,
          dmy(o.invoicedOn),
          dmy(o.invoiceDueOn),
          "",
          l.sku ? `[${l.sku}] ${l.description}` : l.description,
          num(l.qty),
          num(l.unitPrice),
          l.discountPct ? num(l.discountPct * 100) : "",
          x.accountCode,
          l.taxRate > 0 ? x.taxOnIncome : x.taxZeroRated,
          "",
          "",
          "",
          "",
          o.currency,
        ]
          .map(cell)
          .join(","),
      );
    }
  }
  return "﻿" + rows.join("\r\n") + "\r\n";
}
