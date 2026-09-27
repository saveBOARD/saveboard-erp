import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrintShell } from "@/components/print/sales-document";
import { db, t } from "@/db";
import { getEntityContext } from "@/lib/dal";
import { getStocktake } from "@/lib/queries/stocktake";

export const metadata: Metadata = { title: "Count sheet · saveBOARD ERP" };

/** Printable count sheet: items grouped by category with blank boxes to write the count in. */
export default async function PrintCountSheet(props: PageProps<"/print/stocktake/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const { entity } = await getEntityContext();
  const found = await getStocktake(entity.id, id);
  if (!found) notFound();
  const [e] = await db.select().from(t.entities).where(eq(t.entities.id, entity.id));
  const showExpected = sp.expected === "1";

  return (
    <PrintShell title={`Count sheet ${found.st.number}`}>
      <article className="sales-doc mx-auto bg-white p-[14mm] text-[12px] text-[#1d2733] shadow print:p-0 print:shadow-none">
        <header className="mb-4 flex items-start justify-between border-b-2 border-[#0d2233] pb-3">
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="saveBOARD" className="mb-1 h-[12mm] w-auto" />
            <div className="font-medium">{e.legalName}</div>
            <div className="text-[#5f6b77]">{e.locationName}</div>
          </div>
          <div className="text-right">
            <div className="text-[18px] font-bold uppercase">Stock count sheet</div>
            <div className="text-[16px] font-medium">{found.st.number}</div>
            <div>{found.st.reason}</div>
            <div className="text-[#5f6b77]">{found.st.scope}</div>
          </div>
        </header>
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-[#0d2233] text-left text-[11px] text-white">
              <th className="px-2 py-1.5 font-medium">SKU</th>
              <th className="px-2 py-1.5 font-medium">Item</th>
              <th className="px-2 py-1.5 font-medium">Unit</th>
              {showExpected && <th className="px-2 py-1.5 text-right font-medium">Expected</th>}
              <th className="w-28 px-2 py-1.5 font-medium">Counted</th>
              <th className="w-40 px-2 py-1.5 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody>
            {found.lines.map((l, i) => {
              const newCategory = i === 0 || l.category !== found.lines[i - 1].category;
              return [
                newCategory && (
                  <tr key={`c-${l.id}`}>
                    <td colSpan={showExpected ? 6 : 5} className="bg-[#eef3f8] px-2 py-1 text-[11px] font-bold">
                      {l.category ?? "Uncategorised"}
                    </td>
                  </tr>
                ),
                <tr key={l.id} className="break-inside-avoid border-b border-[#d9dee3]">
                  <td className="px-2 py-2 font-mono text-[10.5px]">{l.sku}</td>
                  <td className="px-2 py-2">{l.name}</td>
                  <td className="px-2 py-2">{l.uom}</td>
                  {showExpected && <td className="px-2 py-2 text-right tabular-nums">{l.expected.toLocaleString("en-NZ", { maximumFractionDigits: 4 })}</td>}
                  <td className="px-2 py-2">
                    <div className="h-6 border-b border-[#9aa5b1]" />
                  </td>
                  <td className="px-2 py-2">
                    <div className="h-6 border-b border-[#9aa5b1]" />
                  </td>
                </tr>,
              ];
            })}
          </tbody>
        </table>
        <div className="mt-8 grid grid-cols-3 gap-8 text-[12px]">
          {["Counted by", "Checked by", "Date"].map((f) => (
            <div key={f} className="border-b border-[#1d2733] pb-1 text-[#5f6b77]">
              {f}
            </div>
          ))}
        </div>
      </article>
    </PrintShell>
  );
}
