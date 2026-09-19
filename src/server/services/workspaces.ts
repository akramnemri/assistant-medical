import type { SupabaseClient, User } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/errors/app-error";
import { logger } from "@/lib/logger/logger";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

/**
 * Workspace reads for the signed-in user.
 *
 * The Supabase client is passed in rather than built here, so these functions
 * can be tested against a real database without a request context.
 *
 * The client is expected to be RLS-bound, so the database independently
 * enforces what these may return. The application-side checks are the second
 * layer, not the only one.
 *
 * Nothing in this module accepts a workspace id from the browser as
 * authoritative — membership is always derived from the session.
 */

export type WorkspaceRole = Database["public"]["Enums"]["workspace_role"];

export type Workspace = {
  readonly id: string;
  readonly name: string;
  readonly role: WorkspaceRole;
};

/**
 * Every workspace the signed-in user belongs to, oldest first.
 *
 * Selects only the columns the UI needs rather than `*`, so adding a column to
 * the table later does not silently widen what gets shipped to the browser.
 */
export async function listUserWorkspaces(
  supabase: Client,
  user: User,
): Promise<Workspace[]> {
  const { data, error } = await supabase
    .from("workspace_members")
    .select("role, created_at, workspaces (id, name)")
    .order("created_at", { ascending: true });

  if (error) {
    logger.error("failed to list workspaces", error, {
      operation: "workspaces.list",
      userId: user.id,
    });

    throw new AppError(ERROR_CODES.DATABASE_ERROR, undefined, {
      context: { operation: "workspaces.list", providerCode: error.code },
      cause: error,
    });
  }

  return data.flatMap((membership) => {
    // The join is nullable in the generated types even though the foreign key
    // makes it impossible in practice. Skipping rather than asserting keeps a
    // surprising row from becoming a crash.
    if (membership.workspaces === null) return [];

    return [
      {
        id: membership.workspaces.id,
        name: membership.workspaces.name,
        role: membership.role,
      },
    ];
  });
}

/**
 * The workspace to act on for this request.
 *
 * A doctor has exactly one workspace today, created for them at sign-up. When
 * multiple workspaces and a switcher arrive, this becomes "the selected
 * workspace" and every caller keeps working.
 */
export async function getCurrentWorkspace(
  supabase: Client,
  user: User,
): Promise<Workspace> {
  const workspaces = await listUserWorkspaces(supabase, user);
  const workspace = workspaces[0];

  if (workspace === undefined) {
    // Sign-up provisions a workspace in the same transaction as the user, so
    // this means that invariant has been broken — not an ordinary empty state.
    throw new AppError(ERROR_CODES.NOT_FOUND, "No workspace is available.", {
      context: { operation: "workspaces.getCurrent", reason: "no membership rows" },
    });
  }

  return workspace;
}
