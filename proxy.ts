import { NextResponse, type NextRequest } from "next/server";

import { adminPassword, adminSessionCookieName, isValidAdminSession, safeRedirectPath } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  const password = adminPassword();
  const { pathname, search } = request.nextUrl;

  if (!password || pathname === "/api/logout") {
    return NextResponse.next();
  }

  const isLoginRoute = pathname === "/login" || pathname === "/api/login";
  const isApiRoute = pathname.startsWith("/api/");
  const hasSession = await isValidAdminSession(request.cookies.get(adminSessionCookieName)?.value);

  if (hasSession) {
    if (pathname === "/login") {
      return NextResponse.redirect(new URL("/", request.url));
    }

    return NextResponse.next();
  }

  if (isLoginRoute) {
    return NextResponse.next();
  }

  if (isApiRoute) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", safeRedirectPath(`${pathname}${search}`));

  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"]
};
