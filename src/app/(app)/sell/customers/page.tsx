import { asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { DataTable, type Column } from "@/components/data-table";
import { ListHeader } from "@/components/list-header";
import { db, t } from "@/db";
import { getEntityContext } from "@/lib/dal";

export const metadata: Metadata = { title: "Customers · saveBOARD ERP" };

export default async function CustomersPage() {
  const { entity } = await getEntityContext();
  const c = t.customers;
  const rows = await db
    .select({
      id: c.id,
      code: c.code,
      name: c.name,
      city: c.billingCity,
      region: c.billingRegion,
      contact: c.contactName,
      phone: c.phone,
      email: c.email,
      businessNumber: c.businessNumber,
      terms: c.paymentTerms,
      tier: c.priceTier,
      creditLimit: c.creditLimit,
      creditHold: c.creditHold,
    })
    .from(c)
    .where(eq(c.entityId, entity.id))
    .orderBy(asc(c.name));

  const columns: Column[] = [
    { key: "name", label: "Name", width: 220, href: "/sell/customers/{id}" },
    { key: "code", label: "ID", hidden: true },
    { key: "city", label: "City" },
    { key: "region", label: entity.id === "AUS" ? "State" : "Region" },
    { key: "contact", label: "Contact" },
    { key: "phone", label: "Phone" },
    { key: "email", label: "Email" },
    { key: "businessNumber", label: entity.businessNumberLabel, hidden: true },
    { key: "terms", label: "Payment terms" },
    { key: "tier", label: "Price tier" },
    { key: "creditLimit", label: "Credit limit", kind: "money" },
    { key: "creditHold", label: "Credit hold", kind: "bool", tones: { true: "bad" } },
  ];

  return (
    <>
      <ListHeader newLabel="Customer" newHref="/sell/customers/new" />
      <DataTable
        columns={columns}
        rows={rows.map((r) => ({ ...r, creditLimit: r.creditLimit === null ? null : Number(r.creditLimit) }))}
        currency={entity.currency}
        exportName={`customers-${entity.id}`}
        noun="customers"
      />
    </>
  );
}
