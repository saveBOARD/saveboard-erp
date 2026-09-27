import { db, t } from "@/db";
import { accessToken } from "@/lib/xero/client";
import { refreshFromXero } from "@/lib/xero/sync";

/**
 * Daily read-back of invoice payments from Xero for every connected entity (Vercel Cron, see vercel.json).
 * Vercel sends "Authorization: Bearer <CRON_SECRET>"; anything else is refused.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  const connections = await db.select({ entityId: t.xeroConnections.entityId }).from(t.xeroConnections);
  const results: Record<string, unknown> = {};
  for (const { entityId } of connections) {
    try {
      // Always renew the tokens: Xero ends a connection whose refresh token goes unused for 60 days,
      // and refreshFromXero only calls Xero when there are open invoices to check.
      await accessToken(entityId);
      results[entityId] = await refreshFromXero(entityId);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      results[entityId] = { error: message };
      await db.insert(t.xeroSyncLog).values({ entityId, kind: "refresh", ok: false, message });
    }
  }
  return Response.json(results);
}
