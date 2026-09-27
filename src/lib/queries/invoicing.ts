import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, t } from "@/db";
import type { InvoiceOrder } from "@/lib/invoicing/xero";

/** Credited returns (entity-checked) as Xero credit notes, numbered with the return number, in the order given. */
export async function creditNotes(entityId: string, ids: string[]): Promise<InvoiceOrder[]> {
  if (!ids.length) return [];
  const [returns, lines] = await Promise.all([
    db
      .select({ r: t.salesReturns, c: t.customers, so: t.salesOrders.number, ref: t.salesOrders.customerReference })
      .from(t.salesReturns)
      .innerJoin(t.customers, eq(t.customers.id, t.salesReturns.customerId))
      .innerJoin(t.salesOrders, eq(t.salesOrders.id, t.salesReturns.orderId))
      .where(and(eq(t.salesReturns.entityId, entityId), inArray(t.salesReturns.id, ids))),
    db.select().from(t.returnLines).where(inArray(t.returnLines.returnId, ids)).orderBy(asc(t.returnLines.lineNo)),
  ]);
  const byId = new Map(returns.map((x) => [x.r.id, x]));
  return ids
    .map((id) => byId.get(id))
    .filter((x): x is NonNullable<typeof x> => !!x && !!x.r.creditedOn)
    .map(({ r, c, so, ref }) => ({
      credit: true,
      number: r.number,
      reference: `Return on ${so}${ref ? ` (${ref})` : ""}`,
      currency: r.currency,
      invoicedOn: r.creditedOn!,
      invoiceDueOn: r.creditedOn!,
      customer: {
        name: c.name,
        email: c.email,
        line1: c.billingLine1,
        line2: c.billingLine2,
        city: c.billingCity,
        region: c.billingRegion,
        postcode: c.billingPostcode,
        country: c.billingCountry,
      },
      lines: lines
        .filter((l) => l.returnId === r.id)
        .map((l) => ({ sku: l.sku, description: l.description, qty: Number(l.qty), unitPrice: Number(l.unitPrice), discountPct: 0, taxRate: Number(l.taxRate) })),
    }));
}

/** Invoiced orders (entity-checked) in the shape the Xero CSV needs, in the order given. */
export async function invoiceOrders(entityId: string, ids: string[]): Promise<InvoiceOrder[]> {
  if (!ids.length) return [];
  const [orders, lines] = await Promise.all([
    db
      .select({ o: t.salesOrders, c: t.customers })
      .from(t.salesOrders)
      .innerJoin(t.customers, eq(t.customers.id, t.salesOrders.customerId))
      .where(and(eq(t.salesOrders.entityId, entityId), inArray(t.salesOrders.id, ids))),
    db.select().from(t.orderLines).where(inArray(t.orderLines.orderId, ids)).orderBy(asc(t.orderLines.lineNo)),
  ]);
  const byId = new Map(orders.map((r) => [r.o.id, r]));
  return ids
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => !!r && !!r.o.invoicedOn)
    .map(({ o, c }) => ({
      number: o.number,
      reference: o.customerReference || o.title,
      currency: o.currency,
      invoicedOn: o.invoicedOn!,
      invoiceDueOn: o.invoiceDueOn ?? o.invoicedOn!,
      customer: {
        name: c.name,
        email: c.email,
        line1: c.billingLine1,
        line2: c.billingLine2,
        city: c.billingCity,
        region: c.billingRegion,
        postcode: c.billingPostcode,
        country: c.billingCountry,
      },
      lines: lines
        .filter((l) => l.orderId === o.id)
        .map((l) => ({ sku: l.sku, description: l.description, qty: Number(l.qty), unitPrice: Number(l.unitPrice), discountPct: Number(l.discountPct), taxRate: Number(l.taxRate) })),
    }));
}
