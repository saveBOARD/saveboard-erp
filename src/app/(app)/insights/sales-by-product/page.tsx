import type { Metadata } from "next";
import { DataTable, type Column } from "@/components/data-table";
import { PeriodPicker } from "@/components/period-picker";
import { getEntityContext } from "@/lib/dal";
import { resolvePeriod } from "@/lib/periods";
import { salesByProduct } from "@/lib/queries/sales";
import { entityToday } from "@/lib/queries/stock-items";

export const metadata: Metadata = { title: "Sales by product · saveBOARD ERP" };

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

export default async function SalesByProductPage(props: PageProps<"/insights/sales-by-product">) {
  const { entity } = await getEntityContext();
  const sp = await props.searchParams;
  const period = resolvePeriod(entity.id, entityToday(entity.id), str(sp.period), str(sp.from), str(sp.to));
  const rows = await salesByProduct(entity.id, entity.currency, period);
  const total = rows.reduce((s, r) => s + r.amount, 0);

  const columns: Column[] = [
    { key: "item", label: "Product", hrefKey: "href", width: 300 },
    { key: "sku", label: "SKU" },
    { key: "category", label: "Category" },
    { key: "qty", label: "Quantity sold", kind: "number" },
    { key: "amount", label: "Sales ex GST", kind: "money", total: true },
    { key: "share", label: "Share %", kind: "number" },
    { key: "avgPrice", label: "Average price", kind: "money" },
    { key: "customers", label: "Customers", kind: "number" },
    { key: "margin", label: "Margin % (est.)", kind: "number", hidden: true },
  ];
  return (
    <div className="grid gap-3">
      <PeriodPicker basePath="/insights/sales-by-product" period={period} />
      <DataTable
        columns={columns}
        rows={rows.map((r) => ({
          id: r.productId ?? `${r.sku}|${r.item}`,
          href: r.productId ? `/items/products/${r.productId}` : null,
          item: r.item,
          sku: r.sku,
          category: r.category,
          qty: Math.round(r.qty * 10000) / 10000,
          amount: Math.round(r.amount * 100) / 100,
          share: total ? Math.round((r.amount / total) * 1000) / 10 : null,
          avgPrice: r.qty ? Math.round((r.amount / r.qty) * 100) / 100 : null,
          customers: r.customers,
          margin: r.cost !== null && r.amount > 0 ? Math.round(((r.amount - r.cost) / r.amount) * 1000) / 10 : null,
        }))}
        currency={entity.currency}
        exportName={`sales-by-product-${entity.id}-${period.from}-${period.to}`}
        noun="products"
      />
      <p className="text-xs text-muted">
        Sales = goods shipped or invoiced ({period.label.toLowerCase()}), ex GST, in {entity.currency}, less credited returns; includes Katana history (older lines whose SKU
        is no longer in the product list show without a link). Margin % (hidden column) is an estimate using today&apos;s standard costs.
      </p>
    </div>
  );
}
