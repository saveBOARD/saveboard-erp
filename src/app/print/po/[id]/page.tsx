import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrintShell } from "@/components/print/sales-document";
import { db, t } from "@/db";
import { getEntityContext } from "@/lib/dal";
import { getPO } from "@/lib/queries/purchase-order";

export const metadata: Metadata = { title: "Purchase order · saveBOARD ERP" };

const money = (n: number | string) => Number(n).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = (n: number | string) => Number(n).toLocaleString("en-NZ", { maximumFractionDigits: 4 });
const date = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" }) : null);

/** The purchase order as sent to the supplier (A4, logo, deliver-to = the entity's location). */
export default async function PrintPO(props: PageProps<"/print/po/[id]">) {
  const { id } = await props.params;
  const { entity } = await getEntityContext();
  const found = await getPO(entity.id, id, "Pacific/Auckland");
  if (!found) notFound();
  const [e] = await db.select().from(t.entities).where(eq(t.entities.id, entity.id));
  const { po, supplier, lines } = found;

  return (
    <PrintShell title={`Purchase order ${po.number}`}>
      <article className="sales-doc mx-auto bg-white p-[14mm] text-[12.5px] leading-snug text-[#1d2733] shadow print:p-0 print:shadow-none">
        <header className="flex items-start justify-between gap-6 border-b-2 border-[#0d2233] pb-4">
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="saveBOARD" className="mb-2 h-[18mm] w-auto" />
            <div className="font-medium">{e.legalName}</div>
            {e.address && <div className="whitespace-pre-line text-[#5f6b77]">{e.address}</div>}
            <div className="text-[#5f6b77]">{[e.phone, e.email, e.website].filter(Boolean).join(" · ")}</div>
            {e.taxNumber && <div className="text-[#5f6b77]">{e.id === "AUS" ? "ABN" : "GST No."} {e.taxNumber}</div>}
          </div>
          <div className="text-right">
            <div className="text-[18px] font-bold uppercase">Purchase order</div>
            <div className="text-[16px] font-medium">{po.number}</div>
            {po.title && <div className="text-[#5f6b77]">{po.title}</div>}
            <div className="mt-2 grid grid-cols-[auto_auto] justify-end gap-x-3 text-left">
              <span className="text-[#5f6b77]">Date</span>
              <span>{date(po.orderDate)}</span>
              {po.expectedOn && (
                <>
                  <span className="text-[#5f6b77]">Required by</span>
                  <span>{date(po.expectedOn)}</span>
                </>
              )}
            </div>
          </div>
        </header>
        <section className="grid grid-cols-2 gap-8 py-4">
          <div>
            <div className="mb-1 text-[10px] font-bold tracking-wider text-[#5f6b77] uppercase">Supplier</div>
            <div>{supplier.name}</div>
            {[supplier.contactName, supplier.phone, supplier.email].filter(Boolean).map((x) => (
              <div key={x}>{x}</div>
            ))}
          </div>
          <div>
            <div className="mb-1 text-[10px] font-bold tracking-wider text-[#5f6b77] uppercase">Deliver to</div>
            <div>{e.legalName}</div>
            <div className="whitespace-pre-line">{e.address ?? e.locationName}</div>
          </div>
        </section>
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-[#0d2233] text-left text-[11px] text-white">
              <th className="px-2 py-1.5 font-medium">#</th>
              <th className="px-2 py-1.5 font-medium">Item</th>
              <th className="px-2 py-1.5 text-right font-medium">Qty</th>
              <th className="px-2 py-1.5 font-medium">Unit</th>
              <th className="px-2 py-1.5 text-right font-medium">Price</th>
              <th className="px-2 py-1.5 text-right font-medium">GST</th>
              <th className="px-2 py-1.5 text-right font-medium">Total ex GST</th>
            </tr>
          </thead>
          <tbody>
            {lines.map(({ l, uom }) => (
              <tr key={l.id} className="break-inside-avoid border-b border-[#d9dee3] align-top">
                <td className="px-2 py-1.5 text-[#5f6b77]">{l.lineNo}</td>
                <td className="px-2 py-1.5">
                  {l.sku && <span className="mr-1 font-mono text-[10.5px] text-[#5f6b77]">{l.sku}</span>}
                  {l.description}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{qtyFmt(l.qty)}</td>
                <td className="px-2 py-1.5">{uom}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{money(l.unitPrice)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{(Number(l.taxRate) * 100).toLocaleString("en-NZ")}%</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{money(l.lineSubtotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3 flex justify-end">
          <div className="grid w-72 grid-cols-2 gap-y-1">
            <span className="text-[#5f6b77]">Subtotal</span>
            <span className="text-right tabular-nums">{money(po.subtotal)}</span>
            <span className="text-[#5f6b77]">GST</span>
            <span className="text-right tabular-nums">{money(po.tax)}</span>
            <span className="border-t border-[#1d2733] pt-1 font-bold">Total {po.currency}</span>
            <span className="border-t border-[#1d2733] pt-1 text-right font-bold tabular-nums">{money(po.total)}</span>
          </div>
        </div>
        {po.notes && (
          <section className="mt-5">
            <div className="mb-1 text-[10px] font-bold tracking-wider text-[#5f6b77] uppercase">Notes</div>
            <p className="whitespace-pre-wrap">{po.notes}</p>
          </section>
        )}
        <p className="mt-6 text-[11px] text-[#5f6b77]">Please quote {po.number} on your delivery docket and invoice.</p>
      </article>
    </PrintShell>
  );
}
