import type { Metadata } from "next";
import { PriceListForm } from "@/components/price-list-form";
import { getEntityContext } from "@/lib/dal";
import { priceListOptions } from "@/lib/queries/price-lists";

export const metadata: Metadata = { title: "New price list · saveBOARD ERP" };

export default async function NewPriceListPage() {
  const { entity } = await getEntityContext();
  const lists = await priceListOptions(entity.id);
  return (
    <div className="mx-auto grid max-w-3xl gap-4">
      <h1 className="text-xl font-medium">New price list ({entity.id})</h1>
      <PriceListForm defaultName={lists.find((l) => l.isDefault)?.name ?? null} otherLists={lists} />
    </div>
  );
}
