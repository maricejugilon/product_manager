export const adminSessionCookieName = "fcw_admin_session";

export function adminUsername() {
  return process.env.APP_ADMIN_USERNAME || "admin";
}

export function adminPassword() {
  return process.env.APP_ADMIN_PASSWORD || "";
}

function bytesToHex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function adminSessionToken() {
  const username = adminUsername();
  const password = adminPassword();
  const secret = process.env.APP_AUTH_SECRET || password;
  const payload = new TextEncoder().encode(`${username}:${password}:${secret}`);

  return bytesToHex(await crypto.subtle.digest("SHA-256", payload));
}

export async function isValidAdminSession(value: string | undefined) {
  return Boolean(adminPassword() && value && value === (await adminSessionToken()));
}

export function safeRedirectPath(value: FormDataEntryValue | string | null | undefined) {
  const path = typeof value === "string" ? value : "";

  if (!path.startsWith("/") || path.startsWith("//") || path.includes("://")) {
    return "/";
  }

  if (path.startsWith("/login") || path.startsWith("/api/login")) {
    return "/";
  }

  return path;
}
