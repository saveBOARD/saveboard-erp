import type { Metadata } from "next";
import { DataTable, type Column } from "@/components/data-table";
import { ListHeader } from "@/components/list-header";
import { getEntityContext } from "@/lib/dal";
import { productsWithStock, type ProductFilter } from "@/lib/queries/products";

export const metadata: Metadata = { title: "Products & materials · saveBOARD ERP" };

const TABS: { label: string; value: ProductFilter }[] = [
  { label: "All", value: "all" },
  { label: "Products", value: "product" },
  { label: "Materials", value: "material" },
  { label: "Services", value: "service" },
];

export default async function ProductsPage(props: PageProps<"/items/products">) {
  const { entity } = await getEntityContext();
  const sp = await props.searchParams;
  const filter = (TABS.find((x) => x.value === sp.type)?.value ?? "all") as ProductFilter;
  const rows = await productsWithStock(entity.id, filter);

  const columns: Column[] = [
    { key: "name", label: "Name", width: 240 },
    { key: "sku", label: "Variant code / SKU" },
    { key: "typeLabel", label: "Type" },
    { key: "category", label: "Category" },
    { key: "uom", label: "UoM" },
    { key: "standardCost", label: "Standard cost", kind: "money" },
    { key: "supplier", label: "Default supplier" },
    { key: "trackStock", label: "Track stock", kind: "bool" },
    { key: "safetyStock", label: "Safety stock", kind: "number", unitKey: "uom" },
  ];

  return (
    <>
      <ListHeader
        tabs={TABS.map((x) => ({ label: x.label, href: x.value === "all" ? "/items/products" : `/items/products?type=${x.value}`, active: x.value === filter }))}
        newLabel="Item"
      />
      <DataTable columns={columns} rows={rows} currency={entity.currency} exportName={`items-${entity.id}`} />
    </>
  );
}
