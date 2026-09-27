import type { Metadata } from "next";
import { SupplierForm } from "@/components/supplier-form";

export const metadata: Metadata = { title: "New supplier · saveBOARD ERP" };

export default function NewSupplierPage() {
  return <SupplierForm />;
}