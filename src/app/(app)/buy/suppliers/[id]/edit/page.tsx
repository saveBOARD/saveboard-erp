import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SupplierForm } from "@/components/supplier-form";
import { db, t } from "@/db";
import { getEntityContext } from "@/lib/dal";

export const metadata: Metadata = { title: "Edit supplier · saveBOARD ERP" };

export default async function EditSupplierPage(props: PageProps<"/buy/suppliers/[id]/edit">) {
  const { id } = await props.params;
  const { entity } = await getEntityContext();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [s] = await db.select().from(t.suppliers).where(and(eq(t.suppliers.id, id), eq(t.suppliers.entityId, entity.id)));
  if (!s) notFound();
  return <SupplierForm supplier={s} />;
}