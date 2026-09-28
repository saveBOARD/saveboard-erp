"use server";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, t } from "@/db";
import { assertEntityAccess, getEntityContext } from "@/lib/dal";
import { dayStamp } from "@/lib/dates";
import { dueDate } from "@/lib/invoicing/xero";
import { entityToday } from "@/lib/queries/stock-items";
import { takeNumber } from "@/lib/numbering";
import { lineAmounts, orderTotals } from "@/lib/orders/calc";
import { shippedByLine } from "@/lib/orders/shipped";

export type ActionResult = { ok?: true; error?: string; id?: string };

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date");
const optText = z.string().trim().max(2000).nullable().transform((v) => (v ? v : null));

const LineSchema = z.object({
  lineId: z.string().uuid().nullable().optional(), // existing line (kept so shipments stay linked)
  productId: z.string().uuid().nullable(),
  sku: optText,
  description: z.string().trim().min(1, "Every line needs an item or description").max(500),
  qty: z.number().finite().positive("Quantities must be more than 0"),
  unitPrice: z.number().finite().min(0, "Prices can't be negative"),
  discountPct: z.number().min(0).max(1),
  taxRate: z.number().min(0).max(1),
});

const OrderSchema = z.object({
  id: z.string().uuid().nullable(),
  kind: z.enum(["quote", "order"]),
  title: optText,
  customerId: z.string().uuid({ message: "Choose a customer from the list" }),
  customerReference: optText,
  orderDate: isoDate,
  deliveryDeadline: isoDate.nullable(),
  quoteExpiresOn: isoDate.nullable(),
  shipToName: optText,
  shipToPhone: optText,
  shipToLine1: optText,
  shipToLine2: optText,
  shipToCity: optText,
  shipToRegion: optText,
  shipToPostcode: optText,
  shipToCountry: optText,
  notes: optText,
  priceListId: z.string().uuid().nullable().optional(),
  lines: z.array(LineSchema).min(1, "Add at least one line"),
});
export type OrderInput = z.input<typeof OrderSchema>;

const EDITABLE = ["quote", "open", "picked"] as const;

function revalidateSales(id?: string) {
  revalidatePath("/sell/quotes");
  revalidatePath("/sell/orders");
  revalidatePath("/stock/inventory");
  if (id) {
    revalidatePath(`/sell/quotes/${id}`);
    revalidatePath(`/sell/orders/${id}`);
  }
}

/** Create or update a quote / sales order. Totals are always recalculated here, never trusted from the browser. */
export async function saveOrder(input: OrderInput): Promise<ActionResult> {
  const { user, entity } = await getEntityContext();
  await assertEntityAccess(user.id, entity.id);
  const parsed = OrderSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;

  const [customer] = await db
    .select({ id: t.customers.id, name: t.customers.name, creditHold: t.customers.creditHold })
    .from(t.customers)
    .where(and(eq(t.customers.id, v.customerId), eq(t.customers.entityId, entity.id)));
  if (!customer) return { error: "That customer isn't in this entity's customer list." };
  if (v.kind === "order" && !v.id && customer.creditHold)
    return { error: `${customer.name} is on credit hold, so a new sales order can't be created. Save it as a quote, or release the hold on the customer first.` };

  const productIds = [...new Set(v.lines.map((l) => l.productId).filter((x): x is string => !!x))];
  if (productIds.length) {
    const found = await db
      .select({ id: t.products.id })
      .from(t.products)
      .where(and(eq(t.products.entityId, entity.id), inArray(t.products.id, productIds)));
    if (found.length !== productIds.length) return { error: "One of the products isn't in this entity's product list." };
  }
  if (v.priceListId) {
    const [pl] = await db
      .select({ id: t.priceLists.id })
      .from(t.priceLists)
      .where(and(eq(t.priceLists.id, v.priceListId), eq(t.priceLists.entityId, entity.id)));
    if (!pl) return { error: "That price list isn't in this entity." };
  }

  const totals = orderTotals(v.lines);
  const header = {
    priceListId: v.priceListId ?? null,
    title: v.title,
    customerId: v.customerId,
    customerReference: v.customerReference,
    orderDate: v.orderDate,
    deliveryDeadline: v.deliveryDeadline,
    quoteExpiresOn: v.kind === "quote" ? v.quoteExpiresOn : null,
    shipToName: v.shipToName,
    shipToPhone: v.shipToPhone,
    shipToLine1: v.shipToLine1,
    shipToLine2: v.shipToLine2,
    shipToCity: v.shipToCity,
    shipToRegion: v.shipToRegion,
    shipToPostcode: v.shipToPostcode,
    shipToCountry: v.shipToCountry,
    notes: v.notes,
    subtotal: String(totals.subtotal),
    tax: String(totals.tax),
    total: String(totals.total),
  };
  const lineRows = (orderId: string) =>
    v.lines.map((l, i) => {
      const a = lineAmounts(l);
      return {
        orderId,
        lineNo: i + 1,
        productId: l.productId,
        sku: l.sku,
        description: l.description,
        qty: String(l.qty),
        unitPrice: String(l.unitPrice),
        discountPct: String(l.discountPct),
        taxRate: String(l.taxRate),
        lineSubtotal: String(a.subtotal),
        lineTax: String(a.tax),
      };
    });

  try {
    const shippedBefore = v.id ? await shippedByLine([v.id]) : new Map<string, number>();
    const id = await db.transaction(async (tx) => {
      if (v.id) {
        const [existing] = await tx
          .select()
          .from(t.salesOrders)
          .where(and(eq(t.salesOrders.id, v.id), eq(t.salesOrders.entityId, entity.id)));
        if (!existing) throw new Error("This order no longer exists.");
        if (!(EDITABLE as readonly string[]).includes(existing.status))
          throw new Error(`A ${existing.status} order can't be edited.`);
        await tx.update(t.salesOrders).set(header).where(eq(t.salesOrders.id, v.id));
        // Update lines in place (shipments point at them); add new ones; remove dropped ones unless shipped.
        const existingLines = await tx.select().from(t.orderLines).where(eq(t.orderLines.orderId, v.id));
        const shipped = shippedBefore;
        const rows = lineRows(v.id);
        const keep = new Set<string>();
        for (const [i, l] of v.lines.entries()) {
          const match = l.lineId ? existingLines.find((x) => x.id === l.lineId) : undefined;
          if (match) {
            const sent = shipped.get(match.id) ?? 0;
            if (l.qty < sent - 1e-9) throw new Error(`Line ${i + 1} (${l.description}) has already shipped ${sent}; the quantity can't be lower than that.`);
            keep.add(match.id);
            await tx.update(t.orderLines).set(rows[i]).where(eq(t.orderLines.id, match.id));
          } else {
            await tx.insert(t.orderLines).values(rows[i]);
          }
        }
        for (const old of existingLines.filter((x) => !keep.has(x.id))) {
          if ((shipped.get(old.id) ?? 0) > 0) throw new Error(`"${old.description}" has already been shipped, so it can't be removed.`);
          await tx.delete(t.orderLines).where(eq(t.orderLines.id, old.id));
        }
        await tx.insert(t.auditLog).values({
          entityId: entity.id,
          userId: user.id,
          tableName: "sales_orders",
          recordId: v.id,
          action: "update",
          changes: { number: existing.number, total: { from: Number(existing.total), to: totals.total }, lines: v.lines.length },
        });
        return v.id;
      }
      const number = await takeNumber(tx, entity.id, "SO");
      const [created] = await tx
        .insert(t.salesOrders)
        .values({
          ...header,
          entityId: entity.id,
          number,
          status: v.kind === "quote" ? "quote" : "open",
          quoteStatus: v.kind === "quote" ? "draft" : null,
          currency: entity.currency,
          source: "app",
          createdBy: user.id,
        })
        .returning({ id: t.salesOrders.id });
      await tx.insert(t.orderLines).values(lineRows(created.id));
      await tx.insert(t.auditLog).values({
        entityId: entity.id,
        userId: user.id,
        tableName: "sales_orders",
        recordId: created.id,
        action: "create",
        changes: { number, kind: v.kind, total: totals.total, lines: v.lines.length },
      });
      return created.id;
    });
    revalidateSales(id);
    return { ok: true, id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't save." };
  }
}

async function loadForAction(id: string) {
  const { user, entity } = await getEntityContext();
  await assertEntityAccess(user.id, entity.id);
  const [order] = await db
    .select()
    .from(t.salesOrders)
    .where(and(eq(t.salesOrders.id, id), eq(t.salesOrders.entityId, entity.id)));
  if (!order) throw new Error("Order not found.");
  return { user, entity, order };
}

/** Quote lifecycle: draft -> sent -> declined / expired (or back to sent). Acceptance happens by converting. */
export async function setQuoteStatus(id: string, to: "draft" | "sent" | "declined" | "expired"): Promise<ActionResult> {
  try {
    const { user, entity, order } = await loadForAction(id);
    if (order.status !== "quote") return { error: "This is no longer a quote." };
    await db.transaction(async (tx) => {
      await tx.update(t.salesOrders).set({ quoteStatus: to }).where(eq(t.salesOrders.id, id));
      await tx.insert(t.auditLog).values({
        entityId: entity.id,
        userId: user.id,
        tableName: "sales_orders",
        recordId: id,
        action: "quote_status",
        changes: { number: order.number, quoteStatus: { from: order.quoteStatus, to } },
      });
    });
    revalidateSales(id);
    return { ok: true, id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't update the quote." };
  }
}

/** One click: the quote becomes an open sales order, keeping its number and every line. */
export async function convertToOrder(id: string): Promise<ActionResult> {
  try {
    const { user, entity, order } = await loadForAction(id);
    if (order.status !== "quote") return { error: "This quote has already been converted." };
    const [customer] = await db
      .select({ name: t.customers.name, creditHold: t.customers.creditHold })
      .from(t.customers)
      .where(eq(t.customers.id, order.customerId));
    if (customer?.creditHold)
      return { error: `${customer.name} is on credit hold. Release the hold on the customer before converting this quote to an order.` };
    await db.transaction(async (tx) => {
      await tx.update(t.salesOrders).set({ status: "open", quoteStatus: "accepted" }).where(eq(t.salesOrders.id, id));
      await tx.insert(t.auditLog).values({
        entityId: entity.id,
        userId: user.id,
        tableName: "sales_orders",
        recordId: id,
        action: "convert_to_order",
        changes: { number: order.number, status: { from: "quote", to: "open" } },
      });
    });
    revalidateSales(id);
    return { ok: true, id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't convert the quote." };
  }
}

type OrderStatus = (typeof t.orderStatus.enumValues)[number];
// "shipped" is reached by recording shipments (createShipment), never set directly.
const TRANSITIONS: Record<string, OrderStatus[]> = {
  open: ["picked", "cancelled"],
  picked: ["open", "cancelled"],
  shipped: ["invoiced"],
  invoiced: ["closed"],
};

/** Sales order status changes that don't move stock: picked, back to open, cancelled, invoiced, closed. */
export async function setOrderStatus(id: string, to: OrderStatus): Promise<ActionResult> {
  try {
    const { user, entity, order } = await loadForAction(id);
    if (!(TRANSITIONS[order.status] ?? []).includes(to))
      return { error: `A ${order.status} order can't be moved to ${to}.` };
    if (to === "cancelled") {
      const [live] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(t.shipments)
        .where(and(eq(t.shipments.orderId, id), isNull(t.shipments.reversedAt)));
      if (live.n > 0) return { error: "Part of this order has shipped. Reverse those shipments first, or reduce the order to what was sent." };
    }
    let dates = {};
    if (to === "invoiced") {
      const [c] = await db.select({ terms: t.customers.paymentTerms }).from(t.customers).where(eq(t.customers.id, order.customerId));
      const today = entityToday(entity.id);
      dates = { invoicedOn: today, invoiceDueOn: dueDate(today, c?.terms) };
    }
    await db.transaction(async (tx) => {
      await tx.update(t.salesOrders).set({ status: to, ...dates }).where(eq(t.salesOrders.id, id));
      await tx.insert(t.auditLog).values({
        entityId: entity.id,
        userId: user.id,
        tableName: "sales_orders",
        recordId: id,
        action: "order_status",
        changes: { number: order.number, status: { from: order.status, to } },
      });
    });
    revalidateSales(id);
    return { ok: true, id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't update the order." };
  }
}

const ShipmentSchema = z.object({
  orderId: z.string().uuid(),
  shippedOn: isoDate,
  carrier: optText,
  consignmentNo: optText,
  notes: optText,
  lines: z
    .array(
      z.object({
        orderLineId: z.string().uuid(),
        qty: z.number().finite().positive(),
        batchNo: z.string().trim().max(100).nullable().transform((v) => (v ? v : null)),
      }),
    )
    .min(1, "Enter a quantity to ship on at least one line"),
});
export type ShipmentInput = z.input<typeof ShipmentSchema>;

/**
 * Records a (possibly partial) shipment: takes the shipped quantities out of stock with their batch numbers,
 * and marks the order Shipped once every line has gone.
 */
export async function createShipment(input: ShipmentInput): Promise<ActionResult> {
  try {
    const parsed = ShipmentSchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const v = parsed.data;
    const { user, entity, order } = await loadForAction(v.orderId);
    if (!["open", "picked"].includes(order.status)) return { error: `A ${order.status} order can't be shipped.` };

    const shipped = await shippedByLine([v.orderId]);
    await db.transaction(async (tx) => {
      const lines = await tx
        .select({ l: t.orderLines, trackStock: t.products.trackStock, cost: t.products.standardCost })
        .from(t.orderLines)
        .leftJoin(t.products, eq(t.products.id, t.orderLines.productId))
        .where(eq(t.orderLines.orderId, v.orderId));
      const sending = new Map<string, number>();
      for (const s of v.lines) {
        const line = lines.find((x) => x.l.id === s.orderLineId);
        if (!line) throw new Error("A shipment line doesn't belong to this order.");
        sending.set(s.orderLineId, (sending.get(s.orderLineId) ?? 0) + s.qty);
      }
      for (const [lineId, qty] of sending) {
        const line = lines.find((x) => x.l.id === lineId)!;
        const outstanding = Number(line.l.qty) - (shipped.get(lineId) ?? 0);
        if (qty > outstanding + 1e-9)
          throw new Error(`Line ${line.l.lineNo} (${line.l.description}): only ${outstanding} left to ship, not ${qty}.`);
      }

      const [{ next }] = await tx
        .select({ next: sql<number>`coalesce(max(${t.shipments.seq}), 0)::int + 1` })
        .from(t.shipments)
        .where(eq(t.shipments.orderId, v.orderId));
      const ref = `${order.number}/${next}`;
      const [shipment] = await tx
        .insert(t.shipments)
        .values({ entityId: entity.id, orderId: v.orderId, seq: next, shippedOn: v.shippedOn, carrier: v.carrier, consignmentNo: v.consignmentNo, notes: v.notes, createdBy: user.id })
        .returning({ id: t.shipments.id });
      await tx.insert(t.shipmentLines).values(
        v.lines.map((s) => ({
          shipmentId: shipment.id,
          orderLineId: s.orderLineId,
          productId: lines.find((x) => x.l.id === s.orderLineId)!.l.productId,
          qty: String(s.qty),
          batchNo: s.batchNo,
        })),
      );
      const moves = v.lines
        .map((s) => ({ s, line: lines.find((x) => x.l.id === s.orderLineId)! }))
        .filter(({ line }) => line.l.productId && line.trackStock)
        .map(({ s, line }) => ({
          entityId: entity.id,
          productId: line.l.productId!,
          kind: "shipment" as const,
          qty: String(-s.qty),
          unitCost: line.cost,
          batchNo: s.batchNo,
          refType: "sales_order",
          refId: v.orderId,
          refNumber: ref,
          occurredAt: dayStamp(v.shippedOn),
          createdBy: user.id,
          note: `Shipped on ${ref}`,
        }));
      if (moves.length) await tx.insert(t.stockMovements).values(moves);

      const allSent = lines.every((x) => (shipped.get(x.l.id) ?? 0) + (sending.get(x.l.id) ?? 0) >= Number(x.l.qty) - 1e-9);
      if (allSent) await tx.update(t.salesOrders).set({ status: "shipped" }).where(eq(t.salesOrders.id, v.orderId));
      await tx.insert(t.auditLog).values({
        entityId: entity.id,
        userId: user.id,
        tableName: "shipments",
        recordId: shipment.id,
        action: "create",
        changes: { shipment: ref, lines: v.lines, orderStatus: allSent ? "shipped" : order.status },
      });
    });
    revalidateSales(v.orderId);
    revalidatePath("/stock/batches");
    return { ok: true, id: v.orderId };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't record the shipment." };
  }
}

/**
 * Undoes a shipment: puts the stock back with reversing movements (nothing is deleted) and reopens the order
 * if it had been marked Shipped. Not allowed once the order is invoiced.
 */
export async function reverseShipment(shipmentId: string): Promise<ActionResult> {
  try {
    const { user, entity } = await getEntityContext();
    await assertEntityAccess(user.id, entity.id);
    const [s] = await db
      .select({ s: t.shipments, order: t.salesOrders })
      .from(t.shipments)
      .innerJoin(t.salesOrders, eq(t.salesOrders.id, t.shipments.orderId))
      .where(and(eq(t.shipments.id, shipmentId), eq(t.shipments.entityId, entity.id)));
    if (!s) return { error: "Shipment not found." };
    if (s.s.reversedAt) return { error: "This shipment has already been reversed." };
    if (!["open", "picked", "shipped"].includes(s.order.status)) return { error: `The order is ${s.order.status}, so its shipments can't be reversed.` };
    const ref = `${s.order.number}/${s.s.seq}`;
    await db.transaction(async (tx) => {
      const original = await tx
        .select()
        .from(t.stockMovements)
        .where(and(eq(t.stockMovements.refId, s.order.id), eq(t.stockMovements.refNumber, ref), eq(t.stockMovements.kind, "shipment")));
      if (original.length)
        await tx.insert(t.stockMovements).values(
          original.map((m) => ({
            entityId: m.entityId,
            productId: m.productId,
            kind: "shipment" as const,
            qty: String(-Number(m.qty)),
            unitCost: m.unitCost,
            batchNo: m.batchNo,
            refType: "sales_order",
            refId: s.order.id,
            refNumber: `${ref} reversed`,
            createdBy: user.id,
            note: `Reversal of shipment ${ref}`,
          })),
        );
      await tx.update(t.shipments).set({ reversedAt: new Date(), reversedBy: user.id }).where(eq(t.shipments.id, shipmentId));
      if (s.order.status === "shipped") await tx.update(t.salesOrders).set({ status: "open" }).where(eq(t.salesOrders.id, s.order.id));
      await tx.insert(t.auditLog).values({
        entityId: entity.id,
        userId: user.id,
        tableName: "shipments",
        recordId: shipmentId,
        action: "reverse",
        changes: { shipment: ref, orderStatus: s.order.status === "shipped" ? { from: "shipped", to: "open" } : s.order.status },
      });
    });
    revalidateSales(s.order.id);
    return { ok: true, id: s.order.id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't reverse the shipment." };
  }
}
