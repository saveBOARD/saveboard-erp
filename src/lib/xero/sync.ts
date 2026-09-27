import "server-only";
import { and, asc, eq, inArray, isNotNull, isNull, notInArray, or } from "drizzle-orm";
import { db, t } from "@/db";
import { XERO_SETTINGS } from "@/lib/invoicing/xero";
import { XeroError, xeroApi } from "./client";

/**
 * One-way push of invoices and credit notes (with their contacts) to the entity's Xero organisation, and the read
 * back of their status and payments. Documents are created as drafts, numbered with the SO / RET number, so they're
 * checked and approved in Xero exactly like the CSV import.
 */

type XContact = { ContactID: string; Name: string };
type XInvoice = { InvoiceID: string; InvoiceNumber: string; Status: string; AmountDue: number; AmountPaid: number; Total: number };
type XCreditNote = { CreditNoteID: string; CreditNoteNumber: string; Status: string; RemainingCredit: number };

async function log(entityId: string, kind: string, recordId: string | null, docNumber: string | null, ok: boolean, message: string, userId?: string | null) {
  await db.insert(t.xeroSyncLog).values({ entityId, kind, recordId, docNumber, ok, message: message.slice(0, 1000), userId: userId ?? null });
}

const quote = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/** Account code check and Xero's tax type codes for our tax rate names ("15% GST on Income" -> "OUTPUT2"). */
export async function xeroSettingsCheck(entityId: string) {
  const x = XERO_SETTINGS[entityId];
  const [{ TaxRates }, { Accounts }] = await Promise.all([
    xeroApi<{ TaxRates: { Name: string; TaxType: string; Status: string }[] }>(entityId, "GET", "/TaxRates"),
    xeroApi<{ Accounts: { Code: string; Name: string; Status: string }[] }>(entityId, "GET", `/Accounts?where=${encodeURIComponent(`Code=="${x.accountCode}"`)}`),
  ]);
  const find = (name: string) => TaxRates.find((r) => r.Name.toLowerCase() === name.toLowerCase() && r.Status === "ACTIVE")?.TaxType ?? null;
  return {
    account: Accounts[0] ? `${Accounts[0].Code} ${Accounts[0].Name}` : null,
    taxOnIncome: find(x.taxOnIncome),
    taxZeroRated: find(x.taxZeroRated),
    names: x,
  };
}

async function taxCodes(entityId: string) {
  const s = await xeroSettingsCheck(entityId);
  if (!s.account) throw new XeroError(`Account ${s.names.accountCode} doesn't exist in this Xero organisation.`);
  if (!s.taxOnIncome || !s.taxZeroRated) throw new XeroError(`Tax rates "${s.names.taxOnIncome}" / "${s.names.taxZeroRated}" weren't both found in Xero.`);
  return { account: s.names.accountCode, gst: s.taxOnIncome, zero: s.taxZeroRated };
}

/** The customer's Xero contact: the one already linked, else one with exactly the same name, else a new one. */
async function ensureContact(entityId: string, customerId: string, userId?: string | null) {
  const [c] = await db.select().from(t.customers).where(and(eq(t.customers.id, customerId), eq(t.customers.entityId, entityId)));
  if (!c) throw new XeroError("Customer not found.");
  if (c.xeroContactId) return c.xeroContactId;
  const found = await xeroApi<{ Contacts: XContact[] }>(entityId, "GET", `/Contacts?where=${encodeURIComponent(`Name=="${quote(c.name)}"`)}`);
  let id = found.Contacts[0]?.ContactID;
  if (!id) {
    const created = await xeroApi<{ Contacts: XContact[] }>(
      entityId,
      "POST",
      "/Contacts",
      {
        Contacts: [
          {
            Name: c.name,
            EmailAddress: c.email ?? undefined,
            AccountNumber: c.code ?? undefined,
            TaxNumber: c.businessNumber ?? undefined,
            Phones: c.phone ? [{ PhoneType: "DEFAULT", PhoneNumber: c.phone }] : undefined,
            Addresses: c.billingLine1
              ? [{ AddressType: "POBOX", AddressLine1: c.billingLine1, AddressLine2: c.billingLine2 ?? undefined, City: c.billingCity ?? undefined, Region: c.billingRegion ?? undefined, PostalCode: c.billingPostcode ?? undefined, Country: c.billingCountry ?? undefined }]
              : undefined,
          },
        ],
      }
    );
    id = created.Contacts[0].ContactID;
    await log(entityId, "contact", c.id, c.name, true, "Created in Xero", userId);
  }
  await db.update(t.customers).set({ xeroContactId: id }).where(eq(t.customers.id, c.id));
  return id;
}

export type PushResult = { sent: number; linked: number; failed: { number: string; error: string }[] };

/** Creates draft invoices in Xero for invoiced orders that aren't there yet. An invoice already in Xero with the same number is linked instead. */
export async function pushInvoices(entityId: string, orderIds: string[], userId?: string | null): Promise<PushResult> {
  const result: PushResult = { sent: 0, linked: 0, failed: [] };
  if (!orderIds.length) return result;
  const codes = await taxCodes(entityId);
  const orders = await db
    .select()
    .from(t.salesOrders)
    .where(and(eq(t.salesOrders.entityId, entityId), inArray(t.salesOrders.id, orderIds), eq(t.salesOrders.status, "invoiced")));
  for (const o of orders) {
    if (o.xeroInvoiceId) continue;
    try {
      const existing = await xeroApi<{ Invoices: XInvoice[] }>(entityId, "GET", `/Invoices?InvoiceNumbers=${encodeURIComponent(o.number)}&Statuses=DRAFT,SUBMITTED,AUTHORISED,PAID`);
      let inv = existing.Invoices[0];
      if (inv) result.linked++;
      else {
        const contactId = await ensureContact(entityId, o.customerId, userId);
        const lines = await db.select().from(t.orderLines).where(eq(t.orderLines.orderId, o.id)).orderBy(asc(t.orderLines.lineNo));
        const created = await xeroApi<{ Invoices: XInvoice[] }>(
          entityId,
          "POST",
          "/Invoices",
          {
            Invoices: [
              {
                Type: "ACCREC",
                Contact: { ContactID: contactId },
                InvoiceNumber: o.number,
                Reference: o.customerReference || o.title || undefined,
                Date: o.invoicedOn,
                DueDate: o.invoiceDueOn ?? o.invoicedOn,
                CurrencyCode: o.currency,
                LineAmountTypes: "Exclusive",
                Status: "DRAFT",
                LineItems: lines
                  .filter((l) => Number(l.qty) !== 0)
                  .map((l) => ({
                    Description: l.sku ? `[${l.sku}] ${l.description}` : l.description,
                    Quantity: Number(l.qty),
                    UnitAmount: Number(l.unitPrice),
                    DiscountRate: Number(l.discountPct) ? Math.round(Number(l.discountPct) * 1_000_000) / 10_000 : undefined,
                    AccountCode: codes.account,
                    TaxType: Number(l.taxRate) > 0 ? codes.gst : codes.zero,
                  })),
              },
            ],
          }
        );
        inv = created.Invoices[0];
        result.sent++;
      }
      await db
        .update(t.salesOrders)
        .set({ xeroInvoiceId: inv.InvoiceID, xeroStatus: inv.Status, xeroAmountDue: String(inv.AmountDue ?? 0), xeroAmountPaid: String(inv.AmountPaid ?? 0), xeroSyncedAt: new Date() })
        .where(eq(t.salesOrders.id, o.id));
      await log(entityId, "invoice", o.id, o.number, true, existing.Invoices[0] ? `Linked to the invoice already in Xero (${inv.Status})` : "Draft invoice created", userId);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      result.failed.push({ number: o.number, error });
      await log(entityId, "invoice", o.id, o.number, false, error, userId);
      if (e instanceof XeroError && (e.status === 401 || e.status === 429)) break; // no point trying the rest
    }
  }
  return result;
}

/** Creates draft credit notes in Xero (numbered with the return number) for credited returns not there yet. */
export async function pushCreditNotes(entityId: string, returnIds: string[], userId?: string | null): Promise<PushResult> {
  const result: PushResult = { sent: 0, linked: 0, failed: [] };
  if (!returnIds.length) return result;
  const codes = await taxCodes(entityId);
  const returns = await db
    .select({ r: t.salesReturns, so: t.salesOrders.number })
    .from(t.salesReturns)
    .innerJoin(t.salesOrders, eq(t.salesOrders.id, t.salesReturns.orderId))
    .where(and(eq(t.salesReturns.entityId, entityId), inArray(t.salesReturns.id, returnIds), isNotNull(t.salesReturns.creditedOn)));
  for (const { r, so } of returns) {
    if (r.xeroCreditNoteId) continue;
    try {
      const existing = await xeroApi<{ CreditNotes: XCreditNote[] }>(entityId, "GET", `/CreditNotes?where=${encodeURIComponent(`CreditNoteNumber=="${quote(r.number)}" AND Status!="VOIDED" AND Status!="DELETED"`)}`);
      let cn = existing.CreditNotes[0];
      if (cn) result.linked++;
      else {
        const contactId = await ensureContact(entityId, r.customerId, userId);
        const lines = await db.select().from(t.returnLines).where(eq(t.returnLines.returnId, r.id)).orderBy(asc(t.returnLines.lineNo));
        const created = await xeroApi<{ CreditNotes: XCreditNote[] }>(
          entityId,
          "POST",
          "/CreditNotes",
          {
            CreditNotes: [
              {
                Type: "ACCRECCREDIT",
                Contact: { ContactID: contactId },
                CreditNoteNumber: r.number,
                Reference: `Return on ${so}`,
                Date: r.creditedOn,
                CurrencyCode: r.currency,
                LineAmountTypes: "Exclusive",
                Status: "DRAFT",
                LineItems: lines.map((l) => ({
                  Description: l.sku ? `[${l.sku}] ${l.description}` : l.description,
                  Quantity: Number(l.qty),
                  UnitAmount: Number(l.unitPrice),
                  AccountCode: codes.account,
                  TaxType: Number(l.taxRate) > 0 ? codes.gst : codes.zero,
                })),
              },
            ],
          }
        );
        cn = created.CreditNotes[0];
        result.sent++;
      }
      await db.update(t.salesReturns).set({ xeroCreditNoteId: cn.CreditNoteID, xeroStatus: cn.Status, xeroSyncedAt: new Date() }).where(eq(t.salesReturns.id, r.id));
      await log(entityId, "credit_note", r.id, r.number, true, existing.CreditNotes[0] ? `Linked to the credit note already in Xero (${cn.Status})` : "Draft credit note created", userId);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      result.failed.push({ number: r.number, error });
      await log(entityId, "credit_note", r.id, r.number, false, error, userId);
      if (e instanceof XeroError && (e.status === 401 || e.status === 429)) break;
    }
  }
  return result;
}

/**
 * Reads back status and payments for invoices / credit notes that aren't finished yet. A paid invoice closes its
 * order (Invoiced → Closed). Batched: up to 50 invoices per call.
 */
export async function refreshFromXero(entityId: string, userId?: string | null) {
  const open = await db
    .select({ id: t.salesOrders.id, number: t.salesOrders.number, status: t.salesOrders.status, xeroInvoiceId: t.salesOrders.xeroInvoiceId })
    .from(t.salesOrders)
    .where(and(eq(t.salesOrders.entityId, entityId), isNotNull(t.salesOrders.xeroInvoiceId), or(isNull(t.salesOrders.xeroStatus), notInArray(t.salesOrders.xeroStatus, ["PAID", "VOIDED", "DELETED"]))));
  let updated = 0;
  let paid = 0;
  for (let i = 0; i < open.length; i += 50) {
    const batch = open.slice(i, i + 50);
    const { Invoices } = await xeroApi<{ Invoices: XInvoice[] }>(entityId, "GET", `/Invoices?IDs=${batch.map((b) => b.xeroInvoiceId).join(",")}&summaryOnly=true`);
    for (const inv of Invoices) {
      const o = batch.find((b) => b.xeroInvoiceId === inv.InvoiceID);
      if (!o) continue;
      const closes = inv.Status === "PAID" && o.status === "invoiced";
      await db
        .update(t.salesOrders)
        .set({
          xeroStatus: inv.Status,
          xeroAmountDue: String(inv.AmountDue ?? 0),
          xeroAmountPaid: String(inv.AmountPaid ?? 0),
          xeroSyncedAt: new Date(),
          ...(closes ? { status: "closed" as const } : {}),
        })
        .where(eq(t.salesOrders.id, o.id));
      if (closes) {
        paid++;
        await db.insert(t.auditLog).values({ entityId, userId: userId ?? null, tableName: "sales_orders", recordId: o.id, action: "order_status", changes: { number: o.number, status: { from: "invoiced", to: "closed" }, reason: "Paid in Xero" } });
      }
      updated++;
    }
  }
  const credits = await db
    .select({ id: t.salesReturns.id, xeroCreditNoteId: t.salesReturns.xeroCreditNoteId })
    .from(t.salesReturns)
    .where(and(eq(t.salesReturns.entityId, entityId), isNotNull(t.salesReturns.xeroCreditNoteId), or(isNull(t.salesReturns.xeroStatus), notInArray(t.salesReturns.xeroStatus, ["PAID", "VOIDED", "DELETED"]))));
  for (const c of credits) {
    const { CreditNotes } = await xeroApi<{ CreditNotes: XCreditNote[] }>(entityId, "GET", `/CreditNotes/${c.xeroCreditNoteId}`);
    if (CreditNotes[0]) {
      await db.update(t.salesReturns).set({ xeroStatus: CreditNotes[0].Status, xeroSyncedAt: new Date() }).where(eq(t.salesReturns.id, c.id));
      updated++;
    }
  }
  await log(entityId, "refresh", null, null, true, `Checked ${open.length} invoices and ${credits.length} credit notes; ${paid} newly paid (orders closed).`, userId);
  return { checked: open.length + credits.length, updated, paid };
}
