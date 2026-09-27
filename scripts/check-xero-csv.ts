/** Self-check for the Xero invoice CSV and due-date rules: npx tsx scripts/check-xero-csv.ts */
import assert from "node:assert/strict";
import { dueDate, xeroInvoiceCsv } from "../src/lib/invoicing/xero";

assert.equal(dueDate("2026-10-05", null), "2026-11-04");
assert.equal(dueDate("2026-10-05", "7 days"), "2026-10-12");
assert.equal(dueDate("2026-10-05", "20th of the following month"), "2026-11-20");
assert.equal(dueDate("2026-12-15", "20th month following"), "2027-01-20");
assert.equal(dueDate("2026-01-10", "31st of following month"), "2026-02-28");
assert.equal(dueDate("2026-10-05", "COD"), "2026-10-05");

const csv = xeroInvoiceCsv("NZ", [
  {
    number: "SO-1590",
    reference: 'PO "44", site B',
    currency: "NZD",
    invoicedOn: "2026-10-05",
    invoiceDueOn: "2026-11-04",
    customer: { name: "Whangārei Builders", email: null, line1: "1 Main St", line2: null, city: "Whangārei", region: null, postcode: "0110", country: "New Zealand" },
    lines: [
      { sku: "SB1012002400", description: "saveBOARD 10mm", qty: 20, unitPrice: 55.5, discountPct: 0.15, taxRate: 0.15 },
      { sku: null, description: "Note only", qty: 0, unitPrice: 0, discountPct: 0, taxRate: 0.15 },
      { sku: null, description: "Freight", qty: 1, unitPrice: 120, discountPct: 0, taxRate: 0 },
    ],
  },
]);
const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
assert.equal(lines.length, 3, "header + 2 lines (zero-qty note dropped)");
assert.ok(lines[1].includes('"PO ""44"", site B"'));
assert.ok(lines[1].includes("05/10/2026,04/11/2026"));
assert.ok(lines[1].includes(",20,55.5,15,200,15% GST on Income,"));
assert.ok(lines[2].includes(",1,120,,200,Zero Rated,"));
assert.ok(lines[1].startsWith("Whangārei Builders,"));
console.log(lines.join("\n"));
console.log("Xero CSV checks passed.");
