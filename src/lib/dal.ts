import "server-only";
import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db, t } from "@/db";
import { decrypt, ENTITY_COOKIE, SESSION_COOKIE } from "./session";

/** The signed-in, active user, or a redirect to /login. Checked against the database on every request. */
export const requireUser = cache(async () => {
  const session = await decrypt((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");
  const [user] = await db
    .select({ id: t.users.id, username: t.users.username, displayName: t.users.displayName, isAdmin: t.users.isAdmin, active: t.users.active })
    .from(t.users)
    .where(eq(t.users.id, session.userId));
  if (!user?.active) redirect("/login");
  return user;
});

export const requireAdmin = cache(async () => {
  const user = await requireUser();
  if (!user.isAdmin) redirect("/");
  return user;
});

/** Entities this user may work in, and the one currently selected (cookie, validated). */
export const getEntityContext = cache(async () => {
  const user = await requireUser();
  const allowed = await db
    .select({ id: t.entities.id, name: t.entities.name, currency: t.entities.currency, gstRate: t.entities.gstRate, locationName: t.entities.locationName, businessNumberLabel: t.entities.businessNumberLabel })
    .from(t.userEntities)
    .innerJoin(t.entities, eq(t.userEntities.entityId, t.entities.id))
    .where(eq(t.userEntities.userId, user.id))
    .orderBy(t.entities.id);
  if (!allowed.length) redirect("/login?error=no-entity");
  const wanted = (await cookies()).get(ENTITY_COOKIE)?.value;
  const current = allowed.find((e) => e.id === wanted) ?? allowed.find((e) => e.id === "NZ") ?? allowed[0];
  return { user, entities: allowed, entity: current };
});

/** Throws unless the user may act in this entity. Use in every server action that writes. */
export async function assertEntityAccess(userId: string, entityId: string) {
  const [row] = await db
    .select()
    .from(t.userEntities)
    .where(and(eq(t.userEntities.userId, userId), eq(t.userEntities.entityId, entityId)));
  if (!row) throw new Error("You don't have access to this entity.");
}
