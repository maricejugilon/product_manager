import { LockKeyhole } from "lucide-react";

import { safeRedirectPath } from "@/lib/auth";

type LoginSearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({
  searchParams
}: {
  searchParams?: Promise<LoginSearchParams> | LoginSearchParams;
}) {
  const params = searchParams ? await searchParams : {};
  const nextPath = safeRedirectPath(first(params.next));
  const hasError = first(params.error) === "1";

  return (
    <main className="login-page">
      <section className="login-panel">
        <div className="login-icon">
          <LockKeyhole size={22} />
        </div>
        <div>
          <h1>Admin Login</h1>
          <p>Sign in to manage WooCommerce products, categories, reviews, and sheet validation.</p>
        </div>
        {hasError ? <p className="login-error">Incorrect username or password.</p> : null}
        <form className="login-form" action="/api/login" method="post">
          <input type="hidden" name="next" value={nextPath} />
          <label htmlFor="username">Username</label>
          <input id="username" name="username" type="text" autoComplete="username" required autoFocus />
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required />
          <button className="button" type="submit">
            Sign in
          </button>
        </form>
      </section>
    </main>
  );
}
