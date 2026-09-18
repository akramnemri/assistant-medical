import "server-only";
import type { User } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppError, ERROR_CODES } from "@/lib/errors/app-error";
import { logger } from "@/lib/logger/logger";

/**
 * Server-side session helpers.
 *
 * These always use `auth.getUser()`, never `auth.getSession()`.
 *
 * `getSession()` returns whatever is in the cookie without verifying it against
 * the auth server, so a forged or stale cookie would be trusted. `getUser()`
 * revalidates the token. On the server — where the answer decides what data a
 * request may read — only the revalidated result is safe to act on.
 */

/** The signed-in user, or `null` when there is no valid session. */
export async function getCurrentUser(): Promise<User | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error) {
    // A missing or expired session is ordinary traffic, not a fault: a signed
    // out visitor hitting a protected page produces exactly this. Recording it
    // at debug keeps the error channel meaningful.
    logger.debug("no authenticated user for request", {
      operation: "auth.getCurrentUser",
      reason: error.name,
    });
    return null;
  }

  return data.user;
}

/**
 * The signed-in user, or throws `UNAUTHENTICATED`.
 *
 * For server code whose next line would be meaningless without a user. Prefer
 * this over `getCurrentUser()` followed by a manual null check, so the
 * unauthenticated path cannot be forgotten.
 */
export async function requireCurrentUser(): Promise<User> {
  const user = await getCurrentUser();

  if (user === null) {
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, undefined, {
      context: { operation: "auth.requireCurrentUser" },
    });
  }

  return user;
}
