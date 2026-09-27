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
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico).*)"],
};
