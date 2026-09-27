import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getEntityContext, requireAdmin } from "@/lib/dal";
import { authorizeUrl, xeroConfig } from "@/lib/xero/client";

const XERO_STATE_COOKIE = "sb_xero_oauth";

/** Starts the Xero sign-in for the entity currently selected (admins only). */
export async function GET(request: NextRequest) {
  await requireAdmin();
  const { entity } = await getEntityContext();
  if (!xeroConfig()) return NextResponse.redirect(new URL("/settings/xero?error=not-configured", request.url));
  const state = randomBytes(24).toString("base64url");
  (await cookies()).set(XERO_STATE_COOKIE, `${state}|${entity.id}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/xero",
    maxAge: 600,
  });
  return NextResponse.redirect(authorizeUrl(`${request.nextUrl.origin}/api/xero/callback`, state));
}
