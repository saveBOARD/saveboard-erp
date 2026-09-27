import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import { db, t } from "@/db";
import { priceListsData } from "@/lib/queries/price-lists";

export type EditorCustomer = {
  id: string;
  name: string;
  country: string | null;
  priceListId: string | null;
  sites: {
    id: string;
    name: string;
    line1: string | null;
    line2: string | null;
    city: string | null;
    region: string | null;
    postcode: string | null;
    country: string | null;
    contactName: string | null;
    contactPhone: string | null;
    isDefault: boolean;
  }[];
};
export type EditorProduct = {
  id: string;
  sku: string;
  name: string;
  uom: string | null;
  isService: boolean;
  lastPrice: number | null;
};

/**
 * Customers (with delivery sites and price list), products (with last price charged), price lists, and the last
 * price charged per customer and product, for the quote/order editor.
 */
export async function editorData(entityId: string) {
  const [customers, sites, products, lastPrices, lastCustomerPrices, priceLists] = await Promise.all([
    db
      .select({ id: t.customers.id, name: t.customers.name, country: t.customers.billingCountry, priceListId: t.customers.priceListId })
      .from(t.customers)
      .where(eq(t.customers.entityId, entityId))
      .orderBy(asc(t.customers.name)),
    db
      .select({ site: t.customerSites })
      .from(t.customerSites)
      .innerJoin(t.customers, eq(t.customers.id, t.customerSites.customerId))
      .where(eq(t.customers.entityId, entityId)),
    db
      .select({ id: t.products.id, sku: t.products.sku, name: t.products.name, uom: t.products.uom, type: t.products.type, active: t.products.active })
      .from(t.products)
      .where(eq(t.products.entityId, entityId))
      .orderBy(asc(t.products.name)),
    db.execute<{ product_id: string; unit_price: string }>(sql`
      select distinct on (l.product_id) l.product_id, l.unit_price
      from order_lines l join sales_orders o on o.id = l.order_id
      where o.entity_id = ${entityId} and l.product_id is not null and l.unit_price > 0
      order by l.product_id, o.order_date desc, o.created_at desc`),
    db.execute<{ customer_id: string; product_id: string; unit_price: string }>(sql`
      select distinct on (o.customer_id, l.product_id) o.customer_id, l.product_id, l.unit_price
      from order_lines l join sales_orders o on o.id = l.order_id
      where o.entity_id = ${entityId} and l.product_id is not null and l.unit_price > 0
      order by o.customer_id, l.product_id, o.order_date desc, o.created_at desc`),
    priceListsData(entityId),
  ]);
  const rowsOf = <T,>(r: unknown) => (Array.isArray(r) ? r : (r as { rows: T[] }).rows) as T[];
  const price = new Map(rowsOf<{ product_id: string; unit_price: string }>(lastPrices).map((r) => [r.product_id, Number(r.unit_price)]));
  const customerPrices: Record<string, number> = Object.fromEntries(
    rowsOf<{ customer_id: string; product_id: string; unit_price: string }>(lastCustomerPrices).map((r) => [`${r.customer_id}|${r.product_id}`, Number(r.unit_price)]),
  );
  const sitesBy = new Map<string, EditorCustomer["sites"]>();
  for (const { site } of sites) {
    sitesBy.set(site.customerId, [
      ...(sitesBy.get(site.customerId) ?? []),
      {
        id: site.id,
        name: site.name,
        line1: site.line1,
        line2: site.line2,
        city: site.city,
        region: site.region,
        postcode: site.postcode,
        country: site.country,
        contactName: site.contactName,
        contactPhone: site.contactPhone,
        isDefault: site.isDefault,
      },
    ]);
  }
  return {
    customers: customers.map((c) => ({ ...c, sites: sitesBy.get(c.id) ?? [] })) satisfies EditorCustomer[],
    products: products
      .filter((p) => p.active)
      .map((p) => ({ id: p.id, sku: p.sku, name: p.name, uom: p.uom, isService: p.type === "service", lastPrice: price.get(p.id) ?? null })) satisfies EditorProduct[],
    priceLists,
    customerPrices,
  };
}
