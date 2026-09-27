import { and, desc, eq } from "drizzle-orm";
import { ArrowLeft, Pencil } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DataTable, type Column } from "@/components/data-table";
import { ORDER_STATUS } from "@/components/order-view";
import { db, t } from "@/db";
import { getEntityContext } from "@/lib/dal";
import { stockPosition } from "@/lib/queries/availability";

export const metadata: Metadata = { title: "Item · saveBOARD ERP" };

const KIND_LABEL: Record<string, string> = {
  opening: "Opening balance",
  receipt: "Goods received",
  production_output: "Produced",
  production_consume: "Used in production",
  shipment: "Shipped",
  adjustment: "Stock adjustment",
  return: "Customer return",
};

function Stat({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className={`rounded border px-4 py-3 ${alert ? "border-bad bg-bad-soft" : "border-line bg-surface"}`}>
      <div className="text-xs text-muted">{label}</div>
      <div className={`text-lg font-medium tabular-nums ${alert ? "text-bad" : ""}`}>{value}</div>
    </div>
  );
}

export default async function ProductPage(props: PageProps<"/items/products/[id]">) {
  const { id } = await props.params;
  const { entity } = await getEntityContext();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [row] = await db
    .select({ p: t.products, supplier: t.suppliers.name })
    .from(t.products)
    .leftJoin(t.suppliers, eq(t.suppliers.id, t.products.defaultSupplierId))
    .where(and(eq(t.products.id, id), eq(t.products.entityId, entity.id)));
  if (!row) notFound();
  const { p } = row;

  const [movements, sales, position] = await Promise.all([
    db
      .select({ m: t.stockMovements, by: t.users.displayName })
      .from(t.stockMovements)
      .leftJoin(t.users, eq(t.users.id, t.stockMovements.createdBy))
      .where(eq(t.stockMovements.productId, id))
      .orderBy(desc(t.stockMovements.occurredAt), desc(t.stockMovements.id)),
    db
      .select({ l: t.orderLines, o: t.salesOrders, customer: t.customers.name })
      .from(t.orderLines)
      .innerJoin(t.salesOrders, eq(t.salesOrders.id, t.orderLines.orderId))
      .innerJoin(t.customers, eq(t.customers.id, t.salesOrders.customerId))
      .where(eq(t.orderLines.productId, id))
      .orderBy(desc(t.salesOrders.orderDate), desc(t.salesOrders.number)),
    stockPosition(entity.id),
  ]);

  const unit = p.uom ?? "";
  const fmt = (n: number) => `${n.toLocaleString("en-NZ", { maximumFractionDigits: 4 })} ${unit}`.trim();
  const onHand = position.onHand.get(id) ?? 0;
  const committed = position.committed.get(id) ?? 0;
  const available = onHand - committed;
  const cost = Number(p.standardCost);

  const movementColumns: Column[] = [
    { key: "date", label: "Date", width: 150 },
    { key: "kind", label: "Movement" },
    { key: "qty", label: "Quantity", kind: "number", unitKey: "uom", negativeAlert: false, total: true },
    { key: "ref", label: "Reference", hrefKey: "href" },
    { key: "by", label: "By" },
    { key: "note", label: "Note", width: 280 },
  ];
  const salesColumns: Column[] = [
    { key: "orderDate", label: "Date", width: 100 },
    { key: "order", label: "Order #", hrefKey: "href", width: 200 },
    { key: "customer", label: "Customer", width: 200 },
    { key: "status", label: "Status" },
    { key: "qty", label: "Qty", kind: "number", unitKey: "uom", total: true },
    { key: "unitPrice", label: "Price per unit", kind: "money", currencyKey: "currency" },
    { key: "discount", label: "Discount %", kind: "number" },
    { key: "subtotal", label: "Total ex GST", kind: "money", currencyKey: "currency" },
  ];

  return (
    <div className="mx-auto grid max-w-6xl gap-4">
      <Link href="/items/products" className="no-print inline-flex items-center gap-1 text-sm text-link hover:underline">
        <ArrowLeft className="h-4 w-4" /> Products & materials
      </Link>
      <section className="grid gap-4 rounded border border-line bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="font-mono text-sm text-muted">{p.sku}</div>
            <h1 className="text-2xl font-medium">{p.name}</h1>
            <div className="text-sm text-muted">
              {[p.type === "product" ? "Product" : p.type === "material" ? "Material" : "Service", p.category, row.supplier && `Supplier: ${row.supplier}`]
                .filter(Boolean)
                .join(" · ")}
              {!p.active && <span className="ml-2 text-bad">Inactive</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {p.type === "product" && (
              <>
                <Link href={`/items/products/${id}/recipe`} className="btn-secondary">
                  Recipe
                </Link>
                <Link href={`/make/orders/new?product=${id}`} className="btn-secondary">
                  Make
                </Link>
              </>
            )}
            <Link href={`/items/products/${id}/edit`} className="btn-secondary">
              <Pencil className="h-4 w-4" /> Edit
            </Link>
          </div>
        </div>
        {p.trackStock ? (
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="In stock" value={fmt(onHand)} alert={onHand < 0} />
            <Stat label="Committed to orders" value={fmt(committed)} />
            <Stat label="Available" value={fmt(available)} alert={available < 0} />
            <Stat label="Safety stock" value={fmt(Number(p.safetyStock))} alert={Number(p.safetyStock) > 0 && available <= Number(p.safetyStock)} />
            <Stat label={`Standard cost${p.costSetManually ? " (set in app)" : ""}`} value={`${cost.toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} ${entity.currency}`} />
            <Stat label="Value in stock" value={`${(onHand * cost).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${entity.currency}`} />
          </div>
        ) : (
          <p className="text-sm text-muted">Stock isn&apos;t tracked for this item (e.g. freight or a fee), so orders never reserve or ship it from stock.</p>
        )}
      </section>

      {p.trackStock && (
        <section className="grid gap-2">
          <h2 className="font-medium">Stock movements</h2>
          <DataTable
            columns={movementColumns}
            rows={movements.map(({ m, by }) => ({
              id: m.id,
              date: m.occurredAt.toLocaleString("en-NZ", { timeZone: entity.id === "AUS" ? "Australia/Sydney" : "Pacific/Auckland", dateStyle: "medium", timeStyle: "short" }),
              kind: KIND_LABEL[m.kind] ?? m.kind,
              qty: Number(m.qty),
              uom: unit,
              ref: m.refNumber,
              href:
                m.refType === "sales_order" && m.refId
                  ? `/sell/orders/${m.refId}`
                  : m.refType === "stock_adjustment" && m.refId
                    ? `/stock/adjustments/${m.refId}`
                    : m.refType === "purchase_order" && m.refId
                      ? `/buy/orders/${m.refId}`
                      : m.refType === "manufacturing_order" && m.refId
                        ? `/make/orders/${m.refId}`
                        : null,
              by,
              note: m.note,
            }))}
            exportName={`stock-movements-${p.sku}`}
            noun="movements"
          />
        </section>
      )}

      <section className="grid gap-2">
        <h2 className="font-medium">Sales history (quotes and orders)</h2>
        <DataTable
          columns={salesColumns}
          rows={sales.map(({ l, o, customer }) => ({
            id: l.id,
            orderDate: o.orderDate,
            order: o.title ? `${o.number} / ${o.title}` : o.number,
            href: `/sell/${o.status === "quote" ? "quotes" : "orders"}/${o.id}`,
            customer,
            status: o.status === "quote" ? `Quote · ${ORDER_STATUS[o.quoteStatus ?? "draft"].label}` : ORDER_STATUS[o.status].label,
            qty: Number(l.qty),
            uom: unit,
            unitPrice: Number(l.unitPrice),
            discount: Number(l.discountPct) * 100,
            subtotal: Number(l.lineSubtotal),
            currency: o.currency,
          }))}
          currency={entity.currency}
          exportName={`sales-history-${p.sku}`}
          noun="lines"
        />
        <p className="text-xs text-muted">Completed Katana orders before the switch are in the Excel workbook history sheets.</p>
      </section>
    </div>
  );
}
