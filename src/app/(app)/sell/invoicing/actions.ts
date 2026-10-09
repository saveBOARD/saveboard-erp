"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, t } from "@/db";
import { assertEntityAccess, getEntityContext } from "@/lib/dal";
import { dueDate, xeroInvoiceCsv } from "@/lib/invoicing/xero";
import { creditNotes, invoiceOrders } from "@/lib/queries/invoicing";
import { entityXeroSettings } from "@/lib/queries/xero-settings";
import { getConnection, xeroApi } from "@/lib/xero/client";
import { entityToday } from "@/lib/queries/stock-items";
import { pushCreditNotes, pushInvoices, type PushResult } from "@/lib/xero/sync";

export type CsvResult = { ok?: true; error?: string; csv?: string; filename?: string; message?: string };

const Ids = z.array(z.string().uuid()).min(1, "Tick at least one order").max(200);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid invoice date");

async function context() {
  const { user, entity } = await getEntityContext();
  await assertEntityAccess(user.id, entity.id);
  return { user, entity };
}

function revalidate() {
  revalidatePath("/sell/invoicing");
  revalidatePath("/sell/orders");
}

const filename = (entityId: string, date: string) => `xero-invoices-${entityId}-${date}.csv`;

/**
 * Invoices orders (invoice date + due date from each customer's terms). Returns an error message, or null.
 * Shipped orders become Invoiced. Open / picked orders can be invoiced up front (cash, COD, custom work paid before
 * production): they keep their status, and become Invoiced when fully shipped.
 */
async function markInvoiced(entityId: string, userId: string, ids: string[], invoiceDate: string, via: "xero_csv" | "xero_api") {
  const rows = await db
    .select({ id: t.salesOrders.id, number: t.salesOrders.number, status: t.salesOrders.status, invoicedOn: t.salesOrders.invoicedOn, terms: t.customers.paymentTerms })
    .from(t.salesOrders)
    .innerJoin(t.customers, eq(t.customers.id, t.salesOrders.customerId))
    .where(and(eq(t.salesOrders.entityId, entityId), inArray(t.salesOrders.id, ids)));
  if (rows.length !== ids.length) return "One of the orders isn't in this entity.";
  const already = rows.filter((r) => r.invoicedOn || r.status === "invoiced" || r.status === "closed");
  if (already.length) return `Already invoiced: ${already.map((r) => r.number).join(", ")}.`;
  const bad = rows.filter((r) => !["open", "picked", "shipped"].includes(r.status));
  if (bad.length) return `These can't be invoiced: ${bad.map((r) => `${r.number} is ${r.status}`).join(", ")}.`;
  await db.transaction(async (tx) => {
    for (const r of rows) {
      const due = dueDate(invoiceDate, r.terms);
      const status = r.status === "shipped" ? ("invoiced" as const) : r.status; // unshipped: invoiced up front, status unchanged
      await tx.update(t.salesOrders).set({ status, invoicedOn: invoiceDate, invoiceDueOn: due }).where(eq(t.salesOrders.id, r.id));
      await tx.insert(t.auditLog).values({
        entityId,
        userId,
        tableName: "sales_orders",
        recordId: r.id,
        action: "invoiced",
        changes: { number: r.number, status: { from: r.status, to: status }, invoicedOn: invoiceDate, dueOn: due, via, upFront: r.status !== "shipped" },
      });
    }
  });
  return null;
}

/** Marks returns Credited (credit date). Returns an error message, or null. */
async function markCredited(entityId: string, userId: string, ids: string[], creditDate: string, via: "xero_csv" | "xero_api") {
  const rows = await db
    .select({ id: t.salesReturns.id, number: t.salesReturns.number, status: t.salesReturns.status, creditedOn: t.salesReturns.creditedOn })
    .from(t.salesReturns)
    .where(and(eq(t.salesReturns.entityId, entityId), inArray(t.salesReturns.id, ids)));
  if (rows.length !== ids.length) return "One of the returns isn't in this entity.";
  const bad = rows.filter((r) => r.status === "cancelled" || r.creditedOn);
  if (bad.length) return `Already credited or cancelled: ${bad.map((r) => r.number).join(", ")}.`;
  await db.transaction(async (tx) => {
    for (const r of rows) {
      await tx.update(t.salesReturns).set({ creditedOn: creditDate }).where(eq(t.salesReturns.id, r.id));
      await tx.insert(t.auditLog).values({ entityId, userId, tableName: "sales_returns", recordId: r.id, action: "credited", changes: { number: r.number, creditedOn: creditDate, via } });
    }
  });
  return null;
}

function pushMessage(kind: string, r: PushResult) {
  const parts = [r.sent && `${r.sent} ${kind} sent to Xero as drafts`, r.linked && `${r.linked} already in Xero (linked)`].filter(Boolean);
  const failed = r.failed.length ? ` ${r.failed.length} failed: ${r.failed.map((f) => `${f.number} — ${f.error}`).join("; ")}` : "";
  return `${parts.join(", ") || "Nothing new to send"}.${failed}`;
}

/** Marks shipped orders Invoiced and creates them as draft invoices in Xero (live connection). */
export async function invoiceAndSend(input: { orderIds: string[]; invoiceDate: string }): Promise<CsvResult> {
  try {
    const { user, entity } = await context();
    const ids = Ids.parse(input.orderIds);
    const err = await markInvoiced(entity.id, user.id, ids, isoDate.parse(input.invoiceDate), "xero_api");
    if (err) return { error: err };
    revalidate();
    const r = await pushInvoices(entity.id, ids, user.id);
    revalidate();
    return r.failed.length ? { error: `Marked invoiced. ${pushMessage("invoices", r)} Fix the problem, then use Send to Xero on the Invoiced tab.` } : { ok: true, message: pushMessage("invoices", r) };
  } catch (e) {
    revalidate();
    return { error: errorText(e, "Couldn't invoice the orders.") };
  }
}

/** Sends invoiced orders that aren't in Xero yet (a failed send, or invoiced before Xero was connected). */
export async function sendToXero(orderIds: string[]): Promise<CsvResult> {
  try {
    const { user, entity } = await context();
    const r = await pushInvoices(entity.id, Ids.parse(orderIds), user.id);
    revalidate();
    return r.failed.length ? { error: pushMessage("invoices", r) } : { ok: true, message: pushMessage("invoices", r) };
  } catch (e) {
    return { error: errorText(e, "Couldn't send to Xero.") };
  }
}

/** Marks returns Credited and creates their draft credit notes in Xero. */
export async function creditAndSend(input: { returnIds: string[]; creditDate: string }): Promise<CsvResult> {
  try {
    const { user, entity } = await context();
    const ids = Ids.parse(input.returnIds);
    const err = await markCredited(entity.id, user.id, ids, isoDate.parse(input.creditDate), "xero_api");
    if (err) return { error: err };
    revalidate();
    revalidatePath("/sell/returns");
    const r = await pushCreditNotes(entity.id, ids, user.id);
    revalidate();
    return r.failed.length
      ? { error: `Marked credited. ${pushMessage("credit notes", r)} Fix the problem, then use Send to Xero on the Credited tab.` }
      : { ok: true, message: pushMessage("credit notes", r) };
  } catch (e) {
    revalidate();
    return { error: errorText(e, "Couldn't credit the returns.") };
  }
}

export async function sendCreditsToXero(returnIds: string[]): Promise<CsvResult> {
  try {
    const { user, entity } = await context();
    const r = await pushCreditNotes(entity.id, Ids.parse(returnIds), user.id);
    revalidate();
    return r.failed.length ? { error: pushMessage("credit notes", r) } : { ok: true, message: pushMessage("credit notes", r) };
  } catch (e) {
    return { error: errorText(e, "Couldn't send to Xero.") };
  }
}

/** "Invoice now" on a sales order (any time before it's invoiced): today's date; to Xero when connected, else the import file. */
export async function invoiceOrderNow(orderId: string): Promise<CsvResult> {
  try {
    const { user, entity } = await context();
    const ids = Ids.parse([orderId]);
    const today = entityToday(entity.id);
    const err = await markInvoiced(entity.id, user.id, ids, today, (await getConnection(entity.id)) ? "xero_api" : "xero_csv");
    if (err) return { error: err };
    revalidate();
    revalidatePath(`/sell/orders/${orderId}`);
    if (await getConnection(entity.id)) {
      const r = await pushInvoices(entity.id, ids, user.id);
      revalidatePath(`/sell/orders/${orderId}`);
      return r.failed.length ? { error: `Invoiced. ${pushMessage("invoices", r)} Retry from Sell → Invoicing → Invoiced.` } : { ok: true, message: pushMessage("invoices", r) };
    }
    const csv = xeroInvoiceCsv(entity.id, await invoiceOrders(entity.id, ids), await entityXeroSettings(entity.id));
    return { ok: true, csv, filename: filename(entity.id, today), message: "Invoiced. Import the downloaded file into Xero." };
  } catch (e) {
    return { error: errorText(e, "Couldn't invoice the order.") };
  }
}

const errorText = (e: unknown, fallback: string) => (e instanceof z.ZodError ? e.issues[0].message : e instanceof Error ? e.message : fallback);

/** Marks shipped orders Invoiced (invoice date + due date from each customer's terms) and returns the Xero CSV. */
export async function invoiceAndExport(input: { orderIds: string[]; invoiceDate: string }): Promise<CsvResult> {
  try {
    const { user, entity } = await context();
    const ids = Ids.parse(input.orderIds);
    const invoiceDate = isoDate.parse(input.invoiceDate);
    const err = await markInvoiced(entity.id, user.id, ids, invoiceDate, "xero_csv");
    if (err) return { error: err };
    const csv = xeroInvoiceCsv(entity.id, await invoiceOrders(entity.id, ids), await entityXeroSettings(entity.id));
    revalidate();
    return { ok: true, csv, filename: filename(entity.id, invoiceDate) };
  } catch (e) {
    return { error: e instanceof z.ZodError ? e.issues[0].message : e instanceof Error ? e.message : "Couldn't invoice the orders." };
  }
}

/** The Xero CSV again for orders already invoiced (e.g. the import needs redoing). Changes nothing. */
export async function exportAgain(orderIds: string[]): Promise<CsvResult> {
  try {
    const { entity } = await context();
    const ids = Ids.parse(orderIds);
    const orders = await invoiceOrders(entity.id, ids);
    if (orders.length !== ids.length) return { error: "Only invoiced orders from this entity can be exported." };
    return { ok: true, csv: xeroInvoiceCsv(entity.id, orders, await entityXeroSettings(entity.id)), filename: filename(entity.id, orders[0].invoicedOn) };
  } catch (e) {
    return { error: e instanceof z.ZodError ? e.issues[0].message : e instanceof Error ? e.message : "Couldn't build the file." };
  }
}

/** Marks returns Credited (credit date) and returns the Xero CSV of their credit notes. */
export async function creditAndExport(input: { returnIds: string[]; creditDate: string }): Promise<CsvResult> {
  try {
    const { user, entity } = await context();
    const ids = Ids.parse(input.returnIds);
    const creditDate = isoDate.parse(input.creditDate);
    const err = await markCredited(entity.id, user.id, ids, creditDate, "xero_csv");
    if (err) return { error: err };
    const csv = xeroInvoiceCsv(entity.id, await creditNotes(entity.id, ids), await entityXeroSettings(entity.id));
    revalidate();
    revalidatePath("/sell/returns");
    return { ok: true, csv, filename: `xero-credit-notes-${entity.id}-${creditDate}.csv` };
  } catch (e) {
    return { error: e instanceof z.ZodError ? e.issues[0].message : e instanceof Error ? e.message : "Couldn't credit the returns." };
  }
}

/** The credit-note CSV again for returns already credited. Changes nothing. */
export async function exportCreditsAgain(returnIds: string[]): Promise<CsvResult> {
  try {
    const { entity } = await context();
    const ids = Ids.parse(returnIds);
    const notes = await creditNotes(entity.id, ids);
    if (notes.length !== ids.length) return { error: "Only credited returns from this entity can be exported." };
    return { ok: true, csv: xeroInvoiceCsv(entity.id, notes, await entityXeroSettings(entity.id)), filename: `xero-credit-notes-${entity.id}-${notes[0].invoicedOn}.csv` };
  } catch (e) {
    return { error: e instanceof z.ZodError ? e.issues[0].message : e instanceof Error ? e.message : "Couldn't build the file." };
  }
}

/** Clears a return's credit (e.g. the credit note was voided in Xero). */
export async function undoCredited(returnId: string): Promise<CsvResult> {
  try {
    const { user, entity } = await context();
    const [r] = await db
      .select({ number: t.salesReturns.number, creditedOn: t.salesReturns.creditedOn, xeroId: t.salesReturns.xeroCreditNoteId })
      .from(t.salesReturns)
      .where(and(eq(t.salesReturns.id, z.string().uuid().parse(returnId)), eq(t.salesReturns.entityId, entity.id)));
    if (!r?.creditedOn) return { error: "That return isn't credited." };
    if (r.xeroId) {
      const { CreditNotes } = await xeroApi<{ CreditNotes: { Status: string }[] }>(entity.id, "GET", `/CreditNotes/${r.xeroId}`);
      const status = CreditNotes[0]?.Status;
      if (status && !["VOIDED", "DELETED"].includes(status)) return { error: `${r.number} is in Xero (${status.toLowerCase()}). Void or delete it in Xero first, then undo here.` };
    }
    await db.transaction(async (tx) => {
      await tx.update(t.salesReturns).set({ creditedOn: null, xeroCreditNoteId: null, xeroStatus: null, xeroSyncedAt: null }).where(eq(t.salesReturns.id, returnId));
      await tx.insert(t.auditLog).values({ entityId: entity.id, userId: user.id, tableName: "sales_returns", recordId: returnId, action: "undo_credited", changes: { number: r.number, creditedOn: r.creditedOn } });
    });
    revalidate();
    revalidatePath("/sell/returns");
    revalidatePath(`/sell/returns/${returnId}`);
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't undo." };
  }
}

/** Puts an invoiced order back to Shipped (e.g. the invoice was deleted in Xero). */
export async function undoInvoiced(orderId: string): Promise<CsvResult> {
  try {
    const { user, entity } = await context();
    const [o] = await db
      .select({ number: t.salesOrders.number, status: t.salesOrders.status, invoicedOn: t.salesOrders.invoicedOn, xeroId: t.salesOrders.xeroInvoiceId })
      .from(t.salesOrders)
      .where(and(eq(t.salesOrders.id, z.string().uuid().parse(orderId)), eq(t.salesOrders.entityId, entity.id)));
    if (!o) return { error: "Order not found." };
    if (!o.invoicedOn) return { error: `${o.number} isn't invoiced.` };
    if (!["invoiced", "open", "picked"].includes(o.status)) return { error: `${o.number} is ${o.status}, so its invoice can't be undone here.` };
    if (o.xeroId) {
      const { Invoices } = await xeroApi<{ Invoices: { Status: string }[] }>(entity.id, "GET", `/Invoices/${o.xeroId}`);
      const status = Invoices[0]?.Status;
      if (status && !["VOIDED", "DELETED"].includes(status)) return { error: `${o.number} is in Xero (${status.toLowerCase()}). Void or delete it in Xero first, then undo here.` };
    }
    await db.transaction(async (tx) => {
      await tx
        .update(t.salesOrders)
        .set({ status: o.status === "invoiced" ? "shipped" : o.status, invoicedOn: null, invoiceDueOn: null, xeroInvoiceId: null, xeroStatus: null, xeroAmountDue: null, xeroAmountPaid: null, xeroSyncedAt: null })
        .where(eq(t.salesOrders.id, orderId));
      await tx.insert(t.auditLog).values({
        entityId: entity.id,
        userId: user.id,
        tableName: "sales_orders",
        recordId: orderId,
        action: "undo_invoiced",
        changes: { number: o.number, status: { from: o.status, to: o.status === "invoiced" ? "shipped" : o.status }, invoicedOn: o.invoicedOn },
      });
    });
    revalidate();
    revalidatePath(`/sell/orders/${orderId}`);
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't undo." };
  }
}
