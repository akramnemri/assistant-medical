import { clientEnv } from "@/lib/config/client-env";
import { hasSupabaseSecretKey } from "@/lib/config/server-env";
import { toErrorResponse } from "@/lib/errors/response";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/session";
import { getRequestId, REQUEST_ID_HEADER } from "@/lib/request-id";

/**
 * Development-only connectivity check.
 *
 * Confirms that configuration parsed, that a server client can be constructed,
 * and that the local Supabase stack is actually reachable — the three things
 * that are otherwise only verified indirectly by unit tests with fake values.
 *
 * Reports **booleans** for credentials, never the values themselves. Returns
 * 404 outside development.
 */

const OPERATION = "dev.supabase.health";

export async function GET(request: Request): Promise<Response> {
  if (process.env.NODE_ENV === "production") {
    return new Response("Not found", { status: 404 });
  }

  const requestId = getRequestId(request.headers);

  try {
    const env = clientEnv();
    const supabase = await createSupabaseServerClient();

    // `getUser()` against a signed-out browser is expected to report "no user".
    // What is being tested here is that the request reached the auth service at
    // all, so a transport failure is the only interesting outcome.
    const user = await getCurrentUser();

    // Proves PostgREST is up and RLS is applied. Signed out this returns zero
    // rows and no error, which is the correct answer rather than a failure —
    // the policy denies the read, it does not error.
    const probe = await supabase.from("profiles").select("id").limit(1);

    return Response.json(
      {
        ok: true,
        supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
        publishableKeyConfigured: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.length > 0,
        secretKeyConfigured: hasSupabaseSecretKey(),
        authReachable: true,
        signedInUser: user === null ? null : user.id,
        postgrestReachable: probe.error === null,
        visibleProfileCount: probe.data?.length ?? 0,
        postgrestCode: probe.error?.code ?? null,
        requestId,
      },
      { headers: { [REQUEST_ID_HEADER]: requestId } },
    );
  } catch (error) {
    return toErrorResponse(error, { requestId, operation: OPERATION });
  }
}
