"use server";

import { getRequestContext } from "@/server/request-context";
import {
  getConversation,
  listMessages,
  type Message,
} from "@/server/services/conversations";
import { isAppError } from "@/lib/errors/app-error";
import { logger } from "@/lib/logger/logger";
import { newRequestId } from "@/lib/request-id";

export type LoadOlderResult =
  | {
      readonly ok: true;
      readonly messages: Message[];
      readonly nextCursor: string | null;
    }
  | { readonly ok: false; readonly error: string };

/**
 * Fetches an older page of a thread.
 *
 * **Both arguments arrive from the browser and are treated as claims.** The
 * conversation id is re-authorized against the session's workspace on every
 * call — a server action is a public HTTP endpoint, not an internal function,
 * and nothing stops a caller invoking it with someone else's id.
 *
 * `getConversation` is what performs that check: it filters by the workspace
 * derived from the session, so another tenant's id comes back as NOT_FOUND. RLS
 * would independently return no rows, but failing here means the caller cannot
 * even learn whether the id exists.
 *
 * Returns a result object rather than throwing, because a thrown error in a
 * server action reaches the client as an opaque digest — useless for showing
 * the reader what went wrong.
 */
export async function loadOlderMessagesAction(
  conversationId: string,
  cursor: string,
): Promise<LoadOlderResult> {
  const requestId = newRequestId();

  try {
    const { supabase, workspace } = await getRequestContext();

    // Authorization. Must happen before any message is read.
    await getConversation(supabase, workspace.id, conversationId);

    const page = await listMessages(supabase, conversationId, { cursor });

    return { ok: true, messages: page.messages, nextCursor: page.nextCursor };
  } catch (error) {
    const safeMessage = isAppError(error)
      ? error.message
      : "Older messages could not be loaded.";

    // The conversation id is logged; message content is not.
    logger.warn("loading older messages failed", {
      requestId,
      operation: "conversations.loadOlder",
      conversationId,
      code: isAppError(error) ? error.code : "UNKNOWN",
    });

    return { ok: false, error: safeMessage };
  }
}
