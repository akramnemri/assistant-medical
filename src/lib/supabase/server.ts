import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { clientEnv } from "@/lib/config/client-env";
import type { Database } from "@/types/database";

/**
 * Supabase client for server components, server actions and route handlers.
 *
 * Uses the publishable key, not the secret key: this client acts *as the
 * signed-in user*, so Row Level Security still applies. That is deliberate —
 * server-side code is not automatically privileged, and a bug in a query
 * cannot read another workspace's rows.
 *
 * `cookies()` is asynchronous in Next 16, so this function is too.
 */
export async function createSupabaseServerClient() {
  const env = clientEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },

        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch (error) {
            // Next.js forbids setting cookies while rendering a Server
            // Component; only an action, route handler or proxy may do it.
            // A refreshed session token therefore cannot be written here.
            //
            // This is safe to continue from — and not a swallowed failure —
            // because `proxy.ts` refreshes the session on every request before
            // rendering happens. Anything else is a real bug, so it is
            // rethrown rather than ignored.
            if (!isReadonlyCookieStoreError(error)) throw error;
          }
        },
      },
    },
  );
}

/**
 * Distinguishes "cookies are read-only in this context", which is expected,
 * from any other failure, which is not.
 *
 * Matched on the message because Next does not export a typed error for this.
 * If a future version changes the wording the check fails open — the error is
 * rethrown and surfaces loudly, rather than being silently ignored.
 */
function isReadonlyCookieStoreError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  return (
    error.message.includes("Cookies can only be modified") ||
    error.message.includes("read-only")
  );
}
