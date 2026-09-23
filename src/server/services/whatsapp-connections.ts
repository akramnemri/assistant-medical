import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/errors/app-error";
import { logger } from "@/lib/logger/logger";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

/**
 * Reads of a workspace's WhatsApp connection state.
 *
 * The Supabase client is passed in so these can be tested without a request
 * context. It is expected to be RLS-bound, so a member only ever sees their own
 * workspace's rows even if a query here were wrong.
 *
 * Writes are deliberately absent. Creating and transitioning a connection
 * happens in the server-side onboarding callback and the webhook (Phases 5 and
 * 6), both of which handle provider credentials and run with the secret key.
 * There is no RLS write policy, so a write attempted from here would be
 * rejected by the database rather than silently succeed.
 */

export type WhatsAppConnectionStatus =
  Database["public"]["Enums"]["whatsapp_connection_status"];

/**
 * A connection as the UI needs it.
 *
 * Note what is absent: the access token. It lives in a separate table that no
 * RLS policy can reach, so it cannot arrive here by accident.
 */
export type WhatsAppConnection = {
  readonly id: string;
  readonly status: WhatsAppConnectionStatus;
  readonly phoneNumberId: string | null;
  readonly wabaId: string | null;
  readonly displayPhoneNumber: string | null;
  readonly verifiedName: string | null;
  readonly errorCode: string | null;
  readonly connectedAt: string | null;
  readonly disconnectedAt: string | null;
};

/**
 * Whether a connection is usable for sending and receiving right now.
 *
 * A single place to ask, so the answer cannot drift between the connection
 * screen, the conversation UI and the webhook.
 */
export function isUsable(connection: WhatsAppConnection): boolean {
  return connection.status === "connected";
}

/**
 * Every connection belonging to the given workspace, newest first.
 *
 * The workspace id must come from the session (see `getCurrentWorkspace`),
 * never from the browser. RLS enforces this independently, but passing an
 * unchecked id would still be a bug worth catching in review.
 */
export async function listWorkspaceConnections(
  supabase: Client,
  workspaceId: string,
): Promise<WhatsAppConnection[]> {
  const { data, error } = await supabase
    .from("whatsapp_connections")
    .select(
      "id, status, phone_number_id, waba_id, display_phone_number, verified_name, error_code, connected_at, disconnected_at",
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  if (error) {
    logger.error("failed to list WhatsApp connections", error, {
      operation: "whatsapp.connections.list",
      workspaceId,
    });

    throw new AppError(ERROR_CODES.DATABASE_ERROR, undefined, {
      context: {
        operation: "whatsapp.connections.list",
        providerCode: error.code,
      },
      cause: error,
    });
  }

  return data.map((row) => ({
    id: row.id,
    status: row.status,
    phoneNumberId: row.phone_number_id,
    wabaId: row.waba_id,
    displayPhoneNumber: row.display_phone_number,
    verifiedName: row.verified_name,
    errorCode: row.error_code,
    connectedAt: row.connected_at,
    disconnectedAt: row.disconnected_at,
  }));
}

/**
 * The connection a workspace currently works through, or `null` when it has
 * never started onboarding.
 *
 * A workspace has at most one active connection today. Returning the active one
 * in preference to a stale `disconnected` row means the screen shows the live
 * state rather than whatever happens to be newest.
 */
export async function getActiveConnection(
  supabase: Client,
  workspaceId: string,
): Promise<WhatsAppConnection | null> {
  const connections = await listWorkspaceConnections(supabase, workspaceId);

  return (
    connections.find((connection) => connection.status === "connected") ??
    connections.find((connection) => connection.status === "pending") ??
    connections[0] ??
    null
  );
}
