"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, t } from "@/db";
import { assertEntityAccess, getEntityContext } from "@/lib/dal";
import { takeNumber } from "@/lib/numbering";
import { lineAmounts, orderTotals } from "@/lib/orders/calc";

export type ActionResult = { ok?: true; error?: string; id?: string };

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date");
const optText = z.string().trim().max(2000).nullable().transform((v) => (v ? v : null));

const LineSchema = z.object({
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
    .select({ id: t.customers.id })
    .from(t.customers)
    .where(and(eq(t.customers.id, v.customerId), eq(t.customers.entityId, entity.id)));
  if (!customer) return { error: "That customer isn't in this entity's customer list." };

  const productIds = [...new Set(v.lines.map((l) => l.productId).filter((x): x is string => !!x))];
  if (productIds.length) {
    const found = await db
      .select({ id: t.products.id })
      .from(t.products)
      .where(and(eq(t.products.entityId, entity.id), inArray(t.products.id, productIds)));
    if (found.length !== productIds.length) return { error: "One of the products isn't in this entity's product list." };
  }

  const totals = orderTotals(v.lines);
  const header = {
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
        await tx.delete(t.orderLines).where(eq(t.orderLines.orderId, v.id));
        await tx.insert(t.orderLines).values(lineRows(v.id));
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
const TRANSITIONS: Record<string, OrderStatus[]> = {
  open: ["picked", "shipped", "cancelled"],
  picked: ["open", "shipped", "cancelled"],
  shipped: ["invoiced"],
  invoiced: ["closed"],
};

/**
 * Sales order status. Shipping takes the goods out of stock: one "shipment" stock movement per stock-tracked line.
 */
export async function setOrderStatus(id: string, to: OrderStatus): Promise<ActionResult> {
  try {
    const { user, entity, order } = await loadForAction(id);
    if (!(TRANSITIONS[order.status] ?? []).includes(to))
      return { error: `A ${order.status} order can't be moved to ${to}.` };
    await db.transaction(async (tx) => {
      if (to === "shipped") {
        const lines = await tx
          .select({ l: t.orderLines, trackStock: t.products.trackStock, cost: t.products.standardCost })
          .from(t.orderLines)
          .innerJoin(t.products, eq(t.products.id, t.orderLines.productId))
          .where(eq(t.orderLines.orderId, id));
        const moves = lines
          .filter((x) => x.trackStock)
          .map((x) => ({
            entityId: entity.id,
            productId: x.l.productId!,
            kind: "shipment" as const,
            qty: String(-Number(x.l.qty)),
            unitCost: x.cost,
            refType: "sales_order",
            refId: id,
            refNumber: order.number,
            createdBy: user.id,
            note: `Shipped on ${order.number}`,
          }));
        if (moves.length) await tx.insert(t.stockMovements).values(moves);
      }
      await tx.update(t.salesOrders).set({ status: to }).where(eq(t.salesOrders.id, id));
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
