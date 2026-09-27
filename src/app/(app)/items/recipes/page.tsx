import { and, asc, eq, sql } from "drizzle-orm";
import type { Metadata } from "next";
import { DataTable, type Column } from "@/components/data-table";
import { ListHeader } from "@/components/list-header";
import { db, t } from "@/db";
import { getEntityContext } from "@/lib/dal";

export const metadata: Metadata = { title: "Recipes · saveBOARD ERP" };

/** Every sellable product with its recipe status and cost to make per unit. */
export default async function RecipesPage(props: PageProps<"/items/recipes">) {
  const { entity } = await getEntityContext();
  const sp = await props.searchParams;
  const onlyMissing = sp.show === "missing";
  const p = t.products;
  const rows = await db
    .select({
      id: p.id,
      sku: p.sku,
      name: p.name,
      category: p.category,
      uom: p.uom,
      materials: sql<number>`(select count(*)::int from recipe_lines r where r.product_id = "products"."id")`,
      materialCost: sql<string>`(select coalesce(sum(r.qty_per_unit * i.standard_cost), 0) from recipe_lines r join products i on i.id = r.ingredient_id where r.product_id = "products"."id")`,
      operationCost: sql<string>`(select coalesce(sum(o.hours_per_unit * o.cost_per_hour), 0) from recipe_operations o where o.product_id = "products"."id")`,
    })
    .from(p)
    .where(and(eq(p.entityId, entity.id), eq(p.type, "product"), eq(p.active, true)))
    .orderBy(asc(p.name));
  const shown = onlyMissing ? rows.filter((r) => r.materials === 0) : rows;

  const columns: Column[] = [
    { key: "name", label: "Product", href: "/items/products/{id}/recipe", width: 300 },
    { key: "sku", label: "SKU" },
    { key: "category", label: "Category" },
    { key: "recipe", label: "Recipe", tones: { "Not set up": "pending", "Set up": "ok" } },
    { key: "materials", label: "Materials", kind: "number" },
    { key: "materialCost", label: "Material cost / unit", kind: "money" },
    { key: "operationCost", label: "Operations cost / unit", kind: "money" },
    { key: "totalCost", label: "Cost to make / unit", kind: "money" },
  ];
  return (
    <>
      <ListHeader
        tabs={[
          { label: "All products", href: "/items/recipes", active: !onlyMissing },
          { label: "Without a recipe", href: "/items/recipes?show=missing", active: onlyMissing },
        ]}
      />
      <DataTable
        columns={columns}
        rows={shown.map((r) => {
          const m = Number(r.materialCost);
          const o = Number(r.operationCost);
          return { ...r, recipe: r.materials ? "Set up" : "Not set up", materialCost: m, operationCost: o, totalCost: m + o };
        })}
        currency={entity.currency}
        exportName={`recipes-${entity.id}`}
        noun="products"
      />
      <p className="mt-2 text-xs text-muted">Click a product to set up or change its recipe. Katana&apos;s exports didn&apos;t include recipes, so each needs entering once.</p>
    </>
  );
}
