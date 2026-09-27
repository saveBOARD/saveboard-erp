"use server";

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, t } from "@/db";
import { requireAdmin } from "@/lib/dal";

export type FormState = { ok?: string; error?: string } | undefined;

const NewUser = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,30}$/, "Username: 3–30 letters, numbers, dots, dashes or underscores."),
  displayName: z.string().trim().min(2, "Enter the person's name."),
  password: z.string().min(10, "Password must be at least 10 characters."),
  entities: z.array(z.enum(["NZ", "AUS"])).min(1, "Give access to at least one entity."),
  isAdmin: z.boolean(),
});

export async function createUser(_: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const parsed = NewUser.safeParse({
    username: formData.get("username"),
    displayName: formData.get("displayName"),
    password: formData.get("password"),
    entities: formData.getAll("entities"),
    isAdmin: formData.get("isAdmin") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;
  const [exists] = await db.select({ id: t.users.id }).from(t.users).where(eq(t.users.username, v.username));
  if (exists) return { error: `Username "${v.username}" is already taken.` };
  const [user] = await db
    .insert(t.users)
    .values({ username: v.username, displayName: v.displayName, passwordHash: await bcrypt.hash(v.password, 12), isAdmin: v.isAdmin })
    .returning({ id: t.users.id });
  await db.insert(t.userEntities).values(v.entities.map((entityId) => ({ userId: user.id, entityId })));
  await db.insert(t.auditLog).values({ userId: admin.id, tableName: "users", recordId: user.id, action: "create", changes: { username: v.username, entities: v.entities, isAdmin: v.isAdmin } });
  revalidatePath("/settings/users");
  return { ok: `Created ${v.displayName}. Give them their username and password; they can change the password after signing in.` };
}

export async function resetPassword(_: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const password = String(formData.get("password") ?? "");
  if (password.length < 10) return { error: "Password must be at least 10 characters." };
  await db
    .update(t.users)
    .set({ passwordHash: await bcrypt.hash(password, 12), failedLogins: 0, lockedUntil: null })
    .where(eq(t.users.id, userId));
  await db.insert(t.auditLog).values({ userId: admin.id, tableName: "users", recordId: userId, action: "reset_password" });
  return { ok: "Password reset and account unlocked." };
}

export async function setActive(formData: FormData) {
  const admin = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const active = formData.get("active") === "true";
  if (userId === admin.id) return; // can't disable yourself
  await db.update(t.users).set({ active }).where(eq(t.users.id, userId));
  await db.insert(t.auditLog).values({ userId: admin.id, tableName: "users", recordId: userId, action: active ? "enable" : "disable" });
  revalidatePath("/settings/users");
}
