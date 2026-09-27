import { and, desc, eq, inArray } from "drizzle-orm";
import type { Metadata } from "next";
import { DataTable, type Column } from "@/components/data-table";
import { ListHeader } from "@/components/list-header";
import { db, t } from "@/db";
import { getEntityContext } from "@/lib/dal";
import { entityDay } from "@/lib/dates";
import { AVAILABILITY_LABEL, stockPosition } from "@/lib/queries/availability";
import { MO_STATUS_LABEL } from "@/lib/queries/manufacturing-order";

export const metadata: Metadata = { title: "Manufacturing orders · saveBOARD ERP" };

type MOStatus = (typeof t.moStatus.enumValues)[number];
const TABS: { label: string; value: string; statuses: MOStatus[] }[] = [
  { label: "Open", value: "open", statuses: ["not_started", "in_progress"] },
  { label: "Done", value: "done", statuses: ["done"] },
  { label: "Cancelled", value: "cancelled", statuses: ["cancelled"] },
];

export default async function MOListPage(props: PageProps<"/make/orders">) {
  const { entity } = await getEntityContext();
  const sp = await props.searchParams;
  const tab = TABS.find((x) => x.value === sp.tab) ?? TABS[0];
  const mo = t.manufacturingOrders;
  const [rows, position] = await Promise.all([
    db
      .select({
        id: mo.id,
        number: mo.number,
        status: mo.status,
        createdAt: mo.createdAt,
        completedAt: mo.completedAt,
        productionDeadline: mo.productionDeadline,
        deliveryDeadline: mo.deliveryDeadline,
        plannedQty: mo.plannedQty,
        actualQty: mo.actualQty,
        batchNo: mo.batchNo,
        materialsCost: mo.materialsCost,
        operationsCost: mo.operationsCost,
        sku: t.products.sku,
        product: t.products.name,
        uom: t.products.uom,
        soNumber: t.salesOrders.number,
        customer: t.customers.name,
      })
      .from(mo)
      .innerJoin(t.products, eq(t.products.id, mo.productId))
      .leftJoin(t.salesOrders, eq(t.salesOrders.id, mo.salesOrderId))
      .leftJoin(t.customers, eq(t.customers.id, t.salesOrders.customerId))
      .where(and(eq(mo.entityId, entity.id), inArray(mo.status, tab.statuses)))
      .orderBy(desc(mo.createdAt)),
    stockPosition(entity.id),
  ]);
  const open = tab.value === "open";
  const done = tab.value === "done";
  const day = (d: Date | null) => entityDay(d, entity.id);

  const columns: Column[] = [
    { key: "created", label: "Created", width: 100 },
    { key: "number", label: "Order #", href: "/make/orders/{id}" },
    { key: "product", label: "Product", width: 280 },
    { key: "sku", label: "SKU", hidden: true },
    { key: done ? "actualQty" : "plannedQty", label: done ? "Quantity made" : "Planned quantity", kind: "number", unitKey: "uom", total: true },
    ...(open
      ? ([
          { key: "ingredients", label: "Ingredients", tones: { "In stock": "ok", "Not available": "bad" } },
          { key: "productionDeadline", label: "Production deadline" },
          { key: "statusLabel", label: "Status", tones: { "Not started": "pending", "In progress": "info" } },
        ] as Column[])
      : []),
    ...(done
      ? ([
          { key: "completed", label: "Completed" },
          { key: "batchNo", label: "Batch" },
          { key: "unitCost", label: "Cost per unit", kind: "money" },
        ] as Column[])
      : []),
    { key: "deliveryDeadline", label: "Delivery deadline", hidden: !open },
    { key: "salesOrder", label: "Sales order" },
    { key: "cost", label: done ? "Total cost" : "Planned cost", kind: "money", total: true },
  ];

  return (
    <>
      <ListHeader
        tabs={TABS.map((x) => ({ label: x.label, href: x.value === "open" ? "/make/orders" : `/make/orders?tab=${x.value}`, active: x === tab }))}
        newLabel="Manufacturing order"
        newHref="/make/orders/new"
      />
      <DataTable
        columns={columns}
        rows={rows.map((r) => {
          const cost = Number(r.materialsCost) + Number(r.operationsCost);
          const made = Number(r.actualQty ?? 0);
          return {
            id: r.id,
            created: day(r.createdAt),
            number: r.number,
            product: r.product,
            sku: r.sku,
            uom: r.uom,
            plannedQty: Number(r.plannedQty),
            actualQty: made,
            ingredients: AVAILABILITY_LABEL[position.moAvailability.get(r.id) ?? "not_tracked"],
            productionDeadline: r.productionDeadline,
            deliveryDeadline: r.deliveryDeadline,
            statusLabel: MO_STATUS_LABEL[r.status],
            completed: day(r.completedAt),
            batchNo: r.batchNo,
            unitCost: made ? Math.round((cost / made) * 100) / 100 : null,
            salesOrder: r.soNumber ? `${r.soNumber} — ${r.customer}` : null,
            cost,
          };
        })}
        currency={entity.currency}
        exportName={`manufacturing-orders-${entity.id}`}
        noun="orders"
      />
      {open && (
        <p className="mt-2 text-xs text-muted">
          Ingredients: “In stock” when every material is covered by stock on hand after picked sales orders and earlier
          orders take theirs (earliest production deadline first).
        </p>
      )}
    </>
  );
}
