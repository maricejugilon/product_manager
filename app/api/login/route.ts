import { NextResponse } from "next/server";

import { adminPassword, adminSessionCookieName, adminSessionToken, adminUsername, safeRedirectPath } from "@/lib/auth";

export async function POST(request: Request) {
  const formData = await request.formData();
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");
  const nextPath = safeRedirectPath(formData.get("next"));
  const expectedPassword = adminPassword();

  if (!expectedPassword || (username === adminUsername() && password === expectedPassword)) {
    const response = NextResponse.redirect(new URL(nextPath, request.url), { status: 303 });

    if (expectedPassword) {
      response.cookies.set(adminSessionCookieName, await adminSessionToken(), {
        httpOnly: true,
        maxAge: 60 * 60 * 12,
        path: "/",
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production"
      });
    }

    return response;
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("error", "1");
  loginUrl.searchParams.set("next", nextPath);

  return NextResponse.redirect(loginUrl, { status: 303 });
}
