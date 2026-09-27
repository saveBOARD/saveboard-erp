import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Metadata } from "next";
import { DataTable, type Column } from "@/components/data-table";
import { ListHeader } from "@/components/list-header";
import { db, t } from "@/db";
import { getEntityContext } from "@/lib/dal";
import { adjustLabel } from "@/lib/pricing";

export const metadata: Metadata = { title: "Price lists · saveBOARD ERP" };

export default async function PriceListsPage() {
  const { entity } = await getEntityContext();
  const p = t.priceLists;
  const [rows, [{ sellable }]] = await Promise.all([
    db
      .select({
        id: p.id,
        name: p.name,
        isDefault: p.isDefault,
        adjustPct: p.adjustPct,
        notes: p.notes,
        priced: sql<number>`(select count(*)::int from price_list_items i where i.price_list_id = ${p.id})`,
        customers: sql<number>`(select count(*)::int from customers c where c.price_list_id = ${p.id})`,
        updated: sql<string | null>`(select max(i.updated_at)::date::text from price_list_items i where i.price_list_id = ${p.id})`,
      })
      .from(p)
      .where(eq(p.entityId, entity.id))
      .orderBy(desc(p.isDefault), asc(p.name)),
    db
      .select({ sellable: sql<number>`count(*)::int` })
      .from(t.products)
      .where(and(eq(t.products.entityId, entity.id), eq(t.products.active, true), sql`${t.products.type} <> 'material'`)),
  ]);
  const [{ noList }] = await db.select({ noList: sql<number>`count(*)::int` }).from(t.customers).where(and(eq(t.customers.entityId, entity.id), sql`${t.customers.priceListId} is null`));
  const defaultName = rows.find((r) => r.isDefault)?.name ?? "Standard";

  const columns: Column[] = [
    { key: "name", label: "Price list", href: "/sell/price-lists/{id}", width: 220 },
    { key: "kind", label: "Prices" },
    { key: "priced", label: "Products priced", kind: "number" },
    { key: "customers", label: "Customers", kind: "number" },
    { key: "updated", label: "Last price change" },
    { key: "notes", label: "Notes", hidden: true },
  ];

  return (
    <>
      <ListHeader newLabel="Price list" newHref="/sell/price-lists/new" />
      <DataTable
        columns={columns}
        rows={rows.map((r) => ({
          id: r.id,
          name: r.isDefault ? `${r.name} (default)` : r.name,
          kind: r.isDefault ? "Own prices — used when a customer has no list" : r.adjustPct !== null ? `${defaultName} ${adjustLabel(Number(r.adjustPct))}, with its own overrides` : "Own prices",
          priced: r.priced,
          customers: r.isDefault ? r.customers + noList : r.customers,
          updated: r.updated,
          notes: r.notes,
        }))}
        exportName={`price-lists-${entity.id}`}
        noun="price lists"
      />
      <p className="mt-2 text-xs text-muted">
        Prices are per unit, ex GST, in {entity.currency}. {sellable} active products and services can be priced. On a quote or order, a product&apos;s price comes from
        the customer&apos;s price list, then the default list, then the last price charged to that customer.
      </p>
    </>
  );
}
