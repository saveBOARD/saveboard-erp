/** Selling-price lookup shared by the quote/order editor and the price list screens (browser and server). */

export type PriceListData = {
  id: string;
  name: string;
  isDefault: boolean;
  adjustPct: number | null; // -0.15 = 15% below the default list
  prices: Record<string, number>; // productId -> price ex GST
};

export type PriceSuggestion = { price: number; source: string };

const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** "less 15%" / "plus 10%" */
export const adjustLabel = (pct: number) => `${pct < 0 ? "less" : "plus"} ${Math.abs(Math.round(pct * 10000) / 100)}%`;

/** A list's own price for a product, else the default list's price adjusted by the list's %, else nothing. */
export function listPrice(list: PriceListData, defaultList: PriceListData | undefined, productId: string): PriceSuggestion | null {
  const own = list.prices[productId];
  if (own !== undefined) return { price: own, source: `${list.name} price list` };
  if (!list.isDefault && list.adjustPct !== null && defaultList) {
    const base = defaultList.prices[productId];
    if (base !== undefined) return { price: r4(base * (1 + list.adjustPct)), source: `${list.name} (${defaultList.name} ${adjustLabel(list.adjustPct)})` };
  }
  return null;
}

/**
 * Price for a product on a customer's document, in order of preference:
 * the customer's price list → the default price list → last price charged to this customer → last price charged anyone.
 */
export function suggestPrice(opts: {
  productId: string;
  customerListId: string | null;
  lists: PriceListData[];
  lastForCustomer?: number | null;
  lastForAnyone?: number | null;
}): PriceSuggestion | null {
  const defaultList = opts.lists.find((l) => l.isDefault);
  const customerList = opts.customerListId ? opts.lists.find((l) => l.id === opts.customerListId) : undefined;
  const fromList = (customerList && listPrice(customerList, defaultList, opts.productId)) ?? (defaultList && listPrice(defaultList, undefined, opts.productId));
  if (fromList) return fromList;
  if (opts.lastForCustomer != null) return { price: opts.lastForCustomer, source: "last price charged to this customer" };
  if (opts.lastForAnyone != null) return { price: opts.lastForAnyone, source: "last price charged (any customer)" };
  return null;
}
