import { asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { DataTable, type Column } from "@/components/data-table";
import { ListHeader } from "@/components/list-header";
import { db, t } from "@/db";
import { getEntityContext } from "@/lib/dal";

export const metadata: Metadata = { title: "Suppliers · saveBOARD ERP" };

export default async function SuppliersPage() {
  const { entity } = await getEntityContext();
  const s = t.suppliers;
  const rows = await db
    .select({
      id: s.id,
      name: s.name,
      contact: s.contactName,
      phone: s.phone,
      email: s.email,
      leadTime: s.leadTimeDays,
      terms: s.paymentTerms,
      notes: s.notes,
    })
    .from(s)
    .where(eq(s.entityId, entity.id))
    .orderBy(asc(s.name));

  const columns: Column[] = [
    { key: "name", label: "Name", width: 240, href: "/buy/suppliers/{id}" },
    { key: "contact", label: "Contact" },
    { key: "phone", label: "Phone" },
    { key: "email", label: "Email" },
    { key: "leadTime", label: "Lead time (days)", kind: "number" },
    { key: "terms", label: "Payment terms" },
    { key: "notes", label: "Notes" },
  ];

  return (
    <>
      <ListHeader newLabel="Supplier" newHref="/buy/suppliers/new" />
      <DataTable columns={columns} rows={rows} exportName={`suppliers-${entity.id}`} noun="suppliers" />
    </>
  );
}
