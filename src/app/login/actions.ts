"use server";

import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, t } from "@/db";
import { createSession, deleteSession } from "@/lib/session";

export type LoginState = { error?: string; username?: string } | undefined;

const MAX_FAILURES = 8;
const LOCK_MINUTES = 15;
// Compared against when the username doesn't exist, so response time doesn't reveal valid usernames.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 12);

export async function login(_: LoginState, formData: FormData): Promise<LoginState> {
  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!username || !password) return { error: "Enter your username and password.", username };

  const [user] = await db.select().from(t.users).where(eq(t.users.username, username));
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);

  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    return { error: `Too many failed attempts. Try again after ${user.lockedUntil.toLocaleTimeString("en-NZ", { hour: "numeric", minute: "2-digit" })}, or ask an admin to reset your password.`, username };
  }
  if (!user || !ok || !user.active) {
    if (user) {
      await db
        .update(t.users)
        .set({
          failedLogins: sql`${t.users.failedLogins} + 1`,
          lockedUntil: user.failedLogins + 1 >= MAX_FAILURES ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
        })
        .where(eq(t.users.id, user.id));
    }
    return { error: "Username or password is incorrect.", username };
  }

  await db.update(t.users).set({ failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(t.users.id, user.id));
  await createSession({ userId: user.id, username: user.username, isAdmin: user.isAdmin });
  redirect("/");
}

export async function logout() {
  await deleteSession();
  redirect("/login");
}
