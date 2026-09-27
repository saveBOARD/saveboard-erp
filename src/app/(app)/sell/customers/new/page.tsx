import type { Metadata } from "next";
import { CustomerForm } from "@/components/customer-form";
import { getEntityContext } from "@/lib/dal";
import { priceListOptions } from "@/lib/queries/price-lists";

export const metadata: Metadata = { title: "New customer · saveBOARD ERP" };

export default async function NewCustomerPage() {
  const { entity } = await getEntityContext();
  return (
    <CustomerForm
      entity={{ id: entity.id, currency: entity.currency, businessNumberLabel: entity.businessNumberLabel }}
      priceLists={await priceListOptions(entity.id)}
    />
  );
}
