import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CustomerForm } from "@/components/customer-form";
import { db, t } from "@/db";
import { getEntityContext } from "@/lib/dal";
import { priceListOptions } from "@/lib/queries/price-lists";

export const metadata: Metadata = { title: "Edit customer · saveBOARD ERP" };

export default async function EditCustomerPage(props: PageProps<"/sell/customers/[id]/edit">) {
  const { id } = await props.params;
  const { entity } = await getEntityContext();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [c] = await db.select().from(t.customers).where(and(eq(t.customers.id, id), eq(t.customers.entityId, entity.id)));
  if (!c) notFound();
  return (
    <CustomerForm
      customer={c}
      entity={{ id: entity.id, currency: entity.currency, businessNumberLabel: entity.businessNumberLabel }}
      priceLists={await priceListOptions(entity.id)}
    />
  );
}