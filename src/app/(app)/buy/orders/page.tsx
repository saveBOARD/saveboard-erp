import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Metadata } from "next";
import { DataTable, type Column } from "@/components/data-table";
import { ListHeader } from "@/components/list-header";
import { db, t } from "@/db";
import { getEntityContext } from "@/lib/dal";
import { RECEIVE_LABEL, receiveState, receivedByLine } from "@/lib/purchasing/received";

export const metadata: Metadata = { title: "Purchase orders · saveBOARD ERP" };

type POStatus = (typeof t.poStatus.enumValues)[number];
const TABS: { label: string; value: string; statuses: POStatus[] }[] = [
  { label: "Open", value: "open", statuses: ["open"] },
  { label: "Draft", value: "draft", statuses: ["draft"] },
  { label: "Done", value: "done", statuses: ["received"] },
  { label: "Cancelled", value: "cancelled", statuses: ["cancelled"] },
];

export default async function PurchaseOrdersPage(props: PageProps<"/buy/orders">) {
  const { entity } = await getEntityContext();
  const sp = await props.searchParams;
  const tab = TABS.find((x) => x.value === sp.tab) ?? TABS[0];
  const p = t.purchaseOrders;
  const rows = await db
    .select({
      id: p.id,
      number: p.number,
      title: p.title,
      orderDate: p.orderDate,
      supplier: t.suppliers.name,
      total: p.total,
      fxRate: p.fxRate,
      currency: p.currency,
      expectedOn: p.expectedOn,
      overdue: sql<boolean>`${p.expectedOn} < current_date`,
      billed: p.billed,
      lastReceived: sql<string | null>`(select max(r.received_on)::text from goods_receipts r where r.po_id = ${p.id} and r.reversed_at is null)`,
    })
    .from(p)
    .innerJoin(t.suppliers, eq(t.suppliers.id, p.supplierId))
    .where(and(eq(p.entityId, entity.id), inArray(p.status, tab.statuses)))
    .orderBy(desc(p.orderDate), desc(p.number));

  const ids = rows.map((r) => r.id);
  const [lines, received] = ids.length
    ? await Promise.all([db.select({ id: t.poLines.id, poId: t.poLines.poId, qty: t.poLines.qty }).from(t.poLines).where(inArray(t.poLines.poId, ids)), receivedByLine(ids)])
    : [[], new Map<string, number>()];

  const columns: Column[] = [
    { key: "orderDate", label: "Created date", width: 110 },
    { key: "order", label: "Order #", href: "/buy/orders/{id}", width: 260 },
    { key: "supplier", label: "Supplier", width: 220 },
    { key: "total", label: "Total order value", kind: "money", total: true },
    { key: "orderTotal", label: "Order currency total", kind: "money", currencyKey: "currency", hidden: true },
    tab.value === "done" ? { key: "lastReceived", label: "Received date" } : { key: "expectedOn", label: "Expected arrival" },
    ...(tab.value === "open" ? [{ key: "delivery", label: "Delivery", tones: { "Not received": "pending", "Partially received": "pending", Received: "ok" } } as Column] : []),
    { key: "billing", label: "Billing status", tones: { "Not billed": "pending", Billed: "ok" } },
    { key: "overdueLabel", label: "Overdue", hidden: true },
  ];

  return (
    <>
      <ListHeader
        tabs={TABS.map((x) => ({ label: x.label, href: x.value === "open" ? "/buy/orders" : `/buy/orders?tab=${x.value}`, active: x === tab }))}
        newLabel="Purchase order"
        newHref="/buy/orders/new"
      />
      <DataTable
        columns={columns}
        rows={rows.map((r) => ({
          id: r.id,
          orderDate: r.orderDate,
          order: r.title ? `${r.number} / ${r.title}` : r.number,
          supplier: r.supplier,
          total: Math.round(Number(r.total) * Number(r.fxRate) * 100) / 100,
          orderTotal: Number(r.total),
          currency: r.currency,
          expectedOn: r.expectedOn,
          lastReceived: r.lastReceived,
          delivery: RECEIVE_LABEL[receiveState(lines.filter((l) => l.poId === r.id).map((l) => ({ id: l.id, qty: Number(l.qty) })), received)],
          billing: r.billed ? "Billed" : "Not billed",
          overdueLabel: r.overdue && tab.value === "open" ? "Overdue" : null,
        }))}
        currency={entity.currency}
        exportName={`purchase-orders-${entity.id}`}
        noun="orders"
      />
    </>
  );
}
