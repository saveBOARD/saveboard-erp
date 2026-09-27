import { and, asc, eq, ne } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RecipeEditor } from "@/components/recipe-editor";
import { db, t } from "@/db";
import { getEntityContext } from "@/lib/dal";

export const metadata: Metadata = { title: "Recipe · saveBOARD ERP" };

export default async function RecipePage(props: PageProps<"/items/products/[id]/recipe">) {
  const { id } = await props.params;
  const { entity } = await getEntityContext();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [product] = await db.select().from(t.products).where(and(eq(t.products.id, id), eq(t.products.entityId, entity.id)));
  if (!product) notFound();
  const [items, materials, operations] = await Promise.all([
    db
      .select({ id: t.products.id, sku: t.products.sku, name: t.products.name, uom: t.products.uom, cost: t.products.standardCost })
      .from(t.products)
      .where(and(eq(t.products.entityId, entity.id), eq(t.products.active, true), ne(t.products.id, id), ne(t.products.type, "service")))
      .orderBy(asc(t.products.name)),
    db.select().from(t.recipeLines).where(eq(t.recipeLines.productId, id)).orderBy(asc(t.recipeLines.sortOrder)),
    db.select().from(t.recipeOperations).where(eq(t.recipeOperations.productId, id)).orderBy(asc(t.recipeOperations.sortOrder)),
  ]);
  return (
    <RecipeEditor
      product={{ id: product.id, sku: product.sku, name: product.name, uom: product.uom }}
      items={items.map((i) => ({ ...i, cost: Number(i.cost) }))}
      initialMaterials={materials.map((m) => ({ ingredientId: m.ingredientId, qtyPerUnit: Number(m.qtyPerUnit), note: m.note }))}
      initialOperations={operations.map((o) => ({ name: o.name, hoursPerUnit: Number(o.hoursPerUnit), costPerHour: Number(o.costPerHour) }))}
      currency={entity.currency}
    />
  );
}
