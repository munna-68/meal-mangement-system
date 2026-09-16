import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

/**
 * Next.js 16 renamed Middleware to Proxy. This runs before every matched
 * request and bounces anyone without a valid session to the login screen.
 * Server actions re-verify independently, so this is not the only gate.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySessionToken(token);

  if (pathname === "/login") {
    if (session) {
      return NextResponse.redirect(new URL("/today", request.url));
    }
    return NextResponse.next();
  }

  if (!session) {
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt)$).*)",
  ],
};
