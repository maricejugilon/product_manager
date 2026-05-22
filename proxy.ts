import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const username = process.env.APP_ADMIN_USERNAME ?? "admin";
  const password = process.env.APP_ADMIN_PASSWORD;

  if (!password) {
    return NextResponse.next();
  }

  const header = request.headers.get("authorization");
  const [scheme, encoded] = header?.split(" ") ?? [];

  if (scheme === "Basic" && encoded) {
    const decoded = atob(encoded);
    const separatorIndex = decoded.indexOf(":");
    const providedUsername = separatorIndex >= 0 ? decoded.slice(0, separatorIndex) : "";
    const providedPassword = separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : "";

    if (providedUsername === username && providedPassword === password) {
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
