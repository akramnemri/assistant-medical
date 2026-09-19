import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { clientEnv } from "@/lib/config/client-env";
import type { Database } from "@/types/database";
import { DEFAULT_SIGNED_IN_PATH, NEXT_PARAM } from "@/features/auth/redirects";

/**
 * Runs before every matched request (Next 16's replacement for `middleware.ts`,
 * Node runtime only).
 *
 * Two jobs:
 *
 * 1. **Refresh the session.** Access tokens expire hourly. Server Components
 *    cannot write cookies, so if the refreshed token were not persisted here it
 *    would be discarded and the user silently signed out.
 * 2. **Keep unauthenticated visitors out of workspace routes.**
 *
 * This is a routing convenience, **not** the security boundary. A proxy can be
 * bypassed — for example by a misconfigured matcher — so every server-side read
 * still derives the workspace from the session, and Row Level Security
 * independently prevents cross-tenant access.
 */

/** Routes that require a signed-in user. */
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/conversations",
  "/whatsapp",
  "/settings",
  "/admin",
] as const;

/** Routes that a signed-in user has no reason to see. */
const AUTH_PREFIXES = ["/sign-in", "/sign-up"] as const;

function matchesPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const env = clientEnv();

  // Reassigned by `setAll` below whenever Supabase rotates the session cookies.
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },

        setAll(cookiesToSet) {
          // Written twice on purpose. The request copy is what the rest of
          // this function and the downstream render read; the response copy is
          // what reaches the browser. Updating only one produces a session
          // that works for exactly one request and then vanishes.
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }

          response = NextResponse.next({ request });

          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // `getUser()` revalidates the token against the auth server. `getSession()`
  // would trust whatever is in the cookie, which is not safe to gate routing on.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (user === null && matchesPrefix(pathname, PROTECTED_PREFIXES)) {
    const signInUrl = request.nextUrl.clone();
    signInUrl.pathname = "/sign-in";
    signInUrl.search = "";
    // Remember where they were headed so sign-in can return them there.
    signInUrl.searchParams.set(NEXT_PARAM, pathname);

    return redirectPreservingCookies(signInUrl, response);
  }

  if (user !== null && matchesPrefix(pathname, AUTH_PREFIXES)) {
    const dashboardUrl = request.nextUrl.clone();
    dashboardUrl.pathname = DEFAULT_SIGNED_IN_PATH;
    dashboardUrl.search = "";

    return redirectPreservingCookies(dashboardUrl, response);
  }

  return response;
}

/**
 * Redirects without discarding a refreshed session.
 *
 * A fresh `NextResponse.redirect` carries none of the cookies Supabase just
 * rotated, so the refreshed token would be lost and the user bounced to
 * sign-in on their next request.
 */
function redirectPreservingCookies(url: URL, source: NextResponse): NextResponse {
  const redirectResponse = NextResponse.redirect(url);

  for (const cookie of source.cookies.getAll()) {
    redirectResponse.cookies.set(cookie);
  }

  return redirectResponse;
}

export const config = {
  /**
   * Excludes static assets and image optimization. Without this the proxy runs
   * for every CSS, JS and image request — adding an auth round trip to each and
   * risking assets being redirected to the sign-in page.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
