"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, t } from "@/db";
import { assertEntityAccess, getEntityContext } from "@/lib/dal";
import { dayStamp } from "@/lib/dates";
import { takeNumber } from "@/lib/numbering";

export type ActionResult = { ok?: true; error?: string; id?: string };
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date");
const optText = z.string().trim().max(2000).nullable().optional().transform((v) => (v ? v : null));
const r4 = (n: number) => Math.round(n * 10000) / 10000;

async function context() {
  const { user, entity } = await getEntityContext();
  await assertEntityAccess(user.id, entity.id);
  return { user, entity };
}

function revalidateMake(id?: string) {
  revalidatePath("/make/orders");
  revalidatePath("/make/schedule");
  revalidatePath("/stock/inventory");
  revalidatePath("/sell/orders");
  if (id) revalidatePath(`/make/orders/${id}`);
}

async function productsInEntity(entityId: string, ids: string[]) {
  if (!ids.length) return new Map<string, { cost: number; trackStock: boolean; sku: string }>();
  const rows = await db
    .select({ id: t.products.id, cost: t.products.standardCost, trackStock: t.products.trackStock, sku: t.products.sku })
    .from(t.products)
    .where(and(eq(t.products.entityId, entityId), inArray(t.products.id, ids)));
  if (rows.length !== new Set(ids).size) throw new Error("One of the items isn't in this entity's product list.");
  return new Map(rows.map((r) => [r.id, { cost: Number(r.cost), trackStock: r.trackStock, sku: r.sku }]));
}

// ---------------------------------------------------------------- recipes

const RecipeSchema = z.object({
  productId: z.string().uuid(),
  lines: z.array(z.object({ ingredientId: z.string().uuid({ message: "Pick each material from the list" }), qtyPerUnit: z.number().positive("Quantities must be more than 0"), note: optText })),
  operations: z.array(z.object({ name: z.string().trim().min(1, "Name each operation").max(200), hoursPerUnit: z.number().min(0), costPerHour: z.number().min(0) })),
});
export type RecipeInput = z.input<typeof RecipeSchema>;

/** Replace a product's recipe (materials per unit) and operations. */
export async function saveRecipe(input: RecipeInput): Promise<ActionResult> {
  try {
    const { user, entity } = await context();
    const parsed = RecipeSchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const v = parsed.data;
    await productsInEntity(entity.id, [v.productId, ...v.lines.map((l) => l.ingredientId)]);
    if (v.lines.some((l) => l.ingredientId === v.productId)) return { error: "A product can't be an ingredient of itself." };
    await db.transaction(async (tx) => {
      await tx.delete(t.recipeLines).where(eq(t.recipeLines.productId, v.productId));
      await tx.delete(t.recipeOperations).where(eq(t.recipeOperations.productId, v.productId));
      if (v.lines.length)
        await tx.insert(t.recipeLines).values(v.lines.map((l, i) => ({ productId: v.productId, ingredientId: l.ingredientId, qtyPerUnit: String(l.qtyPerUnit), note: l.note, sortOrder: i })));
      if (v.operations.length)
        await tx.insert(t.recipeOperations).values(
          v.operations.map((o, i) => ({ productId: v.productId, name: o.name, hoursPerUnit: String(o.hoursPerUnit), costPerHour: String(o.costPerHour), sortOrder: i })),
        );
      await tx.insert(t.auditLog).values({
        entityId: entity.id,
        userId: user.id,
        tableName: "recipe_lines",
        recordId: v.productId,
        action: "replace",
        changes: { materials: v.lines.length, operations: v.operations.length },
      });
    });
    revalidatePath("/items/recipes");
    revalidatePath(`/items/products/${v.productId}`);
    return { ok: true, id: v.productId };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't save the recipe." };
  }
}

// ---------------------------------------------------------------- manufacturing orders

const MOSchema = z.object({
  id: z.string().uuid().nullable(),
  productId: z.string().uuid({ message: "Choose the product to make" }),
  plannedQty: z.number().positive("Planned quantity must be more than 0"),
  productionDeadline: isoDate.nullable(),
  deliveryDeadline: isoDate.nullable(),
  salesOrderId: z.string().uuid().nullable(),
  notes: optText,
  materials: z.array(z.object({ productId: z.string().uuid({ message: "Pick each material from the list" }), plannedQty: z.number().positive("Material quantities must be more than 0"), note: optText })),
  operations: z.array(z.object({ name: z.string().trim().min(1, "Name each operation").max(200), plannedHours: z.number().min(0), costPerHour: z.number().min(0) })),
});
export type MOInput = z.input<typeof MOSchema>;

/** Create or edit a manufacturing order (not once it's done). Planned costs use standard costs. */
export async function saveMO(input: MOInput): Promise<ActionResult> {
  try {
    const { user, entity } = await context();
    const parsed = MOSchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const v = parsed.data;
    const prods = await productsInEntity(entity.id, [v.productId, ...v.materials.map((m) => m.productId)]);
    if (v.salesOrderId) {
      const [so] = await db.select({ id: t.salesOrders.id }).from(t.salesOrders).where(and(eq(t.salesOrders.id, v.salesOrderId), eq(t.salesOrders.entityId, entity.id)));
      if (!so) return { error: "That sales order isn't in this entity." };
    }
    const materialsCost = r4(v.materials.reduce((s, m) => s + m.plannedQty * prods.get(m.productId)!.cost, 0));
    const operationsCost = r4(v.operations.reduce((s, o) => s + o.plannedHours * o.costPerHour, 0));
    const header = {
      productId: v.productId,
      plannedQty: String(v.plannedQty),
      productionDeadline: v.productionDeadline,
      deliveryDeadline: v.deliveryDeadline,
      salesOrderId: v.salesOrderId,
      notes: v.notes,
      materialsCost: String(materialsCost),
      operationsCost: String(operationsCost),
    };
    const id = await db.transaction(async (tx) => {
      let moId = v.id;
      if (moId) {
        const [mo] = await tx.select().from(t.manufacturingOrders).where(and(eq(t.manufacturingOrders.id, moId), eq(t.manufacturingOrders.entityId, entity.id)));
        if (!mo) throw new Error("Manufacturing order not found.");
        if (mo.status === "done" || mo.status === "cancelled") throw new Error(`A ${mo.status === "done" ? "completed" : "cancelled"} order can't be edited.`);
        await tx.update(t.manufacturingOrders).set(header).where(eq(t.manufacturingOrders.id, moId));
        await tx.delete(t.moMaterials).where(eq(t.moMaterials.moId, moId));
        await tx.delete(t.moOperations).where(eq(t.moOperations.moId, moId));
      } else {
        const number = await takeNumber(tx, entity.id, "MO");
        const [mo] = await tx.insert(t.manufacturingOrders).values({ ...header, entityId: entity.id, number, createdBy: user.id }).returning({ id: t.manufacturingOrders.id });
        moId = mo.id;
      }
      if (v.materials.length)
        await tx.insert(t.moMaterials).values(v.materials.map((m, i) => ({ moId: moId!, productId: m.productId, plannedQty: String(m.plannedQty), note: m.note, sortOrder: i })));
      if (v.operations.length)
        await tx.insert(t.moOperations).values(
          v.operations.map((o, i) => ({ moId: moId!, name: o.name, plannedHours: String(o.plannedHours), costPerHour: String(o.costPerHour), sortOrder: i })),
        );
      await tx.insert(t.auditLog).values({
        entityId: entity.id,
        userId: user.id,
        tableName: "manufacturing_orders",
        recordId: moId!,
        action: v.id ? "update" : "create",
        changes: { product: prods.get(v.productId)!.sku, plannedQty: v.plannedQty, materials: v.materials.length },
      });
      return moId!;
    });
    revalidateMake(id);
    return { ok: true, id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't save the manufacturing order." };
  }
}

async function loadMO(id: string) {
  const { user, entity } = await context();
  const [mo] = await db.select().from(t.manufacturingOrders).where(and(eq(t.manufacturingOrders.id, id), eq(t.manufacturingOrders.entityId, entity.id)));
  if (!mo) throw new Error("Manufacturing order not found.");
  return { user, entity, mo };
}

/** Not started <-> In progress, or Cancel (only before completion). */
export async function setMOStatus(id: string, to: "not_started" | "in_progress" | "cancelled"): Promise<ActionResult> {
  try {
    const { user, entity, mo } = await loadMO(id);
    if (mo.status === "done" || mo.status === "cancelled") return { error: `This order is already ${mo.status === "done" ? "completed" : "cancelled"}.` };
    await db.update(t.manufacturingOrders).set({ status: to }).where(eq(t.manufacturingOrders.id, id));
    await db.insert(t.auditLog).values({ entityId: entity.id, userId: user.id, tableName: "manufacturing_orders", recordId: id, action: "status", changes: { number: mo.number, status: { from: mo.status, to } } });
    revalidateMake(id);
    return { ok: true, id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't update the order." };
  }
}

const CompleteSchema = z.object({
  id: z.string().uuid(),
  completedOn: isoDate,
  actualQty: z.number().positive("Enter how many were made"),
  batchNo: optText,
  materials: z.array(z.object({ id: z.string().uuid(), actualQty: z.number().min(0), batchNo: optText })),
  operations: z.array(z.object({ id: z.string().uuid(), actualHours: z.number().min(0) })),
});
export type CompleteInput = z.input<typeof CompleteSchema>;

/**
 * Completes an MO: materials used come out of stock (production_consume), the finished goods go in
 * (production_output) at actual cost = (materials at standard cost + operations) / quantity made.
 */
export async function completeMO(input: CompleteInput): Promise<ActionResult> {
  try {
    const parsed = CompleteSchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const v = parsed.data;
    const { user, entity, mo } = await loadMO(v.id);
    if (mo.status === "done" || mo.status === "cancelled") return { error: `This order is already ${mo.status === "done" ? "completed" : "cancelled"}.` };
    await db.transaction(async (tx) => {
      const materials = await tx
        .select({ m: t.moMaterials, cost: t.products.standardCost, trackStock: t.products.trackStock })
        .from(t.moMaterials)
        .innerJoin(t.products, eq(t.products.id, t.moMaterials.productId))
        .where(eq(t.moMaterials.moId, v.id));
      const ops = await tx.select().from(t.moOperations).where(eq(t.moOperations.moId, v.id));
      const [product] = await tx.select().from(t.products).where(eq(t.products.id, mo.productId));
      const when = dayStamp(v.completedOn);
      let materialsCost = 0;
      const consume = [];
      for (const m of materials) {
        const a = v.materials.find((x) => x.id === m.m.id);
        const qty = a ? a.actualQty : Number(m.m.plannedQty);
        const cost = Number(m.cost);
        materialsCost += qty * cost;
        await tx.update(t.moMaterials).set({ actualQty: String(qty), unitCost: String(cost), batchNo: a?.batchNo ?? null }).where(eq(t.moMaterials.id, m.m.id));
        if (m.trackStock && qty > 0)
          consume.push({
            entityId: entity.id,
            productId: m.m.productId,
            kind: "production_consume" as const,
            qty: String(-qty),
            unitCost: String(cost),
            batchNo: a?.batchNo ?? null,
            refType: "manufacturing_order",
            refId: v.id,
            refNumber: mo.number,
            occurredAt: when,
            createdBy: user.id,
            note: `Used on ${mo.number}`,
          });
      }
      let operationsCost = 0;
      for (const o of ops) {
        const a = v.operations.find((x) => x.id === o.id);
        const hours = a ? a.actualHours : Number(o.plannedHours);
        operationsCost += hours * Number(o.costPerHour);
        await tx.update(t.moOperations).set({ actualHours: String(hours) }).where(eq(t.moOperations.id, o.id));
      }
      materialsCost = r4(materialsCost);
      operationsCost = r4(operationsCost);
      const unitCost = r4((materialsCost + operationsCost) / v.actualQty);
      if (consume.length) await tx.insert(t.stockMovements).values(consume);
      if (product.trackStock)
        await tx.insert(t.stockMovements).values({
          entityId: entity.id,
          productId: mo.productId,
          kind: "production_output",
          qty: String(v.actualQty),
          unitCost: String(unitCost),
          batchNo: v.batchNo,
          refType: "manufacturing_order",
          refId: v.id,
          refNumber: mo.number,
          occurredAt: when,
          createdBy: user.id,
          note: `Made on ${mo.number}`,
        });
      await tx
        .update(t.manufacturingOrders)
        .set({ status: "done", actualQty: String(v.actualQty), batchNo: v.batchNo, materialsCost: String(materialsCost), operationsCost: String(operationsCost), completedAt: when, completedBy: user.id })
        .where(eq(t.manufacturingOrders.id, v.id));
      await tx.insert(t.auditLog).values({
        entityId: entity.id,
        userId: user.id,
        tableName: "manufacturing_orders",
        recordId: v.id,
        action: "complete",
        changes: { number: mo.number, actualQty: v.actualQty, batchNo: v.batchNo, materialsCost, operationsCost, unitCost },
      });
    });
    revalidateMake(v.id);
    revalidatePath("/stock/batches");
    return { ok: true, id: v.id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't complete the order." };
  }
}

/** Undo a completion: opposite movements put the materials back and remove the output; order returns to In progress. */
export async function undoCompletion(id: string): Promise<ActionResult> {
  try {
    const { user, entity, mo } = await loadMO(id);
    if (mo.status !== "done") return { error: "Only a completed order can be undone." };
    await db.transaction(async (tx) => {
      // Reverse only the net effect still standing, so complete -> undo -> complete -> undo stays correct.
      const all = await tx
        .select()
        .from(t.stockMovements)
        .where(and(eq(t.stockMovements.refId, id), eq(t.stockMovements.refType, "manufacturing_order")));
      const net = new Map<string, { m: (typeof all)[number]; qty: number }>();
      for (const m of all) {
        const key = `${m.productId}|${m.kind}|${m.batchNo ?? ""}`;
        const cur = net.get(key);
        net.set(key, { m: cur?.m ?? m, qty: (cur?.qty ?? 0) + Number(m.qty) });
      }
      const moves = [...net.values()].filter((x) => Math.abs(x.qty) > 1e-9);
      if (moves.length)
        await tx.insert(t.stockMovements).values(
          moves.map(({ m, qty }) => ({
            entityId: m.entityId,
            productId: m.productId,
            kind: m.kind,
            qty: String(-qty),
            unitCost: m.unitCost,
            batchNo: m.batchNo,
            refType: "manufacturing_order",
            refId: id,
            refNumber: `${mo.number} undone`,
            createdBy: user.id,
            note: `Completion of ${mo.number} undone`,
          })),
        );
      await tx.update(t.manufacturingOrders).set({ status: "in_progress", completedAt: null, completedBy: null }).where(eq(t.manufacturingOrders.id, id));
      await tx.insert(t.auditLog).values({ entityId: entity.id, userId: user.id, tableName: "manufacturing_orders", recordId: id, action: "undo_complete", changes: { number: mo.number } });
    });
    revalidateMake(id);
    return { ok: true, id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't undo the completion." };
  }
}
