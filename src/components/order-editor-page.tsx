import { notFound, redirect } from "next/navigation";
import { OrderEditor, type EditorInitial } from "@/components/order-editor";
import { getEntityContext } from "@/lib/dal";
import { editorData } from "@/lib/queries/editor-data";
import { getOrder } from "@/lib/queries/orders";

/** Server wrapper: loads everything the editor needs for a new or existing quote / order. */
export async function OrderEditorPage({ kind, id, presetCustomerId }: { kind: "quote" | "order"; id?: string; presetCustomerId?: string }) {
  const { entity } = await getEntityContext();
  const data = await editorData(entity.id);
  let initial: EditorInitial | undefined;

  if (id) {
    const found = await getOrder(entity.id, id);
    if (!found) notFound();
    const o = found.order;
    const isQuote = o.status === "quote";
    if (isQuote !== (kind === "quote")) redirect(`/sell/${isQuote ? "quotes" : "orders"}/${id}/edit`);
    if (!["quote", "open", "picked"].includes(o.status)) redirect(`/sell/orders/${id}`);
    initial = {
      id: o.id,
      number: o.number,
      title: o.title,
      customerId: o.customerId,
      customerReference: o.customerReference,
      orderDate: o.orderDate,
      deliveryDeadline: o.deliveryDeadline,
      quoteExpiresOn: o.quoteExpiresOn,
      shipTo: {
        name: o.shipToName ?? "",
        phone: o.shipToPhone ?? "",
        line1: o.shipToLine1 ?? "",
        line2: o.shipToLine2 ?? "",
        city: o.shipToCity ?? "",
        region: o.shipToRegion ?? "",
        postcode: o.shipToPostcode ?? "",
        country: o.shipToCountry ?? "",
      },
      notes: o.notes,
      lines: found.lines.map(({ l }) => ({
        id: l.id,
        productId: l.productId,
        sku: l.sku,
        description: l.description,
        qty: Number(l.qty),
        unitPrice: Number(l.unitPrice),
        discountPct: Number(l.discountPct),
        taxRate: Number(l.taxRate),
      })),
    };
  }

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: entity.id === "AUS" ? "Australia/Sydney" : "Pacific/Auckland" }).format(new Date());
  return (
    <OrderEditor
      kind={kind}
      entity={{ id: entity.id, currency: entity.currency, gstRate: Number(entity.gstRate) }}
      customers={data.customers}
      products={data.products}
      priceLists={data.priceLists}
      customerPrices={data.customerPrices}
      initial={initial}
      today={today}
      presetCustomerId={presetCustomerId}
    />
  );
}
