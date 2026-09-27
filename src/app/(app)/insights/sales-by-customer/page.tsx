import type { Metadata } from "next";
import { DataTable, type Column } from "@/components/data-table";
import { PeriodPicker } from "@/components/period-picker";
import { getEntityContext } from "@/lib/dal";
import { resolvePeriod } from "@/lib/periods";
import { salesByCustomer } from "@/lib/queries/sales";
import { entityToday } from "@/lib/queries/stock-items";

export const metadata: Metadata = { title: "Sales by customer · saveBOARD ERP" };

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

export default async function SalesByCustomerPage(props: PageProps<"/insights/sales-by-customer">) {
  const { entity } = await getEntityContext();
  const sp = await props.searchParams;
  const period = resolvePeriod(entity.id, entityToday(entity.id), str(sp.period), str(sp.from), str(sp.to));
  const rows = await salesByCustomer(entity.id, entity.currency, period);
  const total = rows.reduce((s, r) => s + r.amount, 0);

  const columns: Column[] = [
    { key: "customer", label: "Customer", hrefKey: "href", width: 280 },
    { key: "orders", label: "Orders", kind: "number", total: true },
    { key: "amount", label: "Sales ex GST", kind: "money", total: true },
    { key: "share", label: "Share %", kind: "number" },
    { key: "average", label: "Average order", kind: "money" },
    { key: "margin", label: "Margin % (est.)", kind: "number", hidden: true },
    { key: "lastSale", label: "Last sale" },
  ];
  return (
    <div className="grid gap-3">
      <PeriodPicker basePath="/insights/sales-by-customer" period={period} />
      <DataTable
        columns={columns}
        rows={rows.map((r) => ({
          id: r.customerId ?? r.customer,
          href: r.customerId ? `/sell/customers/${r.customerId}` : null,
          customer: r.customer,
          orders: r.orders,
          amount: Math.round(r.amount * 100) / 100,
          share: total ? Math.round((r.amount / total) * 1000) / 10 : null,
          average: r.orders ? Math.round((r.amount / r.orders) * 100) / 100 : null,
          margin: r.cost !== null && r.amount > 0 ? Math.round(((r.amount - r.cost) / r.amount) * 1000) / 10 : null,
          lastSale: r.lastSale,
        }))}
        currency={entity.currency}
        exportName={`sales-by-customer-${entity.id}-${period.from}-${period.to}`}
        noun="customers"
      />
      <p className="text-xs text-muted">
        Sales = goods shipped or invoiced ({period.label.toLowerCase()}), ex GST, in {entity.currency}, less credited returns; includes Katana history. Margin % (hidden
        column) is an estimate using today&apos;s standard costs.
      </p>
    </div>
  );
}
