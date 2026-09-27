/** Top navigation, mirroring Katana. `phase` marks screens not built yet (shows a "coming" page). */
export type SubTab = { label: string; href: string; phase?: string };
export type Section = { key: string; label: string; href: string; tabs: SubTab[] };

export const SECTIONS: Section[] = [
  {
    key: "sell",
    label: "Sell",
    href: "/sell/orders",
    tabs: [
      { label: "Quotes", href: "/sell/quotes" },
      { label: "Sales orders", href: "/sell/orders" },
      { label: "Returns", href: "/sell/returns", phase: "2" },
      { label: "Price lists", href: "/sell/price-lists", phase: "2" },
      { label: "Customers", href: "/sell/customers" },
    ],
  },
  {
    key: "make",
    label: "Make",
    href: "/make/orders",
    tabs: [
      { label: "Manufacturing orders", href: "/make/orders", phase: "4" },
      { label: "Schedule", href: "/make/schedule", phase: "4" },
    ],
  },
  {
    key: "buy",
    label: "Buy",
    href: "/buy/orders",
    tabs: [
      { label: "Purchase orders", href: "/buy/orders", phase: "4" },
      { label: "Suppliers", href: "/buy/suppliers" },
    ],
  },
  {
    key: "stock",
    label: "Stock",
    href: "/stock/inventory",
    tabs: [
      { label: "Inventory", href: "/stock/inventory" },
      { label: "Stock adjustments", href: "/stock/adjustments", phase: "3" },
      { label: "Stocktakes", href: "/stock/stocktakes", phase: "3" },
      { label: "Batch trace", href: "/stock/batches" },
    ],
  },
  {
    key: "items",
    label: "Items",
    href: "/items/products",
    tabs: [
      { label: "Products & materials", href: "/items/products" },
      { label: "Recipes", href: "/items/recipes", phase: "4" },
    ],
  },
  {
    key: "insights",
    label: "Insights",
    href: "/insights/dashboard",
    tabs: [{ label: "Dashboard", href: "/insights/dashboard", phase: "6" }],
  },
];

export const PHASE_NAMES: Record<string, string> = {
  "2": "Phase 2 · Quote to cash",
  "3": "Phase 3 · Inventory",
  "4": "Phase 4 · Make & buy",
  "6": "Phase 6 · Insights",
};
