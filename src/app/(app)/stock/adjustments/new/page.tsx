import type { Metadata } from "next";
import { AdjustmentForm } from "@/components/adjustment-form";
import { getEntityContext } from "@/lib/dal";
import { entityToday, stockItems } from "@/lib/queries/stock-items";

export const metadata: Metadata = { title: "New stock adjustment · saveBOARD ERP" };

export default async function NewAdjustmentPage() {
  const { entity } = await getEntityContext();
  const items = await stockItems(entity.id);
  return (
    <AdjustmentForm
      items={items.map(({ id, sku, name, uom, cost, onHand }) => ({ id, sku, name, uom, cost, onHand }))}
      currency={entity.currency}
      today={entityToday(entity.id)}
    />
  );
}
