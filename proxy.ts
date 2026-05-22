import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const password = process.env.APP_ADMIN_PASSWORD;

  if (!password) {
    return NextResponse.next();
  }

  const header = request.headers.get("authorization");
  const [scheme, encoded] = header?.split(" ") ?? [];

  if (scheme === "Basic" && encoded) {
    const [, providedPassword] = atob(encoded).split(":");
    if (providedPassword === password) {
      return NextResponse.next();
    }
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="WooCommerce Product Manager"'
    }
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
