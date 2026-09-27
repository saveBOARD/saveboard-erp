import "server-only";
import { eq, sql } from "drizzle-orm";
import { db, t } from "@/db";
import { seal, unseal } from "./crypto";

/**
 * Xero OAuth 2.0 (standard web app, authorisation-code flow; free Starter tier covers our two organisations).
 * Apps created after 2 March 2026 must ask for granular scopes.
 */
export const XERO_SCOPES = "openid profile email offline_access accounting.invoices accounting.payments.read accounting.contacts accounting.settings.read";
const IDENTITY = "https://identity.xero.com/connect/token";
const API = "https://api.xero.com";

export class XeroError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

export function xeroConfig() {
  const clientId = process.env.XERO_CLIENT_ID;
  const clientSecret = process.env.XERO_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function authorizeUrl(redirectUri: string, state: string) {
  const cfg = xeroConfig();
  if (!cfg) throw new XeroError("Xero isn't set up yet: XERO_CLIENT_ID and XERO_CLIENT_SECRET are missing.");
  const u = new URL("https://login.xero.com/identity/connect/authorize");
  u.search = new URLSearchParams({ response_type: "code", client_id: cfg.clientId, redirect_uri: redirectUri, scope: XERO_SCOPES, state }).toString();
  return u.toString();
}

type TokenSet = { access_token: string; refresh_token: string; expires_in: number; scope?: string };

async function tokenRequest(body: Record<string, string>): Promise<TokenSet> {
  const cfg = xeroConfig();
  if (!cfg) throw new XeroError("Xero isn't set up yet.");
  const res = await fetch(IDENTITY, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const json = (await res.json().catch(() => ({}))) as TokenSet & { error?: string };
  if (!res.ok || !json.access_token) {
    if (json.error === "invalid_grant") throw new XeroError("Xero has ended this connection (not used for 60 days, or disconnected in Xero). Reconnect it in Settings → Xero.", 401);
    throw new XeroError(`Xero sign-in failed (${json.error ?? res.status}).`, res.status);
  }
  return json;
}

export const exchangeCode = (code: string, redirectUri: string) => tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri });

export async function listConnections(accessToken: string) {
  const res = await fetch(`${API}/connections`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new XeroError(`Couldn't list Xero organisations (${res.status}).`, res.status);
  return (await res.json()) as { id: string; tenantId: string; tenantType: string; tenantName: string; authEventId: string }[];
}

export async function deleteConnection(accessToken: string, connectionId: string) {
  await fetch(`${API}/connections/${connectionId}`, { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } });
}

/** The authentication event of an access token (a JWT), to pick the organisation chosen in this sign-in. */
export function authEventId(accessToken: string) {
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString("utf8")) as { authentication_event_id?: string };
    return payload.authentication_event_id ?? null;
  } catch {
    return null;
  }
}

export async function saveConnection(entityId: string, c: { tenantId: string; tenantName: string; connectionId: string; userId: string }, tokens: TokenSet) {
  const values = {
    tenantId: c.tenantId,
    tenantName: c.tenantName,
    connectionId: c.connectionId,
    accessToken: seal(tokens.access_token),
    refreshToken: seal(tokens.refresh_token),
    expiresAt: new Date(Date.now() + (tokens.expires_in - 60) * 1000),
    scopes: tokens.scope ?? XERO_SCOPES,
    connectedBy: c.userId,
    connectedAt: new Date(),
    updatedAt: new Date(),
  };
  await db.insert(t.xeroConnections).values({ entityId, ...values }).onConflictDoUpdate({ target: t.xeroConnections.entityId, set: values });
}

export async function getConnection(entityId: string) {
  const [c] = await db.select().from(t.xeroConnections).where(eq(t.xeroConnections.entityId, entityId));
  return c ?? null;
}

/**
 * A valid access token for the entity's organisation, refreshing (and storing the rotated refresh token) when it's
 * about to expire. The row lock stops two requests refreshing at once, which would lose a rotated token.
 */
export async function accessToken(entityId: string): Promise<{ token: string; tenantId: string }> {
  const c = await getConnection(entityId);
  if (!c) throw new XeroError(`${entityId} isn't connected to Xero. Connect it in Settings → Xero.`);
  if (c.expiresAt.getTime() > Date.now()) return { token: unseal(c.accessToken), tenantId: c.tenantId };
  return db.transaction(async (tx) => {
    const [row] = await tx.execute<{ access_token: string; refresh_token: string; expires_at: string; tenant_id: string }>(
      sql`select access_token, refresh_token, expires_at, tenant_id from xero_connections where entity_id = ${entityId} for update`,
    ).then((r) => (Array.isArray(r) ? r : (r as unknown as { rows: { access_token: string; refresh_token: string; expires_at: string; tenant_id: string }[] }).rows));
    if (!row) throw new XeroError(`${entityId} isn't connected to Xero.`);
    if (new Date(row.expires_at).getTime() > Date.now()) return { token: unseal(row.access_token), tenantId: row.tenant_id };
    const tokens = await tokenRequest({ grant_type: "refresh_token", refresh_token: unseal(row.refresh_token) });
    await tx
      .update(t.xeroConnections)
      .set({ accessToken: seal(tokens.access_token), refreshToken: seal(tokens.refresh_token), expiresAt: new Date(Date.now() + (tokens.expires_in - 60) * 1000), updatedAt: new Date() })
      .where(eq(t.xeroConnections.entityId, entityId));
    return { token: tokens.access_token, tenantId: row.tenant_id };
  });
}

type XeroValidation = { Elements?: { ValidationErrors?: { Message: string }[] }[]; Message?: string; Detail?: string; Title?: string };

/** Call the Accounting API for an entity. Waits and retries on Xero's rate limit (429). */
export async function xeroApi<T>(entityId: string, method: "GET" | "POST" | "PUT", path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const { token, tenantId } = await accessToken(entityId);
    const res = await fetch(`${API}/api.xro/2.0${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "xero-tenant-id": tenantId,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 && attempt < 3) {
      const wait = Math.min(Number(res.headers.get("retry-after") ?? "5"), 60);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    const json = (await res.json().catch(() => ({}))) as T & XeroValidation;
    if (!res.ok) {
      const detail =
        json.Elements?.flatMap((e) => e.ValidationErrors?.map((v) => v.Message) ?? []).join("; ") || json.Message || json.Detail || json.Title || `HTTP ${res.status}`;
      if (res.status === 401) throw new XeroError(`Xero refused access (${detail}). Reconnect Xero in Settings → Xero.`, 401);
      if (res.status === 403) throw new XeroError(`Xero says this app isn't allowed to do that (${detail}).`, 403);
      if (res.status === 429) throw new XeroError("Xero's daily limit for this app has been reached; try again tomorrow.", 429);
      throw new XeroError(`Xero: ${detail}`, res.status);
    }
    return json;
  }
}
