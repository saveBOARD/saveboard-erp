/** Self-check for the price lookup order: npx tsx scripts/check-pricing.ts */
import assert from "node:assert/strict";
import { suggestPrice, type PriceListData } from "../src/lib/pricing";

const standard: PriceListData = { id: "std", name: "Standard", isDefault: true, adjustPct: null, prices: { A: 100, B: 50 } };
const wholesale: PriceListData = { id: "wh", name: "Wholesale", isDefault: false, adjustPct: -0.15, prices: { B: 40 } };
const installer: PriceListData = { id: "in", name: "Installer", isDefault: false, adjustPct: null, prices: { A: 90 } };
const lists = [standard, wholesale, installer];

const s = (productId: string, customerListId: string | null, lastForCustomer?: number, lastForAnyone?: number) =>
  suggestPrice({ productId, customerListId, lists, lastForCustomer, lastForAnyone });

assert.deepEqual(s("A", null), { price: 100, source: "Standard price list" }); // no list -> default
assert.deepEqual(s("B", "wh"), { price: 40, source: "Wholesale price list" }); // own override wins
assert.deepEqual(s("A", "wh"), { price: 85, source: "Wholesale (Standard less 15%)" }); // default less 15%
assert.deepEqual(s("A", "in"), { price: 90, source: "Installer price list" });
assert.deepEqual(s("B", "in"), { price: 50, source: "Standard price list" }); // own-price list falls back to default
assert.deepEqual(s("C", "wh", 12, 10), { price: 12, source: "last price charged to this customer" });
assert.deepEqual(s("C", null, undefined, 10), { price: 10, source: "last price charged (any customer)" });
assert.equal(s("C", null), null);
console.log("Pricing checks passed.");
