import "server-only";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, t } from "@/db";
import { getEntityContext } from "@/lib/dal";
import { getOrder } from "./orders";

/** Everything a printed document needs; 404 unless the order belongs to the user's current entity. */
export async function printData(id: string) {
  const { entity } = await getEntityContext();
  const [found, [entityRow]] = await Promise.all([getOrder(entity.id, id), db.select().from(t.entities).where(eq(t.entities.id, entity.id))]);
  if (!found) notFound();
  return { ...found, entity: entityRow };
}
