import { and, desc, eq, ilike, isNotNull } from "drizzle-orm";
import { Search } from "lucide-react";
import type { Metadata } from "next";
import { DataTable, type Column } from "@/components/data-table";
import { db, t } from "@/db";
import { getEntityContext } from "@/lib/dal";

export const metadata: Metadata = { title: "Batch trace · saveBOARD ERP" };

/** Where did batch X go? Every shipment line carrying a batch number (search is "contains", any case). */
export default async function BatchTracePage(props: PageProps<"/stock/batches">) {
  const { entity } = await getEntityContext();
  const sp = await props.searchParams;
  const q = typeof sp.batch === "string" ? sp.batch.trim() : "";

  const rows = await db
    .select({
      id: t.shipmentLines.id,
      batchNo: t.shipmentLines.batchNo,
      qty: t.shipmentLines.qty,
      shippedOn: t.shipments.shippedOn,
      seq: t.shipments.seq,
      reversedAt: t.shipments.reversedAt,
      orderId: t.salesOrders.id,
      orderNumber: t.salesOrders.number,
      customer: t.customers.name,
      sku: t.orderLines.sku,
      description: t.orderLines.description,
      uom: t.products.uom,
      consignmentNo: t.shipments.consignmentNo,
    })
    .from(t.shipmentLines)
    .innerJoin(t.shipments, eq(t.shipments.id, t.shipmentLines.shipmentId))
    .innerJoin(t.salesOrders, eq(t.salesOrders.id, t.shipments.orderId))
    .innerJoin(t.customers, eq(t.customers.id, t.salesOrders.customerId))
    .innerJoin(t.orderLines, eq(t.orderLines.id, t.shipmentLines.orderLineId))
    .leftJoin(t.products, eq(t.products.id, t.orderLines.productId))
    .where(and(eq(t.shipments.entityId, entity.id), isNotNull(t.shipmentLines.batchNo), q ? ilike(t.shipmentLines.batchNo, `%${q}%`) : undefined))
    .orderBy(desc(t.shipments.shippedOn))
    .limit(2000);

  const columns: Column[] = [
    { key: "batchNo", label: "Batch no.", width: 140 },
    { key: "shippedOn", label: "Shipped" },
    { key: "shipment", label: "Shipment", href: "/sell/orders/{orderId}" },
    { key: "customer", label: "Customer", width: 200 },
    { key: "item", label: "Item", width: 260 },
    { key: "qty", label: "Qty", kind: "number", unitKey: "uom", total: true },
    { key: "consignmentNo", label: "Consignment" },
    { key: "state", label: "State", tones: { Reversed: "bad" } },
  ];

  return (
    <div className="grid gap-3">
      <form className="no-print flex flex-wrap items-center gap-2 rounded border border-line bg-surface p-4">
        <label htmlFor="batch" className="text-sm font-medium">
          Trace a batch
        </label>
        <input id="batch" name="batch" defaultValue={q} placeholder="Batch number (or part of it)" className="input w-72 font-mono" />
        <button className="btn-primary">
          <Search className="h-4 w-4" /> Find
        </button>
        <span className="text-sm text-muted">{q ? `Showing shipments of batches containing "${q}".` : "Showing every shipment that recorded a batch number."}</span>
      </form>
      <DataTable
        columns={columns}
        rows={rows.map((r) => ({
          id: r.id,
          batchNo: r.batchNo,
          shippedOn: r.shippedOn,
          shipment: `${r.orderNumber}/${r.seq}`,
          orderId: r.orderId,
          customer: r.customer,
          item: [r.sku, r.description].filter(Boolean).join(" — "),
          qty: Number(r.qty),
          uom: r.uom,
          consignmentNo: r.consignmentNo,
          state: r.reversedAt ? "Reversed" : "Shipped",
        }))}
        exportName={`batch-trace-${entity.id}${q ? `-${q.replace(/\W+/g, "")}` : ""}`}
        noun="shipment lines"
      />
    </div>
  );
}
