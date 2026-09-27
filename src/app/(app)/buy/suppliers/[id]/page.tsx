import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { ArrowLeft, Pencil, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DataTable, type Column } from "@/components/data-table";
import { db, t } from "@/db";
import { getEntityContext } from "@/lib/dal";
import { PO_STATUS_LABEL, RECEIVE_LABEL, receiveState, receivedByLine } from "@/lib/purchasing/received";

export const metadata: Metadata = { title: "Supplier · saveBOARD ERP" };

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-sm">{children || <span className="text-muted">—</span>}</span>
    </div>
  );
}

export default async function SupplierPage(props: PageProps<"/buy/suppliers/[id]">) {
  const { id } = await props.params;
  const { entity } = await getEntityContext();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [s] = await db.select().from(t.suppliers).where(and(eq(t.suppliers.id, id), eq(t.suppliers.entityId, entity.id)));
  if (!s) notFound();

  const [pos, items] = await Promise.all([
    db.select().from(t.purchaseOrders).where(eq(t.purchaseOrders.supplierId, id)).orderBy(desc(t.purchaseOrders.orderDate), desc(t.purchaseOrders.number)),
    db
      .select({ id: t.products.id, sku: t.products.sku, name: t.products.name, category: t.products.category, cost: t.products.standardCost, uom: t.products.uom })
      .from(t.products)
      .where(eq(t.products.defaultSupplierId, id))
      .orderBy(asc(t.products.name)),
  ]);
  const poIds = pos.map((p) => p.id);
  const [lines, received] = poIds.length
    ? await Promise.all([db.select({ id: t.poLines.id, poId: t.poLines.poId, qty: t.poLines.qty }).from(t.poLines).where(inArray(t.poLines.poId, poIds)), receivedByLine(poIds)])
    : [[], new Map<string, number>()];

  const poColumns: Column[] = [
    { key: "orderDate", label: "Created date" },
    { key: "order", label: "Order #", href: "/buy/orders/{id}", width: 220 },
    { key: "total", label: "Total order value", kind: "money", total: true },
    { key: "expectedOn", label: "Expected arrival" },
    { key: "status", label: "Status", tones: { Draft: "pending", Open: "pending", Done: "ok", Cancelled: "bad" } },
    { key: "delivery", label: "Delivery", tones: { "Not received": "pending", "Partially received": "pending", Received: "ok" } },
    { key: "billing", label: "Billing status", tones: { "Not billed": "pending", Billed: "ok" } },
  ];
  const itemColumns: Column[] = [
    { key: "sku", label: "SKU", href: "/items/products/{id}" },
    { key: "name", label: "Item", width: 280 },
    { key: "category", label: "Category" },
    { key: "cost", label: "Standard cost", kind: "money" },
  ];

  return (
    <div className="mx-auto grid max-w-6xl gap-4">
      <Link href="/buy/suppliers" className="no-print inline-flex items-center gap-1 text-sm text-link hover:underline">
        <ArrowLeft className="h-4 w-4" /> Suppliers
      </Link>
      <section className="grid gap-4 rounded border border-line bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted">Supplier</div>
            <h1 className="text-2xl font-medium">{s.name}</h1>
            {!s.active && <span className="text-sm text-bad">Inactive</span>}
          </div>
          <div className="flex gap-2">
            <Link href={`/buy/suppliers/${id}/edit`} className="btn-secondary">
              <Pencil className="h-4 w-4" /> Edit
            </Link>
            <Link href={`/buy/orders/new?supplier=${id}`} className="btn-primary">
              <Plus className="h-4 w-4" /> Purchase order
            </Link>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Item label="Contact">{s.contactName}</Item>
          <Item label="Phone">{s.phone}</Item>
          <Item label="Email">{s.email}</Item>
          <Item label="Lead time">{s.leadTimeDays !== null ? `${s.leadTimeDays} days` : null}</Item>
          <Item label="Payment terms">{s.paymentTerms}</Item>
        </div>
        {s.notes && <p className="whitespace-pre-wrap rounded bg-page px-4 py-2 text-sm">{s.notes}</p>}
      </section>

      <section className="grid gap-2">
        <h2 className="font-medium">Purchase orders</h2>
        <DataTable
          columns={poColumns}
          rows={pos.map((p) => ({
            id: p.id,
            orderDate: p.orderDate,
            order: p.title ? `${p.number} / ${p.title}` : p.number,
            total: Math.round(Number(p.total) * Number(p.fxRate) * 100) / 100,
            expectedOn: p.expectedOn,
            status: PO_STATUS_LABEL[p.status],
            delivery: p.status === "cancelled" || p.status === "draft" ? null : RECEIVE_LABEL[receiveState(lines.filter((l) => l.poId === p.id).map((l) => ({ id: l.id, qty: Number(l.qty) })), received)],
            billing: p.billed ? "Billed" : "Not billed",
          }))}
          currency={entity.currency}
          exportName={`supplier-pos-${s.name.replace(/\W+/g, "-")}`}
          noun="purchase orders"
        />
        <p className="text-xs text-muted">Purchase orders completed in Katana before the switch are in the Excel workbook history sheets.</p>
      </section>

      <section className="grid gap-2">
        <h2 className="font-medium">Items with this default supplier</h2>
        <DataTable columns={itemColumns} rows={items.map((i) => ({ ...i, cost: Number(i.cost) }))} currency={entity.currency} exportName={`supplier-items-${s.name.replace(/\W+/g, "-")}`} noun="items" />
      </section>
    </div>
  );
}
