import clsx from "clsx";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MOActions } from "@/components/mo-actions";
import { getEntityContext } from "@/lib/dal";
import { entityDay } from "@/lib/dates";
import { AVAILABILITY_LABEL, stockPosition } from "@/lib/queries/availability";
import { MO_STATUS_LABEL, getMO } from "@/lib/queries/manufacturing-order";

export const metadata: Metadata = { title: "Manufacturing order · saveBOARD ERP" };

const money = (n: number | string, c: string) => `${Number(n).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}`;
const qtyFmt = (n: number | string | null) => (n === null ? "—" : Number(n).toLocaleString("en-NZ", { maximumFractionDigits: 4 }));
const STATUS_CLASS: Record<string, string> = { not_started: "bg-pending text-ink", in_progress: "bg-[#2f6fb0] text-white", done: "bg-ok text-white", cancelled: "bg-bad text-white" };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-sm">{children || <span className="text-muted">—</span>}</span>
    </div>
  );
}

export default async function MOPage(props: PageProps<"/make/orders/[id]">) {
  const { id } = await props.params;
  const { entity } = await getEntityContext();
  const found = await getMO(entity.id, id);
  if (!found) notFound();
  const { mo, product, materials, operations, salesOrder } = found;
  const position = await stockPosition(entity.id);
  const open = mo.status === "not_started" || mo.status === "in_progress";
  const done = mo.status === "done";
  const cur = entity.currency;
  const totalCost = Number(mo.materialsCost) + Number(mo.operationsCost);
  const perUnitQty = done ? Number(mo.actualQty) : Number(mo.plannedQty);
  const hoursPlanned = operations.reduce((s, o) => s + Number(o.plannedHours), 0);
  const hoursActual = operations.reduce((s, o) => s + Number(o.actualHours ?? 0), 0);

  return (
    <div className="mx-auto grid max-w-6xl gap-4">
      <Link href="/make/orders" className="no-print inline-flex items-center gap-1 text-sm text-link hover:underline">
        <ArrowLeft className="h-4 w-4" /> Manufacturing orders
      </Link>
      <section className="grid gap-4 rounded border border-line bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted">Manufacturing order</div>
            <h1 className="text-2xl font-medium">{mo.number}</h1>
            <Link href={`/items/products/${product.id}`} className="text-link hover:underline">
              <span className="font-mono text-sm text-muted">[{product.sku}]</span> {product.name}
            </Link>
          </div>
          <div className="flex gap-2">
            {open && (
              <span className={clsx("rounded px-3 py-1.5 text-sm", position.moAvailability.get(id) === "not_available" ? "bg-bad text-white" : "bg-ok text-white")}>
                Ingredients: {AVAILABILITY_LABEL[position.moAvailability.get(id) ?? "not_tracked"]}
              </span>
            )}
            <span className={clsx("rounded px-4 py-1.5 text-sm font-medium", STATUS_CLASS[mo.status])}>{MO_STATUS_LABEL[mo.status]}</span>
          </div>
        </div>
        <MOActions id={id} status={mo.status} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Planned quantity">
            {qtyFmt(mo.plannedQty)} {product.uom}
          </Field>
          {done && (
            <Field label="Quantity made">
              {qtyFmt(mo.actualQty)} {product.uom}
            </Field>
          )}
          {done && <Field label="Batch (finished goods)">{mo.batchNo && <span className="font-mono">{mo.batchNo}</span>}</Field>}
          {done && <Field label="Completed">{entityDay(mo.completedAt, entity.id)}</Field>}
          <Field label="Production deadline">{mo.productionDeadline}</Field>
          <Field label="Delivery deadline">{mo.deliveryDeadline}</Field>
          <Field label="Sales order">
            {salesOrder && (
              <Link href={`/sell/orders/${salesOrder.id}`} className="text-link hover:underline">
                {salesOrder.number}
                {salesOrder.title && ` / ${salesOrder.title}`} — {salesOrder.customer}
              </Link>
            )}
          </Field>
          <Field label="Created">{entityDay(mo.createdAt, entity.id)}</Field>
          <Field label={done ? "Total cost" : "Planned cost"}>
            {money(totalCost, cur)}
            {perUnitQty > 0 && <span className="text-muted"> · {money(totalCost / perUnitQty, cur)} per {product.uom ?? "unit"}</span>}
          </Field>
        </div>
        {mo.notes && <p className="whitespace-pre-wrap rounded bg-page px-3 py-2 text-sm">{mo.notes}</p>}
      </section>

      <section className="overflow-x-auto rounded border border-line bg-surface">
        <div className="border-b border-line px-4 py-2 font-medium">Materials</div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted">
              <th className="border-b border-line px-3 py-2 font-normal">Item</th>
              <th className="border-b border-line px-3 py-2 text-right font-normal">Planned</th>
              {done && <th className="border-b border-line px-3 py-2 text-right font-normal">Used</th>}
              {done && <th className="border-b border-line px-3 py-2 font-normal">Batch</th>}
              {open && <th className="border-b border-line px-3 py-2 text-center font-normal">Availability</th>}
              <th className="border-b border-line px-3 py-2 text-right font-normal">Cost</th>
              <th className="border-b border-line px-3 py-2 font-normal">Note</th>
            </tr>
          </thead>
          <tbody>
            {materials.map(({ m, sku, name, uom, trackStock, standardCost }) => {
              const a = position.lineAvailability.get(m.id);
              const qty = done ? Number(m.actualQty ?? 0) : Number(m.plannedQty);
              const cost = qty * Number(done ? (m.unitCost ?? standardCost) : standardCost);
              return (
                <tr key={m.id}>
                  <td className="border-b border-line px-3 py-2">
                    <Link href={`/items/products/${m.productId}`} className="text-link hover:underline">
                      <span className="mr-1 font-mono text-xs text-muted">[{sku}]</span>
                      {name}
                    </Link>
                    {!trackStock && <span className="ml-2 text-xs text-muted">(not stock-tracked)</span>}
                  </td>
                  <td className="border-b border-line px-3 py-2 text-right tabular-nums whitespace-nowrap">
                    {qtyFmt(m.plannedQty)} {uom}
                  </td>
                  {done && (
                    <td className="border-b border-line px-3 py-2 text-right tabular-nums whitespace-nowrap">
                      {qtyFmt(m.actualQty)} {uom}
                    </td>
                  )}
                  {done && <td className="border-b border-line px-3 py-2 font-mono text-xs">{m.batchNo}</td>}
                  {open && (
                    <td className={clsx("border-b border-line px-3 py-2 text-center", a === "in_stock" && "bg-ok text-white", a === "not_available" && "bg-bad text-white")}>
                      {a ? AVAILABILITY_LABEL[a] : "—"}
                    </td>
                  )}
                  <td className="border-b border-line px-3 py-2 text-right tabular-nums whitespace-nowrap">{money(cost, cur)}</td>
                  <td className="border-b border-line px-3 py-2 text-muted">{m.note}</td>
                </tr>
              );
            })}
            {!materials.length && (
              <tr>
                <td colSpan={6} className="px-3 py-3 text-muted">No materials on this order.</td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="font-medium">
              <td colSpan={done ? 4 : open ? 3 : 2} className="px-3 py-2 text-right">Materials</td>
              <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{money(mo.materialsCost, cur)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </section>

      <section className="overflow-x-auto rounded border border-line bg-surface">
        <div className="border-b border-line px-4 py-2 font-medium">Operations</div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted">
              <th className="border-b border-line px-3 py-2 font-normal">Operation</th>
              <th className="border-b border-line px-3 py-2 text-right font-normal">Planned hours</th>
              {done && <th className="border-b border-line px-3 py-2 text-right font-normal">Actual hours</th>}
              <th className="border-b border-line px-3 py-2 text-right font-normal">Cost per hour</th>
              <th className="border-b border-line px-3 py-2 text-right font-normal">Cost</th>
            </tr>
          </thead>
          <tbody>
            {operations.map((o) => (
              <tr key={o.id}>
                <td className="border-b border-line px-3 py-2">{o.name}</td>
                <td className="border-b border-line px-3 py-2 text-right tabular-nums">{qtyFmt(o.plannedHours)}</td>
                {done && <td className="border-b border-line px-3 py-2 text-right tabular-nums">{qtyFmt(o.actualHours)}</td>}
                <td className="border-b border-line px-3 py-2 text-right tabular-nums whitespace-nowrap">{money(o.costPerHour, cur)}</td>
                <td className="border-b border-line px-3 py-2 text-right tabular-nums whitespace-nowrap">
                  {money(Number(done ? (o.actualHours ?? 0) : o.plannedHours) * Number(o.costPerHour), cur)}
                </td>
              </tr>
            ))}
            {!operations.length && (
              <tr>
                <td colSpan={5} className="px-3 py-3 text-muted">No operations on this order.</td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="font-medium">
              <td className="px-3 py-2 text-right">Total</td>
              <td className="px-3 py-2 text-right tabular-nums">{qtyFmt(hoursPlanned)} h</td>
              {done && <td className="px-3 py-2 text-right tabular-nums">{qtyFmt(hoursActual)} h</td>}
              <td />
              <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{money(mo.operationsCost, cur)}</td>
            </tr>
          </tfoot>
        </table>
      </section>
    </div>
  );
}
