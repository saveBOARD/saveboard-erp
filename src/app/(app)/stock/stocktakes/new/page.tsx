import type { Metadata } from "next";
import { StocktakeNewForm } from "@/components/stocktake-new-form";
import { getEntityContext } from "@/lib/dal";
import { stockItems } from "@/lib/queries/stock-items";

export const metadata: Metadata = { title: "New stocktake · saveBOARD ERP" };

export default async function NewStocktakePage() {
  const { entity } = await getEntityContext();
  const items = await stockItems(entity.id);
  const categories = [...new Set(items.map((i) => i.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b));
  return (
    <StocktakeNewForm
      categories={categories}
      counts={{ all: items.length, product: items.filter((i) => i.type === "product").length, material: items.filter((i) => i.type === "material").length }}
    />
  );
}
