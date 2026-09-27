import type { t } from "@/db";
import { PrintButton } from "./print-button";

type Order = typeof t.salesOrders.$inferSelect;
type Customer = typeof t.customers.$inferSelect;
type Entity = typeof t.entities.$inferSelect;
type Line = { l: typeof t.orderLines.$inferSelect; uom: string | null };

export type DocKind = "quote" | "acknowledgement" | "picker" | "transport" | "customer";

const TITLES: Record<DocKind, string> = {
  quote: "Quote",
  acknowledgement: "Order acknowledgement",
  picker: "Packing slip — Picker copy",
  transport: "Packing slip — Transport copy",
  customer: "Packing slip — Customer copy",
};

const money = (n: number | string) => Number(n).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = (n: number | string) => Number(n).toLocaleString("en-NZ", { maximumFractionDigits: 4 });
const pct = (n: number | string) => `${(Number(n) * 100).toLocaleString("en-NZ", { maximumFractionDigits: 2 })}%`;
const date = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" }) : null);

function Block({ label, lines }: { label: string; lines: (string | null | undefined)[] }) {
  const shown = lines.filter(Boolean);
  return (
    <div>
      <div className="mb-1 text-[10px] font-bold tracking-wider text-[#5f6b77] uppercase">{label}</div>
      {shown.length ? shown.map((l, i) => <div key={i}>{l}</div>) : <div className="text-[#5f6b77]">—</div>}
    </div>
  );
}

function SignOff({ fields }: { fields: string[] }) {
  return (
    <div className="mt-8 grid grid-cols-2 gap-x-10 gap-y-6 text-[12px]">
      {fields.map((f) => (
        <div key={f} className="border-b border-[#1d2733] pb-1">
          <span className="text-[#5f6b77]">{f}</span>
        </div>
      ))}
    </div>
  );
}

/** One A4 document. Packing slips never show prices, cost or margin (business rule). */
export function SalesDocument({ kind, entity, order: o, customer, lines }: { kind: DocKind; entity: Entity; order: Order; customer: Customer; lines: Line[] }) {
  const priced = kind === "quote" || kind === "acknowledgement";
  const cityLine = (city: string | null, region: string | null, postcode: string | null) => [city, region, postcode].filter(Boolean).join(" ");
  const foreign = o.currency !== entity.currency;

  return (
    <article className="sales-doc mx-auto bg-white p-[14mm] text-[12.5px] leading-snug text-[#1d2733] shadow print:p-0 print:shadow-none">
      <header className="flex items-start justify-between gap-6 border-b-2 border-[#0d2233] pb-4">
        <div>
          {/* plain <img> so the logo is always in the printed / saved PDF */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="saveBOARD" className="mb-2 h-[18mm] w-auto" />
          <div className="font-medium">{entity.legalName}</div>
          {entity.address && <div className="whitespace-pre-line text-[#5f6b77]">{entity.address}</div>}
          <div className="text-[#5f6b77]">{[entity.phone, entity.email, entity.website].filter(Boolean).join(" · ")}</div>
          {entity.taxNumber && (
            <div className="text-[#5f6b77]">
              {entity.id === "AUS" ? "ABN" : "GST No."} {entity.taxNumber}
            </div>
          )}
        </div>
        <div className="text-right">
          <div className="text-[18px] font-bold uppercase">{TITLES[kind]}</div>
          <div className="text-[16px] font-medium">{o.number}</div>
          {o.title && <div className="text-[#5f6b77]">{o.title}</div>}
          <div className="mt-2 grid grid-cols-[auto_auto] justify-end gap-x-3 text-left">
            <span className="text-[#5f6b77]">Date</span>
            <span>{date(o.orderDate)}</span>
            {o.customerReference && (
              <>
                <span className="text-[#5f6b77]">Your ref.</span>
                <span>{o.customerReference}</span>
              </>
            )}
            {o.deliveryDeadline && (
              <>
                <span className="text-[#5f6b77]">Delivery by</span>
                <span>{date(o.deliveryDeadline)}</span>
              </>
            )}
            {kind === "quote" && o.quoteExpiresOn && (
              <>
                <span className="text-[#5f6b77]">Valid until</span>
                <span>{date(o.quoteExpiresOn)}</span>
              </>
            )}
          </div>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-8 py-4">
        <Block
          label="Bill to"
          lines={[customer.name, customer.billingLine1, customer.billingLine2, cityLine(customer.billingCity, customer.billingRegion, customer.billingPostcode), customer.billingCountry]}
        />
        <Block
          label="Ship to"
          lines={[o.shipToName, o.shipToPhone, o.shipToLine1, o.shipToLine2, cityLine(o.shipToCity, o.shipToRegion, o.shipToPostcode), o.shipToCountry]}
        />
      </section>

      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-[#0d2233] text-left text-[11px] text-white">
            <th className="px-2 py-1.5 font-medium">#</th>
            <th className="px-2 py-1.5 font-medium">Item</th>
            <th className="px-2 py-1.5 text-right font-medium">Qty</th>
            <th className="px-2 py-1.5 font-medium">Unit</th>
            {priced ? (
              <>
                <th className="px-2 py-1.5 text-right font-medium">Price</th>
                <th className="px-2 py-1.5 text-right font-medium">Disc.</th>
                <th className="px-2 py-1.5 text-right font-medium">GST</th>
                <th className="px-2 py-1.5 text-right font-medium">Total ex GST</th>
              </>
            ) : kind === "picker" ? (
              <>
                <th className="px-2 py-1.5 font-medium">Batch no.</th>
                <th className="px-2 py-1.5 text-center font-medium">Picked ✓</th>
              </>
            ) : null}
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
              {priced ? (
                <>
                  <td className="px-2 py-1.5 text-right tabular-nums">{money(l.unitPrice)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{Number(l.discountPct) ? pct(l.discountPct) : ""}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{pct(l.taxRate)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{money(l.lineSubtotal)}</td>
                </>
              ) : kind === "picker" ? (
                <>
                  <td className="px-2 py-1.5">{l.batchNo ?? <span className="inline-block w-24 border-b border-[#9aa5b1]">&nbsp;</span>}</td>
                  <td className="px-2 py-1.5 text-center">☐</td>
                </>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>

      {priced && (
        <div className="mt-3 flex justify-end">
          <div className="grid w-72 grid-cols-2 gap-y-1">
            <span className="text-[#5f6b77]">Subtotal</span>
            <span className="text-right tabular-nums">{money(o.subtotal)}</span>
            <span className="text-[#5f6b77]">GST</span>
            <span className="text-right tabular-nums">{money(o.tax)}</span>
            <span className="border-t border-[#1d2733] pt-1 font-bold">Total {o.currency}</span>
            <span className="border-t border-[#1d2733] pt-1 text-right font-bold tabular-nums">{money(o.total)}</span>
          </div>
        </div>
      )}
      {priced && foreign && <p className="mt-1 text-right text-[11px] text-[#5f6b77]">All amounts in {o.currency}.</p>}

      {o.notes && (
        <section className="mt-5">
          <div className="mb-1 text-[10px] font-bold tracking-wider text-[#5f6b77] uppercase">Notes</div>
          <p className="whitespace-pre-wrap">{o.notes}</p>
        </section>
      )}
      {kind === "quote" && entity.quoteTerms && (
        <section className="mt-5 text-[11px] text-[#5f6b77]">
          <p className="whitespace-pre-wrap">{entity.quoteTerms}</p>
        </section>
      )}

      {kind === "picker" && <SignOff fields={["Picked by", "Checked by", "Date", "Total weight", "Dimensions / pallets", "Notes"]} />}
      {kind === "transport" && <SignOff fields={["Carrier", "Consignment number", "Driver name", "Date and time collected", "Signature", "Number of pallets"]} />}
      {kind === "customer" && <SignOff fields={["Received by (name)", "Signature", "Date", "Condition on arrival"]} />}
    </article>
  );
}

export function PrintShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-page py-6 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] items-center justify-between px-2">
        <span className="text-sm text-muted">{title}</span>
        <PrintButton />
      </div>
      <div className="grid gap-6 print:gap-0">{children}</div>
    </div>
  );
}
