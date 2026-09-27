import { timingSafeEqual } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { db, t } from "@/db";
import { assertEntityAccess, requireAdmin } from "@/lib/dal";
import { authEventId, exchangeCode, listConnections, saveConnection } from "@/lib/xero/client";

const STATE_COOKIE = "sb_xero_oauth";

/** Xero sends the admin back here after they approve access to one organisation. */
export async function GET(request: NextRequest) {
  const user = await requireAdmin();
  const back = (query: string) => NextResponse.redirect(new URL(`/settings/xero?${query}`, request.url));
  const jar = await cookies();
  const saved = jar.get(STATE_COOKIE)?.value ?? "";
  jar.delete({ name: STATE_COOKIE, path: "/api/xero" });
  const [state, entityId] = saved.split("|");
  const given = request.nextUrl.searchParams.get("state") ?? "";
  if (!state || !entityId || state.length !== given.length || !timingSafeEqual(Buffer.from(state), Buffer.from(given))) return back("error=state");
  const denied = request.nextUrl.searchParams.get("error");
  if (denied) return back(`error=${encodeURIComponent(denied)}`);
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return back("error=no-code");

  try {
    await assertEntityAccess(user.id, entityId);
    const tokens = await exchangeCode(code, `${request.nextUrl.origin}/api/xero/callback`);
    const all = (await listConnections(tokens.access_token)).filter((c) => c.tenantType === "ORGANISATION");
    const event = authEventId(tokens.access_token);
    const chosen = event ? all.filter((c) => c.authEventId === event) : all;
    if (chosen.length !== 1) return back(`error=${chosen.length ? "pick-one" : "no-org"}`);
    const org = chosen[0];
    const [clash] = await db
      .select({ entityId: t.xeroConnections.entityId })
      .from(t.xeroConnections)
      .where(and(eq(t.xeroConnections.tenantId, org.tenantId), ne(t.xeroConnections.entityId, entityId)));
    if (clash) return back(`error=other-entity&org=${encodeURIComponent(org.tenantName)}&entity=${clash.entityId}`);
    await saveConnection(entityId, { tenantId: org.tenantId, tenantName: org.tenantName, connectionId: org.id, userId: user.id }, tokens);
    await db.insert(t.xeroSyncLog).values({ entityId, kind: "connect", ok: true, message: `Connected to ${org.tenantName}`, userId: user.id });
    await db.insert(t.auditLog).values({ entityId, userId: user.id, tableName: "xero_connections", recordId: entityId, action: "connect", changes: { org: org.tenantName } });
    return back(`connected=${encodeURIComponent(org.tenantName)}`);
  } catch (e) {
    return back(`error=${encodeURIComponent(e instanceof Error ? e.message : "failed")}`);
  }
}
