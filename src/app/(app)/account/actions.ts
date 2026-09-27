"use server";

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, t } from "@/db";
import { requireUser } from "@/lib/dal";

export async function changePassword(_: { ok?: string; error?: string } | undefined, formData: FormData) {
  const user = await requireUser();
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  if (next.length < 10) return { error: "New password must be at least 10 characters." };
  if (next !== String(formData.get("repeat") ?? "")) return { error: "The new passwords don't match." };
  const [row] = await db.select({ hash: t.users.passwordHash }).from(t.users).where(eq(t.users.id, user.id));
  if (!row || !(await bcrypt.compare(current, row.hash))) return { error: "Current password is incorrect." };
  await db.update(t.users).set({ passwordHash: await bcrypt.hash(next, 12) }).where(eq(t.users.id, user.id));
  await db.insert(t.auditLog).values({ userId: user.id, tableName: "users", recordId: user.id, action: "change_password" });
  return { ok: "Password changed." };
}
