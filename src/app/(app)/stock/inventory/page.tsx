import type { Metadata } from "next";
import { DataTable, type Column } from "@/components/data-table";
import { ListHeader } from "@/components/list-header";
import { getEntityContext } from "@/lib/dal";
import { expectedByProduct } from "@/lib/purchasing/received";
import { stockPosition } from "@/lib/queries/availability";
import { productsWithStock, type ProductFilter } from "@/lib/queries/products";

export const metadata: Metadata = { title: "Inventory · saveBOARD ERP" };

const TABS: { label: string; value: ProductFilter }[] = [
  { label: "All", value: "all" },
  { label: "Products", value: "product" },
  { label: "Materials", value: "material" },
];

export default async function InventoryPage(props: PageProps<"/stock/inventory">) {
  const { entity } = await getEntityContext();
  const sp = await props.searchParams;
  const filter = (TABS.find((x) => x.value === sp.type)?.value ?? "all") as ProductFilter;
  const [products, position, expected] = await Promise.all([productsWithStock(entity.id, filter, true), stockPosition(entity.id), expectedByProduct(entity.id)]);
  const rows = products.map((p) => {
    const committed = position.committed.get(p.id) ?? 0;
    const exp = expected.get(p.id) ?? 0;
    const available = Math.round((p.inStock - committed) * 10000) / 10000 || 0;
    return { ...p, committed, expected: exp, available, potential: Math.round((available + exp) * 10000) / 10000 || 0 };
  });
  const negatives = rows.filter((r) => r.inStock < 0).length;

  const columns: Column[] = [
    { key: "name", label: "Name", width: 240, href: "/items/products/{id}" },
    { key: "sku", label: "Variant code / SKU" },
    { key: "category", label: "Category" },
    { key: "supplier", label: "Default supplier" },
    { key: "standardCost", label: "Standard cost", kind: "money" },
    { key: "value", label: "Value in stock", kind: "money", total: true },
    { key: "inStock", label: "In stock", kind: "number", unitKey: "uom", negativeAlert: true },
    { key: "expected", label: "Expected", kind: "number", unitKey: "uom" },
    { key: "committed", label: "Committed", kind: "number", unitKey: "uom" },
    { key: "available", label: "Available", kind: "number", unitKey: "uom", negativeAlert: true },
    { key: "potential", label: "Potential", kind: "number", unitKey: "uom", hidden: true },
    { key: "safetyStock", label: "Safety stock", kind: "number", unitKey: "uom" },
  ];

  return (
    <>
      <ListHeader
        tabs={TABS.map((x) => ({ label: x.label, href: x.value === "all" ? "/stock/inventory" : `/stock/inventory?type=${x.value}`, active: x.value === filter }))}
        note={negatives ? `${negatives} items have negative stock (filter In stock with <0)` : undefined}
      />
      <DataTable columns={columns} rows={rows} currency={entity.currency} exportName={`inventory-${entity.id}`} />
      <p className="mt-2 text-xs text-muted">
        In stock comes from the stock ledger: opening balances from Katana (11/9/26). Committed = open and picked sales
        orders not yet shipped. Expected = on open purchase orders, not yet received. Available = in stock − committed.
        Potential (hidden column) = available + expected.
      </p>
    </>
  );
}
