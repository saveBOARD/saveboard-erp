import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import type { Metadata } from "next";
import { DataTable, type Column } from "@/components/data-table";
import { ListHeader } from "@/components/list-header";
import { db, t } from "@/db";
import { getEntityContext } from "@/lib/dal";

export const metadata: Metadata = { title: "Customers · saveBOARD ERP" };

export default async function CustomersPage(props: PageProps<"/sell/customers">) {
  const { entity } = await getEntityContext();
  const tab = (await props.searchParams).tab;
  const deleted = tab === "deleted";
  const inactive = tab === "inactive";
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
      priceList: t.priceLists.name,
      creditLimit: c.creditLimit,
      creditHold: c.creditHold,
    })
    .from(c)
    .leftJoin(t.priceLists, eq(t.priceLists.id, c.priceListId))
    .where(and(eq(c.entityId, entity.id), deleted ? isNotNull(c.deletedAt) : and(isNull(c.deletedAt), eq(c.active, !inactive))))
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
    { key: "priceList", label: "Price list" },
    { key: "creditLimit", label: "Credit limit", kind: "money" },
    { key: "creditHold", label: "Credit hold", kind: "bool", tones: { true: "bad" } },
  ];

  return (
    <>
      <ListHeader
        tabs={[
          { label: "Active", href: "/sell/customers", active: !inactive && !deleted },
          { label: "Inactive", href: "/sell/customers?tab=inactive", active: inactive },
          { label: "Deleted", href: "/sell/customers?tab=deleted", active: deleted },
        ]}
        newLabel="Customer"
        newHref="/sell/customers/new"
        note={
          deleted
            ? "Deleted customers: kept only so their past orders keep a name. Open one to restore it."
            : inactive
              ? "Hidden from quotes and orders. Edit a customer and tick Active to use them again."
              : undefined
        }
      />
      <DataTable
        columns={columns}
        rows={rows.map((r) => ({ ...r, priceList: r.priceList ?? "Default", creditLimit: r.creditLimit === null ? null : Number(r.creditLimit) }))}
        currency={entity.currency}
        exportName={`customers-${entity.id}`}
        noun="customers"
      />
    </>
  );
}
