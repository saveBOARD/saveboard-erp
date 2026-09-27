import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import { db, t } from "@/db";

/** Suppliers plus the categories and units already in use, for the item form's pick-lists. */
export async function productFormData(entityId: string) {
  const [suppliers, cats, uoms] = await Promise.all([
    db.select({ id: t.suppliers.id, name: t.suppliers.name }).from(t.suppliers).where(eq(t.suppliers.entityId, entityId)).orderBy(asc(t.suppliers.name)),
    db.selectDistinct({ v: t.products.category }).from(t.products).where(sql`${t.products.entityId} = ${entityId} and ${t.products.category} is not null`),
    db.selectDistinct({ v: t.products.uom }).from(t.products).where(sql`${t.products.entityId} = ${entityId} and ${t.products.uom} is not null`),
  ]);
  const sorted = (rows: { v: string | null }[]) => rows.map((r) => r.v!).sort((a, b) => a.localeCompare(b));
  return { suppliers, categories: sorted(cats), uoms: sorted(uoms) };
}
