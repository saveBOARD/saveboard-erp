import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductForm } from "@/components/product-form";
import { db, t } from "@/db";
import { getEntityContext } from "@/lib/dal";
import { productFormData } from "@/lib/queries/product-form-data";

export const metadata: Metadata = { title: "Edit item · saveBOARD ERP" };

export default async function EditProductPage(props: PageProps<"/items/products/[id]/edit">) {
  const { id } = await props.params;
  const { entity } = await getEntityContext();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [p] = await db.select().from(t.products).where(and(eq(t.products.id, id), eq(t.products.entityId, entity.id)));
  if (!p) notFound();
  const data = await productFormData(entity.id);
  return <ProductForm product={p} currency={entity.currency} {...data} />;
}