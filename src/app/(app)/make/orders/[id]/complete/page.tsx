import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { MOCompleteForm } from "@/components/mo-complete-form";
import { getEntityContext } from "@/lib/dal";
import { stockPosition } from "@/lib/queries/availability";
import { getMO } from "@/lib/queries/manufacturing-order";
import { entityToday } from "@/lib/queries/stock-items";

export const metadata: Metadata = { title: "Complete manufacturing order · saveBOARD ERP" };

export default async function CompleteMOPage(props: PageProps<"/make/orders/[id]/complete">) {
  const { id } = await props.params;
  const { entity } = await getEntityContext();
  const found = await getMO(entity.id, id);
  if (!found) notFound();
  const { mo, product, materials, operations } = found;
  if (mo.status !== "not_started" && mo.status !== "in_progress") redirect(`/make/orders/${id}`);
  const position = await stockPosition(entity.id);
  return (
    <MOCompleteForm
      mo={{ id, number: mo.number, sku: product.sku, name: product.name, uom: product.uom, plannedQty: Number(mo.plannedQty) }}
      materials={materials.map(({ m, sku, name, uom, trackStock, standardCost }) => ({
        id: m.id,
        sku,
        name,
        uom,
        plannedQty: Number(m.plannedQty),
        inStock: position.onHand.get(m.productId) ?? 0,
        trackStock,
        cost: Number(standardCost),
      }))}
      operations={operations.map((o) => ({ id: o.id, name: o.name, plannedHours: Number(o.plannedHours), costPerHour: Number(o.costPerHour) }))}
      today={entityToday(entity.id)}
      currency={entity.currency}
    />
  );
}
