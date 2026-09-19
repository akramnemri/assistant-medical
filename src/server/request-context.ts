import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireCurrentUser } from "@/lib/supabase/session";
import { getCurrentWorkspace, type Workspace } from "@/server/services/workspaces";
import type { Database } from "@/types/database";

/**
 * The three things almost every authenticated page needs: an RLS-bound client,
 * the signed-in user, and the workspace being acted on.
 *
 * This is where the request-scoped client is created. Services take a client as
 * an argument instead of building their own, so the only place that reads
 * cookies is here — which is what lets the services be tested directly.
 *
 * The workspace is derived from the session, never from a route parameter or
 * request body. A workspace id arriving from the browser is a claim, not a fact.
 */
export type RequestContext = {
  readonly supabase: SupabaseClient<Database>;
  readonly user: User;
  readonly workspace: Workspace;
};

export async function getRequestContext(): Promise<RequestContext> {
  const supabase = await createSupabaseServerClient();
  const user = await requireCurrentUser();
  const workspace = await getCurrentWorkspace(supabase, user);

  return { supabase, user, workspace };
}
