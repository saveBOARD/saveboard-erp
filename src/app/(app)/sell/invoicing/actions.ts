"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, t } from "@/db";
import { assertEntityAccess, getEntityContext } from "@/lib/dal";
import { dueDate, xeroInvoiceCsv } from "@/lib/invoicing/xero";
import { creditNotes, invoiceOrders } from "@/lib/queries/invoicing";

export type CsvResult = { ok?: true; error?: string; csv?: string; filename?: string };

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

/** Marks shipped orders Invoiced (invoice date + due date from each customer's terms) and returns the Xero CSV. */
export async function invoiceAndExport(input: { orderIds: string[]; invoiceDate: string }): Promise<CsvResult> {
  try {
    const { user, entity } = await context();
    const ids = Ids.parse(input.orderIds);
    const invoiceDate = isoDate.parse(input.invoiceDate);
    const rows = await db
      .select({ id: t.salesOrders.id, number: t.salesOrders.number, status: t.salesOrders.status, terms: t.customers.paymentTerms })
      .from(t.salesOrders)
      .innerJoin(t.customers, eq(t.customers.id, t.salesOrders.customerId))
      .where(and(eq(t.salesOrders.entityId, entity.id), inArray(t.salesOrders.id, ids)));
    if (rows.length !== ids.length) return { error: "One of the orders isn't in this entity." };
    const notShipped = rows.filter((r) => r.status !== "shipped");
    if (notShipped.length) return { error: `Only fully shipped orders can be invoiced: ${notShipped.map((r) => `${r.number} is ${r.status}`).join(", ")}.` };
    await db.transaction(async (tx) => {
      for (const r of rows) {
        const due = dueDate(invoiceDate, r.terms);
        await tx.update(t.salesOrders).set({ status: "invoiced", invoicedOn: invoiceDate, invoiceDueOn: due }).where(eq(t.salesOrders.id, r.id));
        await tx.insert(t.auditLog).values({
          entityId: entity.id,
          userId: user.id,
          tableName: "sales_orders",
          recordId: r.id,
          action: "invoiced",
          changes: { number: r.number, status: { from: "shipped", to: "invoiced" }, invoicedOn: invoiceDate, dueOn: due, via: "xero_csv" },
        });
      }
    });
    const csv = xeroInvoiceCsv(entity.id, await invoiceOrders(entity.id, ids));
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
    return { ok: true, csv: xeroInvoiceCsv(entity.id, orders), filename: filename(entity.id, orders[0].invoicedOn) };
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
    const rows = await db
      .select({ id: t.salesReturns.id, number: t.salesReturns.number, status: t.salesReturns.status, creditedOn: t.salesReturns.creditedOn })
      .from(t.salesReturns)
      .where(and(eq(t.salesReturns.entityId, entity.id), inArray(t.salesReturns.id, ids)));
    if (rows.length !== ids.length) return { error: "One of the returns isn't in this entity." };
    const bad = rows.filter((r) => r.status === "cancelled" || r.creditedOn);
    if (bad.length) return { error: `Already credited or cancelled: ${bad.map((r) => r.number).join(", ")}.` };
    await db.transaction(async (tx) => {
      for (const r of rows) {
        await tx.update(t.salesReturns).set({ creditedOn: creditDate }).where(eq(t.salesReturns.id, r.id));
        await tx.insert(t.auditLog).values({
          entityId: entity.id,
          userId: user.id,
          tableName: "sales_returns",
          recordId: r.id,
          action: "credited",
          changes: { number: r.number, creditedOn: creditDate, via: "xero_csv" },
        });
      }
    });
    const csv = xeroInvoiceCsv(entity.id, await creditNotes(entity.id, ids));
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
    return { ok: true, csv: xeroInvoiceCsv(entity.id, notes), filename: `xero-credit-notes-${entity.id}-${notes[0].invoicedOn}.csv` };
  } catch (e) {
    return { error: e instanceof z.ZodError ? e.issues[0].message : e instanceof Error ? e.message : "Couldn't build the file." };
  }
}

/** Clears a return's credit (e.g. the credit note was voided in Xero). */
export async function undoCredited(returnId: string): Promise<CsvResult> {
  try {
    const { user, entity } = await context();
    const [r] = await db
      .select({ number: t.salesReturns.number, creditedOn: t.salesReturns.creditedOn })
      .from(t.salesReturns)
      .where(and(eq(t.salesReturns.id, z.string().uuid().parse(returnId)), eq(t.salesReturns.entityId, entity.id)));
    if (!r?.creditedOn) return { error: "That return isn't credited." };
    await db.transaction(async (tx) => {
      await tx.update(t.salesReturns).set({ creditedOn: null }).where(eq(t.salesReturns.id, returnId));
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
      .select({ number: t.salesOrders.number, status: t.salesOrders.status, invoicedOn: t.salesOrders.invoicedOn })
      .from(t.salesOrders)
      .where(and(eq(t.salesOrders.id, z.string().uuid().parse(orderId)), eq(t.salesOrders.entityId, entity.id)));
    if (!o) return { error: "Order not found." };
    if (o.status !== "invoiced") return { error: `${o.number} isn't invoiced.` };
    await db.transaction(async (tx) => {
      await tx.update(t.salesOrders).set({ status: "shipped", invoicedOn: null, invoiceDueOn: null }).where(eq(t.salesOrders.id, orderId));
      await tx.insert(t.auditLog).values({
        entityId: entity.id,
        userId: user.id,
        tableName: "sales_orders",
        recordId: orderId,
        action: "undo_invoiced",
        changes: { number: o.number, status: { from: "invoiced", to: "shipped" }, invoicedOn: o.invoicedOn },
      });
    });
    revalidate();
    revalidatePath(`/sell/orders/${orderId}`);
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't undo." };
  }
}
