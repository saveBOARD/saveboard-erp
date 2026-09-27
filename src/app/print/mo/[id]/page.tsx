import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrintShell } from "@/components/print/sales-document";
import { db, t } from "@/db";
import { getEntityContext } from "@/lib/dal";
import { getMO } from "@/lib/queries/manufacturing-order";

export const metadata: Metadata = { title: "Work order · saveBOARD ERP" };

function Blank() {
  return <div className="h-6 border-b border-[#9aa5b1]" />;
}
const q = (n: number | string | null) => (n === null ? "" : Number(n).toLocaleString("en-NZ", { maximumFractionDigits: 4 }));

/** Printable work order for the factory floor. Never shows costs (business rule). */
export default async function PrintWorkOrder(props: PageProps<"/print/mo/[id]">) {
  const { id } = await props.params;
  const { entity } = await getEntityContext();
  const found = await getMO(entity.id, id);
  if (!found) notFound();
  const { mo, product, materials, operations, salesOrder } = found;
  const [e] = await db.select().from(t.entities).where(eq(t.entities.id, entity.id));

  return (
    <PrintShell title={`Work order ${mo.number}`}>
      <article className="sales-doc mx-auto bg-white p-[14mm] text-[12px] text-[#1d2733] shadow print:p-0 print:shadow-none">
        <header className="mb-4 flex items-start justify-between border-b-2 border-[#0d2233] pb-3">
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="saveBOARD" className="mb-1 h-[12mm] w-auto" />
            <div className="font-medium">{e.legalName}</div>
            <div className="text-[#5f6b77]">{e.locationName}</div>
          </div>
          <div className="text-right">
            <div className="text-[18px] font-bold uppercase">Work order</div>
            <div className="text-[16px] font-medium">{mo.number}</div>
            {mo.productionDeadline && <div>Production deadline: {mo.productionDeadline}</div>}
            {mo.deliveryDeadline && <div>Delivery deadline: {mo.deliveryDeadline}</div>}
            {salesOrder && (
              <div className="text-[#5f6b77]">
                For {salesOrder.number} — {salesOrder.customer}
              </div>
            )}
          </div>
        </header>

        <section className="mb-4 grid grid-cols-[1fr_auto] gap-4 rounded border border-[#d9dee3] p-3">
          <div>
            <div className="text-[11px] uppercase text-[#5f6b77]">Make</div>
            <div className="text-[15px] font-bold">
              <span className="font-mono">{product.sku}</span> — {product.name}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase text-[#5f6b77]">Quantity</div>
            <div className="text-[15px] font-bold">
              {q(mo.plannedQty)} {product.uom}
            </div>
          </div>
        </section>
        {mo.notes && <p className="mb-4 whitespace-pre-wrap rounded bg-[#eef3f8] p-2">{mo.notes}</p>}

        <h2 className="mb-1 text-[13px] font-bold">Materials</h2>
        <table className="mb-5 w-full border-collapse">
          <thead>
            <tr className="bg-[#0d2233] text-left text-[11px] text-white">
              <th className="px-2 py-1.5 font-medium">SKU</th>
              <th className="px-2 py-1.5 font-medium">Material</th>
              <th className="px-2 py-1.5 text-right font-medium">Planned</th>
              <th className="w-24 px-2 py-1.5 font-medium">Used</th>
              <th className="w-32 px-2 py-1.5 font-medium">Batch</th>
            </tr>
          </thead>
          <tbody>
            {materials.map(({ m, sku, name, uom }) => (
              <tr key={m.id} className="break-inside-avoid border-b border-[#d9dee3]">
                <td className="px-2 py-2 font-mono text-[10.5px]">{sku}</td>
                <td className="px-2 py-2">
                  {name}
                  {m.note && <div className="text-[10.5px] text-[#5f6b77]">{m.note}</div>}
                </td>
                <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">
                  {q(m.plannedQty)} {uom}
                </td>
                <td className="px-2 py-2">{m.actualQty !== null ? q(m.actualQty) : <Blank />}</td>
                <td className="px-2 py-2">{m.batchNo ?? <Blank />}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {operations.length > 0 && (
          <>
            <h2 className="mb-1 text-[13px] font-bold">Operations</h2>
            <table className="mb-5 w-full border-collapse">
              <thead>
                <tr className="bg-[#0d2233] text-left text-[11px] text-white">
                  <th className="px-2 py-1.5 font-medium">Operation</th>
                  <th className="px-2 py-1.5 text-right font-medium">Planned hours</th>
                  <th className="w-24 px-2 py-1.5 font-medium">Actual hours</th>
                  <th className="w-32 px-2 py-1.5 font-medium">Done by</th>
                </tr>
              </thead>
              <tbody>
                {operations.map((o) => (
                  <tr key={o.id} className="break-inside-avoid border-b border-[#d9dee3]">
                    <td className="px-2 py-2">{o.name}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{q(o.plannedHours)}</td>
                    <td className="px-2 py-2">{o.actualHours !== null ? q(o.actualHours) : <Blank />}</td>
                    <td className="px-2 py-2">
                      <Blank />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <div className="mt-8 grid grid-cols-4 gap-6 text-[12px]">
          {["Quantity made", "Batch no.", "Completed by", "Date"].map((f) => (
            <div key={f} className="border-b border-[#1d2733] pb-1 text-[#5f6b77]">
              {f}
            </div>
          ))}
        </div>
      </article>
    </PrintShell>
  );
}
