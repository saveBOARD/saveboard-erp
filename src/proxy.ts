import { NextResponse, type NextRequest } from "next/server";

// Optimistic check only: no session cookie -> login page. Real verification happens in src/lib/dal.ts.
export function proxy(request: NextRequest) {
  if (!request.cookies.has("sb_session")) {
    const url = new URL("/login", request.url);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Skip the login page, Next.js assets, public images (the logo shows on the login page before sign-in) and the
  // scheduled jobs under /api/cron (they check their own secret).
  matcher: ["/((?!login|api/cron|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)"],
};
