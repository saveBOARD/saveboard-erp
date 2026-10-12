import "server-only";
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db, t } from "@/db";
import { takeInvoiceNumber } from "@/lib/numbering";
import { xeroApi } from "@/lib/xero/client";
import { invoiceIdentity } from "./numbers";

/** The entity's invoice number sequence ("INV"), or null when its invoices use the order number. */
export async function invoiceSequence(entityId: string) {
  const [seq] = await db
    .select({ prefix: t.numberSequences.prefix, next: t.numberSequences.nextValue })
    .from(t.numberSequences)
    .where(and(eq(t.numberSequences.entityId, entityId), eq(t.numberSequences.kind, "INV")));
  return seq ?? null;
}

/** Invoices sent to Xero before separate numbering started (no invoice number yet), oldest first. */
export function draftsToRenumber(entityId: string) {
  return db
    .select({ id: t.salesOrders.id, number: t.salesOrders.number, title: t.salesOrders.title, customerReference: t.salesOrders.customerReference, xeroInvoiceId: t.salesOrders.xeroInvoiceId, xeroStatus: t.salesOrders.xeroStatus })
    .from(t.salesOrders)
    .where(and(eq(t.salesOrders.entityId, entityId), isNotNull(t.salesOrders.xeroInvoiceId), isNull(t.salesOrders.invoiceNumber), eq(t.salesOrders.xeroStatus, "DRAFT")))
    .orderBy(asc(t.salesOrders.invoicedOn), asc(t.salesOrders.number));
}

/** Highest number already used for an invoice in this entity (to stop the sequence being set back onto used numbers). */
export async function highestInvoiceNumber(entityId: string, prefix: string) {
  const [r] = await db
    .select({ n: sql<number | null>`max(nullif(regexp_replace(${t.salesOrders.invoiceNumber}, '\\D', '', 'g'), '')::int)` })
    .from(t.salesOrders)
    .where(and(eq(t.salesOrders.entityId, entityId), sql`${t.salesOrders.invoiceNumber} like ${prefix + "%"}`));
  return r?.n ?? 0;
}

/**
 * Gives Xero draft invoices that still carry the order number the next invoice numbers (oldest first), changing
 * them in Xero too. Only drafts are changed; an invoice already approved in Xero keeps its number. Each number is
 * only used once Xero has accepted the change.
 */
export async function renumberDrafts(entityId: string) {
  const done: string[] = [];
  const skipped: string[] = [];
  for (const o of await draftsToRenumber(entityId)) {
    const { Invoices } = await xeroApi<{ Invoices: { Status: string }[] }>(entityId, "GET", `/Invoices/${o.xeroInvoiceId}`);
    if (Invoices[0]?.Status !== "DRAFT") {
      skipped.push(`${o.number} (${(Invoices[0]?.Status ?? "not found").toLowerCase()} in Xero)`);
      continue;
    }
    await db.transaction(async (tx) => {
      const invoiceNumber = await takeInvoiceNumber(tx, entityId);
      if (!invoiceNumber) throw new Error("This entity's invoices use the order number; there is nothing to renumber.");
      const ident = invoiceIdentity({ ...o, invoiceNumber });
      await xeroApi(entityId, "POST", "/Invoices", { Invoices: [{ InvoiceID: o.xeroInvoiceId, InvoiceNumber: ident.invoiceNumber, Reference: ident.reference ?? undefined }] });
      await tx.update(t.salesOrders).set({ invoiceNumber }).where(eq(t.salesOrders.id, o.id));
      await tx.insert(t.xeroSyncLog).values({ entityId, kind: "invoice", recordId: o.id, docNumber: o.number, ok: true, message: `Draft renumbered in Xero as ${invoiceNumber}` });
      done.push(`${o.number} → ${invoiceNumber}`);
    });
  }
  return { done, skipped };
}
