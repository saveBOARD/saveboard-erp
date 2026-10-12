import "server-only";
import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db, t } from "@/db";
import { takeInvoiceNumber } from "@/lib/numbering";

/**
 * Gives an invoice number to invoiced orders that don't have one yet and aren't in Xero (e.g. invoiced before
 * separate numbering started), oldest invoice first. Entities without an "INV" sequence keep the order number.
 */
export async function ensureInvoiceNumbers(entityId: string, orderIds: string[]) {
  if (!orderIds.length) return;
  const need = await db
    .select({ id: t.salesOrders.id })
    .from(t.salesOrders)
    .where(
      and(
        eq(t.salesOrders.entityId, entityId),
        inArray(t.salesOrders.id, orderIds),
        isNotNull(t.salesOrders.invoicedOn),
        isNull(t.salesOrders.invoiceNumber),
        isNull(t.salesOrders.xeroInvoiceId),
      ),
    )
    .orderBy(asc(t.salesOrders.invoicedOn), asc(t.salesOrders.number));
  if (!need.length) return;
  await db.transaction(async (tx) => {
    for (const o of need) {
      const no = await takeInvoiceNumber(tx, entityId);
      if (!no) return; // this entity invoices with the order number
      await tx.update(t.salesOrders).set({ invoiceNumber: no }).where(eq(t.salesOrders.id, o.id));
    }
  });
}

/** The number on the invoice (separate invoice number, else the order number) and the Xero reference to go with it. */
export function invoiceIdentity(o: { number: string; invoiceNumber: string | null; customerReference: string | null; title: string | null }) {
  const customerRef = o.customerReference || o.title || null;
  return o.invoiceNumber
    ? { invoiceNumber: o.invoiceNumber, reference: [o.number, customerRef].filter(Boolean).join(" · ") }
    : { invoiceNumber: o.number, reference: customerRef };
}
