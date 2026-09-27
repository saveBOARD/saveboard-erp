import { and, asc, eq, sql } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PriceGrid } from "@/components/price-grid";
import { PriceListActions } from "@/components/price-list-actions";
import { PriceListForm } from "@/components/price-list-form";
import { db, t } from "@/db";
import { getEntityContext } from "@/lib/dal";
import { adjustLabel } from "@/lib/pricing";
import { priceListsData } from "@/lib/queries/price-lists";

export const metadata: Metadata = { title: "Price list · saveBOARD ERP" };

export default async function PriceListPage(props: PageProps<"/sell/price-lists/[id]">) {
  const { id } = await props.params;
  const { entity } = await getEntityContext();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [[row], lists, products, lastRows, customers] = await Promise.all([
    db.select().from(t.priceLists).where(and(eq(t.priceLists.id, id), eq(t.priceLists.entityId, entity.id))),
    priceListsData(entity.id),
    db
      .select({ id: t.products.id, sku: t.products.sku, name: t.products.name, category: t.products.category, uom: t.products.uom, type: t.products.type, cost: t.products.standardCost })
      .from(t.products)
      .where(and(eq(t.products.entityId, entity.id), eq(t.products.active, true)))
      .orderBy(asc(t.products.category), asc(t.products.name)),
    db.execute<{ product_id: string; unit_price: string }>(sql`
      select distinct on (l.product_id) l.product_id, l.unit_price
      from order_lines l join sales_orders o on o.id = l.order_id
      where o.entity_id = ${entity.id} and l.product_id is not null and l.unit_price > 0
      order by l.product_id, o.order_date desc, o.created_at desc`),
    db
      .select({ id: t.customers.id, name: t.customers.name })
      .from(t.customers)
      .innerJoin(t.priceLists, eq(t.priceLists.id, id))
      .where(and(eq(t.customers.entityId, entity.id), sql`(${t.customers.priceListId} = ${id} or (${t.customers.priceListId} is null and ${t.priceLists.isDefault}))`))
      .orderBy(asc(t.customers.name)),
  ]);
  if (!row) notFound();
  const list = lists.find((l) => l.id === id) ?? { id, name: row.name, isDefault: row.isDefault, adjustPct: row.adjustPct === null ? null : Number(row.adjustPct), prices: {} };
  const defaultList = lists.find((l) => l.isDefault) ?? null;
  const last = new Map(
    ((Array.isArray(lastRows) ? lastRows : (lastRows as unknown as { rows: { product_id: string; unit_price: string }[] }).rows) as { product_id: string; unit_price: string }[]).map((r) => [
      r.product_id,
      Number(r.unit_price),
    ]),
  );

  return (
    <div className="mx-auto grid max-w-7xl gap-4">
      <Link href="/sell/price-lists" className="inline-flex items-center gap-1 text-sm text-link hover:underline">
        <ArrowLeft className="h-4 w-4" /> Price lists
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted">Price list · {entity.id}</div>
          <h1 className="text-2xl font-medium">
            {row.name}
            {row.isDefault && <span className="ml-2 rounded bg-ok px-2 py-0.5 align-middle text-xs text-white">Default</span>}
          </h1>
          <p className="text-sm text-muted">
            {row.isDefault
              ? "Customers without a price list of their own get these prices."
              : list.adjustPct !== null && defaultList
                ? `${defaultList.name} prices ${adjustLabel(list.adjustPct)}; prices entered below override that.`
                : `Own prices; products without a price here use the ${defaultList?.name ?? "default"} price.`}
          </p>
        </div>
        <PriceListActions id={id} name={row.name} isDefault={row.isDefault} />
      </div>

      <details className="rounded border border-line bg-surface">
        <summary className="cursor-pointer px-4 py-2 text-sm font-medium">
          Settings and customers ({customers.length} customer{customers.length === 1 ? "" : "s"} on this list)
        </summary>
        <div className="grid gap-4 p-4 pt-0">
          <PriceListForm
            existing={{ id, name: row.name, adjustPercent: row.adjustPct === null ? null : Math.round(Number(row.adjustPct) * 10000) / 100, notes: row.notes }}
            isDefault={row.isDefault}
            defaultName={defaultList?.name ?? null}
            otherLists={[]}
          />
          <div className="text-sm">
            <div className="mb-1 text-xs text-muted">Customers (set a customer&apos;s price list on the customer&apos;s Edit screen)</div>
            {customers.length ? (
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {customers.map((c) => (
                  <Link key={c.id} href={`/sell/customers/${c.id}`} className="text-link hover:underline">
                    {c.name}
                  </Link>
                ))}
              </div>
            ) : (
              <span className="text-muted">None yet.</span>
            )}
          </div>
        </div>
      </details>

      <PriceGrid
        list={list}
        defaultList={row.isDefault ? null : defaultList}
        currency={entity.currency}
        items={products.map((p) => ({
          id: p.id,
          sku: p.sku,
          name: p.name,
          category: p.category,
          uom: p.uom,
          type: p.type,
          cost: Number(p.cost),
          lastPrice: last.get(p.id) ?? null,
          price: list.prices[p.id] ?? null,
        }))}
      />
    </div>
  );
}
