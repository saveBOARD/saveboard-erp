import type { Metadata } from "next";
import { ProductForm } from "@/components/product-form";
import { getEntityContext } from "@/lib/dal";
import { productFormData } from "@/lib/queries/product-form-data";

export const metadata: Metadata = { title: "New item · saveBOARD ERP" };

export default async function NewProductPage() {
  const { entity } = await getEntityContext();
  const data = await productFormData(entity.id);
  return <ProductForm currency={entity.currency} {...data} />;
}