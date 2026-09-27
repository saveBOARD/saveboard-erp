import type { Metadata } from "next";
import { DataTable, type Column } from "@/components/data-table";
import { PeriodPicker } from "@/components/period-picker";
import { getEntityContext } from "@/lib/dal";
import { resolvePeriod } from "@/lib/periods";
import { salesLineRows } from "@/lib/queries/sales";
import { entityToday } from "@/lib/queries/stock-items";

export const metadata: Metadata = { title: "Sales lines · saveBOARD ERP" };

const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const SOURCE: Record<string, string> = { katana: "Katana", app: "App", return: "Return" };

/** Every sale line in the period: filter any column, or export to Excel for pivot tables. */
export default async function SalesLinesPage(props: PageProps<"/insights/sales-lines">) {
  const { entity } = await getEntityContext();
  const sp = await props.searchParams;
  const period = resolvePeriod(entity.id, entityToday(entity.id), str(sp.period) ?? "this_month", str(sp.from), str(sp.to));
  const lines = await salesLineRows(entity.id, entity.currency, period);

  const columns: Column[] = [
    { key: "date", label: "Date", width: 100 },
    { key: "doc", label: "Order / return", hrefKey: "href" },
    { key: "customer", label: "Customer", width: 220 },
    { key: "sku", label: "SKU" },
    { key: "item", label: "Item", width: 260 },
    { key: "category", label: "Category" },
    { key: "qty", label: "Quantity", kind: "number" },
    { key: "amount", label: "Sales ex GST", kind: "money", total: true },
    { key: "source", label: "Source", tones: { Return: "bad" } },
  ];
  return (
    <div className="grid gap-3">
      <PeriodPicker basePath="/insights/sales-lines" period={period} />
      <DataTable
        columns={columns}
        rows={lines.map((l, i) => ({
          id: `${i}`,
          date: l.sale_date,
          doc: l.title && l.source !== "return" ? `${l.doc} / ${l.title}` : l.source === "return" ? `${l.doc} (on ${l.title})` : l.doc,
          href: l.order_id ? `/sell/orders/${l.order_id}` : null,
          customer: l.customer,
          sku: l.sku,
          item: l.item,
          category: l.category,
          qty: l.qty,
          amount: Math.round(l.amount * 100) / 100,
          source: SOURCE[l.source] ?? l.source,
        }))}
        currency={entity.currency}
        exportName={`sales-lines-${entity.id}-${period.from}-${period.to}`}
        noun="lines"
      />
      <p className="text-xs text-muted">
        {lines.length >= 20000 ? "Showing the latest 20,000 lines; pick a shorter period for the rest. " : ""}Katana = shipped in Katana (history); App = shipped or
        invoiced in this app; Return = credited or received returns (negative). Ex GST, in {entity.currency}.
      </p>
    </div>
  );
}
