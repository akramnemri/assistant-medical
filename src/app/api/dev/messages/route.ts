import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { AppError, ERROR_CODES } from "@/lib/errors/app-error";
import { toErrorResponse } from "@/lib/errors/response";
import { getRequestId, REQUEST_ID_HEADER } from "@/lib/request-id";

/**
 * Development-only message injector.
 *
 * The roadmap's realtime check needs "a controlled development mechanism" to
 * create a message the way the webhook eventually will: written by trusted
 * server code, not by the browser. Members have no insert policy on `messages`,
 * so this uses the admin client — the same reason the real webhook will.
 *
 * Returns 404 outside development.
 *
 *   POST /api/dev/messages
 *   { "conversationId": "...", "text": "hello", "direction": "inbound" }
 */

const OPERATION = "dev.messages.insert";

export async function POST(request: Request): Promise<Response> {
  if (process.env.NODE_ENV === "production") {
    return new Response("Not found", { status: 404 });
  }

  const requestId = getRequestId(request.headers);

  try {
    const body: unknown = await request.json().catch(() => null);

    if (typeof body !== "object" || body === null) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, "A JSON body is required.");
    }

    const { conversationId, text, direction } = body as Record<string, unknown>;

    if (typeof conversationId !== "string" || conversationId === "") {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, "conversationId is required.");
    }

    // This bypasses RLS, so it must not be usable to write into an arbitrary
    // workspace by guessing ids. It reads the conversation first and takes the
    // workspace from the row rather than from the request.
    const admin = createSupabaseAdminClient();

    const { data: conversation, error: lookupError } = await admin
      .from("conversations")
      .select("id, workspace_id")
      .eq("id", conversationId)
      .maybeSingle();

    if (lookupError !== null || conversation === null) {
      throw new AppError(ERROR_CODES.NOT_FOUND, "Conversation not found.", {
        context: { operation: OPERATION, providerCode: lookupError?.code },
      });
    }

    const { data: message, error } = await admin
      .from("messages")
      .insert({
        workspace_id: conversation.workspace_id,
        conversation_id: conversation.id,
        direction: direction === "outbound" ? "outbound" : "inbound",
        message_type: "text",
        // Unique per call, so repeated injections do not collide with the
        // provider-message-id constraint that makes the webhook idempotent.
        provider_message_id: `wamid.DEV.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`,
        text_body:
          typeof text === "string" && text.trim() !== ""
            ? text
            : `Synthetic realtime message at ${new Date().toISOString()}`,
        sent_at: new Date().toISOString(),
      })
      .select("id, sent_at")
      .single();

    if (error !== null) {
      throw new AppError(ERROR_CODES.DATABASE_ERROR, undefined, {
        context: { operation: OPERATION, providerCode: error.code },
        cause: error,
      });
    }

    return Response.json(
      { ok: true, messageId: message.id, sentAt: message.sent_at, requestId },
      { headers: { [REQUEST_ID_HEADER]: requestId } },
    );
  } catch (error) {
    return toErrorResponse(error, { requestId, operation: OPERATION });
  }
}
