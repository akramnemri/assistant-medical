import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/session";
import { logger } from "@/lib/logger/logger";

/**
 * Platform administration access.
 *
 * A platform admin reviews accounts across every tenant, which makes this the
 * single most powerful check in the application — and the reason it is written
 * to fail closed at every step. Any error, any missing session, any unexpected
 * result means "not an admin".
 *
 * Deliberately **not** the same thing as a workspace 'owner' or 'admin'. Those
 * administer one practice. Treating them as equivalent would hand every doctor
 * visibility across all the others.
 */

const OPERATION = "admin.authorize";

/**
 * Whether the signed-in user is a platform administrator.
 *
 * Asks the database through `is_platform_admin()`, so the answer comes from the
 * same predicate a Row Level Security policy would use rather than from
 * anything the browser supplied.
 */
export async function isCurrentUserPlatformAdmin(): Promise<boolean> {
  const user = await getCurrentUser();

  if (user === null) return false;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("is_platform_admin");

  if (error !== null) {
    // Fail closed, loudly. A broken check must not become an open door, and
    // this is exactly the failure someone needs to see in the logs.
    logger.error("platform admin check failed; denying access", error, {
      operation: OPERATION,
      userId: user.id,
    });

    return false;
  }

  return data === true;
}

/**
 * Guards an admin-only server component or route.
 *
 * Returns the outcome rather than throwing, so the caller decides how to
 * respond. The admin routes answer with a 404: a 403 would confirm to an
 * unauthorized user that the route exists and that there is something there
 * worth finding.
 */
export async function assertPlatformAdminAccess(): Promise<
  { readonly allowed: true } | { readonly allowed: false }
> {
  const allowed = await isCurrentUserPlatformAdmin();

  if (!allowed) {
    // Warn, not info: every denial here is either a misconfigured account or
    // someone trying the URL. Both are worth seeing.
    logger.warn("denied access to an admin route", { operation: OPERATION });
  }

  return allowed ? { allowed: true } : { allowed: false };
}
