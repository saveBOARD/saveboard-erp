"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, t } from "@/db";
import { assertEntityAccess, requireAdmin } from "@/lib/dal";

export async function saveCompany(
  _: { ok?: string; error?: string } | undefined,
  formData: FormData,
): Promise<{ ok?: string; error?: string }> {
  const admin = await requireAdmin();
  const entityId = String(formData.get("entityId") ?? "");
  await assertEntityAccess(admin.id, entityId);
  const field = (k: string) => {
    const v = String(formData.get(k) ?? "").trim();
    return v ? v.slice(0, 2000) : null;
  };
  const values = {
    address: field("address"),
    phone: field("phone"),
    email: field("email"),
    website: field("website"),
    taxNumber: field("taxNumber"),
    quoteTerms: field("quoteTerms"),
  };
  await db.update(t.entities).set(values).where(eq(t.entities.id, entityId));
  await db.insert(t.auditLog).values({ entityId, userId: admin.id, tableName: "entities", recordId: entityId, action: "update", changes: values });
  revalidatePath("/settings/company");
  return { ok: "Saved. New documents print with these details." };
}
