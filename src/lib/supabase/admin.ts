import "server-only";
import { createClient } from "@supabase/supabase-js";
import { clientEnv } from "@/lib/config/client-env";
import { serverEnv } from "@/lib/config/server-env";
import { AppError, ERROR_CODES } from "@/lib/errors/app-error";

/**
 * Privileged Supabase client. **Bypasses Row Level Security entirely.**
 *
 * Nothing in the application should reach for this by default. The normal
 * server client in `server.ts` acts as the signed-in user and is subject to
 * RLS, which is what makes tenant isolation hold even when a query is wrong.
 *
 * Legitimate uses are operations that have no user session to act on behalf of:
 *
 * - the Meta webhook, which is authenticated by signature rather than by a
 *   session, and must write a message for a workspace nobody is signed in to;
 * - administrative tooling that deliberately spans workspaces.
 *
 * Every call site needs a comment justifying why the RLS-bound client is not
 * sufficient. If there is no such reason, use `createSupabaseServerClient()`.
 */
export function createSupabaseAdminClient() {
  const secretKey = serverEnv().SUPABASE_SECRET_KEY;

  if (secretKey === undefined) {
    throw new AppError(
      ERROR_CODES.CONFIGURATION_ERROR,
      "This feature is not available right now.",
      {
        context: {
          reason: "SUPABASE_SECRET_KEY is not set",
          hint: "Set it in .env.local; see .env.example",
        },
      },
    );
  }

  return createClient(clientEnv().NEXT_PUBLIC_SUPABASE_URL, secretKey, {
    auth: {
      // There is no user session here and nothing to refresh. Persisting one
      // would risk this privileged client adopting a user's identity.
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
