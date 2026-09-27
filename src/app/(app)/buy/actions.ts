"use server";

import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, t } from "@/db";
import { diff, formNumber, formText } from "@/lib/audit";
import { assertEntityAccess, getEntityContext } from "@/lib/dal";
import { dayStamp } from "@/lib/dates";
import { takeNumber } from "@/lib/numbering";
import { lineAmounts, orderTotals } from "@/lib/orders/calc";
import { receivedByLine } from "@/lib/purchasing/received";

export type ActionResult = { ok?: true; error?: string; id?: string };
export type FormState = { error?: string } | undefined;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date");
const optText = z.string().trim().max(2000).nullable().optional().transform((v) => (v ? v : null));

async function context() {
  const { user, entity } = await getEntityContext();
  await assertEntityAccess(user.id, entity.id);
  return { user, entity };
}

function revalidateBuy(id?: string) {
  revalidatePath("/buy/orders");
  revalidatePath("/buy/suppliers");
  revalidatePath("/stock/inventory");
  if (id) revalidatePath(`/buy/orders/${id}`);
}

// ---------------------------------------------------------------- suppliers

export async function saveSupplier(_: FormState, fd: FormData): Promise<FormState> {
  let savedId: string;
  try {
    const { user, entity } = await context();
    const id = formText(fd, "id");
    const name = formText(fd, "name", 200);
    if (!name) return { error: "Enter the supplier's name." };
    const lead = formNumber(fd, "leadTimeDays", "Lead time");
    const values = {
      name,
      contactName: formText(fd, "contactName"),
      phone: formText(fd, "phone"),
      email: formText(fd, "email"),
      leadTimeDays: lead === null ? null : Math.round(lead),
      paymentTerms: formText(fd, "paymentTerms"),
      notes: formText(fd, "notes", 5000),
      active: fd.get("active") === "on",
    };
    const [clash] = await db
      .select({ id: t.suppliers.id })
      .from(t.suppliers)
      .where(and(eq(t.suppliers.entityId, entity.id), sql`lower(${t.suppliers.name}) = lower(${name})`, id ? ne(t.suppliers.id, id) : sql`true`));
    if (clash) return { error: `There is already a supplier called "${name}".` };
    if (id) {
      const [before] = await db.select().from(t.suppliers).where(and(eq(t.suppliers.id, id), eq(t.suppliers.entityId, entity.id)));
      if (!before) return { error: "Supplier not found." };
      await db.update(t.suppliers).set(values).where(eq(t.suppliers.id, id));
      const changes = diff(before, values);
      if (Object.keys(changes).length)
        await db.insert(t.auditLog).values({ entityId: entity.id, userId: user.id, tableName: "suppliers", recordId: id, action: "update", changes });
      savedId = id;
    } else {
      const [s] = await db.insert(t.suppliers).values({ ...values, entityId: entity.id }).returning({ id: t.suppliers.id });
      await db.insert(t.auditLog).values({ entityId: entity.id, userId: user.id, tableName: "suppliers", recordId: s.id, action: "create", changes: { name } });
      savedId = s.id;
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't save the supplier." };
  }
  revalidatePath("/buy/suppliers");
  redirect(`/buy/suppliers/${savedId}`);
}

// ---------------------------------------------------------------- purchase orders

const POSchema = z.object({
  id: z.string().uuid().nullable(),
  title: optText,
  supplierId: z.string().uuid({ message: "Choose a supplier from the list" }),
  orderDate: isoDate,
  expectedOn: isoDate.nullable(),
  currency: z.string().trim().length(3, "Currency is a 3-letter code, e.g. NZD").toUpperCase(),
  fxRate: z.number().positive("Exchange rate must be more than 0"),
  notes: optText,
  lines: z
    .array(
      z.object({
        lineId: z.string().uuid().nullable().optional(),
        productId: z.string().uuid().nullable(),
        sku: optText,
        description: z.string().trim().min(1, "Every line needs an item or description").max(500),
        qty: z.number().finite().positive("Quantities must be more than 0"),
        unitPrice: z.number().finite().min(0, "Prices can't be negative"),
        taxRate: z.number().min(0).max(1),
      }),
    )
    .min(1, "Add at least one line"),
});
export type POInput = z.input<typeof POSchema>;

/** Create or update a purchase order (draft or open). Received lines can't drop below what arrived. */
export async function savePO(input: POInput): Promise<ActionResult> {
  try {
    const { user, entity } = await context();
    const parsed = POSchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const v = parsed.data;
    const [supplier] = await db.select({ id: t.suppliers.id }).from(t.suppliers).where(and(eq(t.suppliers.id, v.supplierId), eq(t.suppliers.entityId, entity.id)));
    if (!supplier) return { error: "That supplier isn't in this entity." };
    const productIds = [...new Set(v.lines.map((l) => l.productId).filter((x): x is string => !!x))];
    if (productIds.length) {
      const found = await db.select({ id: t.products.id }).from(t.products).where(and(eq(t.products.entityId, entity.id), inArray(t.products.id, productIds)));
      if (found.length !== productIds.length) return { error: "One of the items isn't in this entity's product list." };
    }
    const lines = v.lines.map((l) => ({ ...l, discountPct: 0 }));
    const totals = orderTotals(lines);
    const header = {
      title: v.title,
      supplierId: v.supplierId,
      orderDate: v.orderDate,
      expectedOn: v.expectedOn,
      currency: v.currency,
      fxRate: String(v.currency === entity.currency ? 1 : v.fxRate),
      notes: v.notes,
      subtotal: String(totals.subtotal),
      tax: String(totals.tax),
      total: String(totals.total),
    };
    const rows = (poId: string) =>
      lines.map((l, i) => {
        const a = lineAmounts(l);
        return {
          poId,
          lineNo: i + 1,
          productId: l.productId,
          sku: l.sku,
          description: l.description,
          qty: String(l.qty),
          unitPrice: String(l.unitPrice),
          taxRate: String(l.taxRate),
          lineSubtotal: String(a.subtotal),
          lineTax: String(a.tax),
        };
      });

    const receivedBefore = v.id ? await receivedByLine([v.id]) : new Map<string, number>();
    const id = await db.transaction(async (tx) => {
      if (v.id) {
        const [existing] = await tx.select().from(t.purchaseOrders).where(and(eq(t.purchaseOrders.id, v.id), eq(t.purchaseOrders.entityId, entity.id)));
        if (!existing) throw new Error("This purchase order no longer exists.");
        if (!["draft", "open"].includes(existing.status)) throw new Error(`A ${existing.status} purchase order can't be edited.`);
        await tx.update(t.purchaseOrders).set(header).where(eq(t.purchaseOrders.id, v.id));
        const existingLines = await tx.select().from(t.poLines).where(eq(t.poLines.poId, v.id));
        const newRows = rows(v.id);
        const keep = new Set<string>();
        for (const [i, l] of lines.entries()) {
          const match = l.lineId ? existingLines.find((x) => x.id === l.lineId) : undefined;
          if (match) {
            const got = receivedBefore.get(match.id) ?? 0;
            if (l.qty < got - 1e-9) throw new Error(`Line ${i + 1} (${l.description}) has already received ${got}; the quantity can't be lower.`);
            keep.add(match.id);
            await tx.update(t.poLines).set(newRows[i]).where(eq(t.poLines.id, match.id));
          } else {
            await tx.insert(t.poLines).values(newRows[i]);
          }
        }
        for (const old of existingLines.filter((x) => !keep.has(x.id))) {
          if ((receivedBefore.get(old.id) ?? 0) > 0) throw new Error(`"${old.description}" has been received, so it can't be removed.`);
          await tx.delete(t.poLines).where(eq(t.poLines.id, old.id));
        }
        await tx.insert(t.auditLog).values({
          entityId: entity.id,
          userId: user.id,
          tableName: "purchase_orders",
          recordId: v.id,
          action: "update",
          changes: { number: existing.number, total: { from: Number(existing.total), to: totals.total }, lines: lines.length },
        });
        return v.id;
      }
      const number = await takeNumber(tx, entity.id, "PO");
      const [po] = await tx
        .insert(t.purchaseOrders)
        .values({ ...header, entityId: entity.id, number, status: "draft", createdBy: user.id })
        .returning({ id: t.purchaseOrders.id });
      await tx.insert(t.poLines).values(rows(po.id));
      await tx.insert(t.auditLog).values({ entityId: entity.id, userId: user.id, tableName: "purchase_orders", recordId: po.id, action: "create", changes: { number, total: totals.total } });
      return po.id;
    });
    revalidateBuy(id);
    return { ok: true, id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't save the purchase order." };
  }
}

async function loadPO(id: string) {
  const { user, entity } = await context();
  const [po] = await db.select().from(t.purchaseOrders).where(and(eq(t.purchaseOrders.id, id), eq(t.purchaseOrders.entityId, entity.id)));
  if (!po) throw new Error("Purchase order not found.");
  return { user, entity, po };
}

async function audit(entityId: string, userId: string, recordId: string, action: string, changes: unknown) {
  await db.insert(t.auditLog).values({ entityId, userId, tableName: "purchase_orders", recordId, action, changes });
}

/** Draft -> open: the order has been sent to the supplier. */
export async function placePO(id: string): Promise<ActionResult> {
  try {
    const { user, entity, po } = await loadPO(id);
    if (po.status !== "draft") return { error: "Only a draft can be placed." };
    await db.update(t.purchaseOrders).set({ status: "open" }).where(eq(t.purchaseOrders.id, id));
    await audit(entity.id, user.id, id, "place", { number: po.number });
    revalidateBuy(id);
    return { ok: true, id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't place the order." };
  }
}

export async function cancelPO(id: string): Promise<ActionResult> {
  try {
    const { user, entity, po } = await loadPO(id);
    if (!["draft", "open"].includes(po.status)) return { error: `A ${po.status} purchase order can't be cancelled.` };
    const [live] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(t.goodsReceipts)
      .where(and(eq(t.goodsReceipts.poId, id), isNull(t.goodsReceipts.reversedAt)));
    if (live.n > 0) return { error: "Goods have been received on this order. Reverse the receipts first, or reduce the order to what arrived." };
    await db.update(t.purchaseOrders).set({ status: "cancelled" }).where(eq(t.purchaseOrders.id, id));
    await audit(entity.id, user.id, id, "cancel", { number: po.number });
    revalidateBuy(id);
    return { ok: true, id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't cancel the order." };
  }
}

/** Katana's Billing status: the supplier's invoice has been received / entered. */
export async function setBilled(id: string, billed: boolean): Promise<ActionResult> {
  try {
    const { user, entity, po } = await loadPO(id);
    await db.update(t.purchaseOrders).set({ billed }).where(eq(t.purchaseOrders.id, id));
    await audit(entity.id, user.id, id, billed ? "billed" : "unbilled", { number: po.number });
    revalidateBuy(id);
    return { ok: true, id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't update billing." };
  }
}

// ---------------------------------------------------------------- goods receipts

const ReceiptSchema = z.object({
  poId: z.string().uuid(),
  receivedOn: isoDate,
  supplierRef: optText,
  notes: optText,
  lines: z
    .array(
      z.object({
        poLineId: z.string().uuid(),
        qty: z.number().finite().positive(),
        batchNo: z.string().trim().max(100).nullable().transform((v) => (v ? v : null)),
      }),
    )
    .min(1, "Enter a received quantity on at least one line"),
});
export type ReceiptInput = z.input<typeof ReceiptSchema>;

/** Records goods arriving: adds them to stock at the PO price (in the entity's currency), with batch numbers. */
export async function createReceipt(input: ReceiptInput): Promise<ActionResult> {
  try {
    const parsed = ReceiptSchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const v = parsed.data;
    const { user, entity, po } = await loadPO(v.poId);
    if (po.status !== "open") return { error: po.status === "draft" ? "Place the order before receiving against it." : `A ${po.status} purchase order can't be received.` };
    const received = await receivedByLine([v.poId]);
    await db.transaction(async (tx) => {
      const lines = await tx
        .select({ l: t.poLines, trackStock: t.products.trackStock })
        .from(t.poLines)
        .leftJoin(t.products, eq(t.products.id, t.poLines.productId))
        .where(eq(t.poLines.poId, v.poId));
      const incoming = new Map<string, number>();
      for (const r of v.lines) {
        if (!lines.some((x) => x.l.id === r.poLineId)) throw new Error("A receipt line doesn't belong to this purchase order.");
        incoming.set(r.poLineId, (incoming.get(r.poLineId) ?? 0) + r.qty);
      }
      for (const [lineId, q] of incoming) {
        const line = lines.find((x) => x.l.id === lineId)!;
        const outstanding = Number(line.l.qty) - (received.get(lineId) ?? 0);
        if (q > outstanding + 1e-9) throw new Error(`Line ${line.l.lineNo} (${line.l.description}): only ${outstanding} still to come, not ${q}.`);
      }
      const [{ next }] = await tx
        .select({ next: sql<number>`coalesce(max(${t.goodsReceipts.seq}), 0)::int + 1` })
        .from(t.goodsReceipts)
        .where(eq(t.goodsReceipts.poId, v.poId));
      const ref = `${po.number}/${next}`;
      const [receipt] = await tx
        .insert(t.goodsReceipts)
        .values({ entityId: entity.id, poId: v.poId, seq: next, receivedOn: v.receivedOn, supplierRef: v.supplierRef, notes: v.notes, createdBy: user.id })
        .returning({ id: t.goodsReceipts.id });
      const fx = Number(po.fxRate);
      const withCost = v.lines.map((r) => {
        const line = lines.find((x) => x.l.id === r.poLineId)!;
        return { r, line, unitCost: Math.round(Number(line.l.unitPrice) * fx * 10000) / 10000 };
      });
      await tx.insert(t.goodsReceiptLines).values(
        withCost.map(({ r, line, unitCost }) => ({ receiptId: receipt.id, poLineId: r.poLineId, productId: line.l.productId, qty: String(r.qty), unitCost: String(unitCost), batchNo: r.batchNo })),
      );
      const moves = withCost
        .filter(({ line }) => line.l.productId && line.trackStock)
        .map(({ r, line, unitCost }) => ({
          entityId: entity.id,
          productId: line.l.productId!,
          kind: "receipt" as const,
          qty: String(r.qty),
          unitCost: String(unitCost),
          batchNo: r.batchNo,
          refType: "purchase_order",
          refId: v.poId,
          refNumber: ref,
          occurredAt: dayStamp(v.receivedOn),
          createdBy: user.id,
          note: `Received on ${ref}${v.supplierRef ? ` (supplier ref ${v.supplierRef})` : ""}`,
        }));
      if (moves.length) await tx.insert(t.stockMovements).values(moves);
      const allIn = lines.every((x) => (received.get(x.l.id) ?? 0) + (incoming.get(x.l.id) ?? 0) >= Number(x.l.qty) - 1e-9);
      if (allIn) await tx.update(t.purchaseOrders).set({ status: "received" }).where(eq(t.purchaseOrders.id, v.poId));
      await tx.insert(t.auditLog).values({
        entityId: entity.id,
        userId: user.id,
        tableName: "goods_receipts",
        recordId: receipt.id,
        action: "create",
        changes: { receipt: ref, lines: v.lines, poStatus: allIn ? "received" : "open" },
      });
    });
    revalidateBuy(v.poId);
    revalidatePath("/stock/batches");
    return { ok: true, id: v.poId };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't record the receipt." };
  }
}

/** Undo a receipt: takes the stock back out with opposite movements and reopens the PO if needed. */
export async function reverseReceipt(receiptId: string): Promise<ActionResult> {
  try {
    const { user, entity } = await context();
    const [row] = await db
      .select({ r: t.goodsReceipts, po: t.purchaseOrders })
      .from(t.goodsReceipts)
      .innerJoin(t.purchaseOrders, eq(t.purchaseOrders.id, t.goodsReceipts.poId))
      .where(and(eq(t.goodsReceipts.id, receiptId), eq(t.goodsReceipts.entityId, entity.id)));
    if (!row) return { error: "Receipt not found." };
    if (row.r.reversedAt) return { error: "This receipt has already been reversed." };
    const ref = `${row.po.number}/${row.r.seq}`;
    await db.transaction(async (tx) => {
      const original = await tx
        .select()
        .from(t.stockMovements)
        .where(and(eq(t.stockMovements.refId, row.po.id), eq(t.stockMovements.refNumber, ref), eq(t.stockMovements.kind, "receipt")));
      if (original.length)
        await tx.insert(t.stockMovements).values(
          original.map((m) => ({
            entityId: m.entityId,
            productId: m.productId,
            kind: "receipt" as const,
            qty: String(-Number(m.qty)),
            unitCost: m.unitCost,
            batchNo: m.batchNo,
            refType: "purchase_order",
            refId: row.po.id,
            refNumber: `${ref} reversed`,
            createdBy: user.id,
            note: `Reversal of receipt ${ref}`,
          })),
        );
      await tx.update(t.goodsReceipts).set({ reversedAt: new Date(), reversedBy: user.id }).where(eq(t.goodsReceipts.id, receiptId));
      if (row.po.status === "received") await tx.update(t.purchaseOrders).set({ status: "open" }).where(eq(t.purchaseOrders.id, row.po.id));
      await tx.insert(t.auditLog).values({ entityId: entity.id, userId: user.id, tableName: "goods_receipts", recordId: receiptId, action: "reverse", changes: { receipt: ref } });
    });
    revalidateBuy(row.po.id);
    return { ok: true, id: row.po.id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't reverse the receipt." };
  }
}
