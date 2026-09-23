import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { AppError, ERROR_CODES } from "@/lib/errors/app-error";
import { logger } from "@/lib/logger/logger";
import { normalizeInboundDelivery } from "@/server/integrations/meta/inbound-messages";
import {
  parseWebhookPayload,
  type WebhookPayload,
} from "@/server/integrations/meta/webhook-payload";

/**
 * Turning a stored delivery into conversation rows (Task 6.3).
 *
 * Separated from the receiver on purpose. The receiver's job is to not lose the
 * event; this one's job is to interpret it, and interpretation is the part that
 * can be got wrong and re-run. Because the raw payload is already durable, a
 * bug here is recoverable: fix it and replay the event. That would not be true
 * if normalisation happened inside the request and the payload were discarded.
 *
 * Uses the privileged client: there is no session behind a webhook, and it must
 * write into a workspace nobody is signed in to.
 */

const OPERATION = "whatsapp.webhook.process";

/** Postgres unique violation — the expected result of a duplicate, not a fault. */
const UNIQUE_VIOLATION = "23505";

export type ProcessedEvent = {
  readonly eventId: string;
  readonly inserted: number;
  /** Messages already stored: a Meta retry, or an overlapping batch. */
  readonly duplicates: number;
  /** Messages we could not read. Kept in the payload for replay. */
  readonly skipped: number;
};

/**
 * Processes one stored webhook event.
 *
 * Idempotent at the message level, so calling it twice for the same event is
 * safe — which is what makes replay after a fix possible.
 */
export async function processWebhookEvent({
  eventId,
  requestId,
}: {
  eventId: string;
  requestId: string;
}): Promise<ProcessedEvent> {
  const admin = createSupabaseAdminClient();

  const { data: event, error: loadError } = await admin
    .from("whatsapp_webhook_events")
    .select("id, workspace_id, connection_id, payload, status")
    .eq("id", eventId)
    .single();

  if (loadError !== null) {
    throw new AppError(ERROR_CODES.DATABASE_ERROR, undefined, {
      context: { operation: OPERATION, requestId, databaseCode: loadError.code },
      cause: loadError,
    });
  }

  // An event we could not attribute to a workspace has nowhere to go. It stays
  // stored so the misconfiguration can be found and the event replayed once the
  // number is connected.
  if (event.workspace_id === null || event.connection_id === null) {
    await markEvent(eventId, "ignored", requestId);

    logger.warn("webhook event has no owning workspace; not processed", {
      requestId,
      operation: OPERATION,
      providerEventId: eventId,
    });

    return { eventId, inserted: 0, duplicates: 0, skipped: 0 };
  }

  const payload = reparsePayload(event.payload);

  if (payload === null) {
    await markEvent(eventId, "failed", requestId, {
      errorCode: "PAYLOAD_UNREADABLE",
      errorMessage: "Stored payload no longer matches the expected shape.",
    });

    return { eventId, inserted: 0, duplicates: 0, skipped: 0 };
  }

  const delivery = normalizeInboundDelivery(payload);
  let inserted = 0;
  let duplicates = 0;

  for (const message of delivery.messages) {
    const contactId = await upsertContact({
      workspaceId: event.workspace_id,
      waId: message.waId,
      profileName: message.profileName,
      requestId,
    });

    const conversationId = await upsertConversation({
      workspaceId: event.workspace_id,
      connectionId: event.connection_id,
      contactId,
      requestId,
    });

    const stored = await insertMessage({
      workspaceId: event.workspace_id,
      conversationId,
      message,
      requestId,
    });

    if (stored) inserted += 1;
    else duplicates += 1;
  }

  await markEvent(eventId, "processed", requestId);

  logger.info("webhook event processed", {
    requestId,
    operation: OPERATION,
    providerEventId: eventId,
    workspaceId: event.workspace_id,
    inserted,
    duplicates,
    skipped: delivery.skipped.length,
    ignoredFields: delivery.ignoredFields,
  });

  // Logged at warn because a skipped message is a patient message that did not
  // reach a doctor. The payload is retained, so it is recoverable — but only if
  // somebody notices.
  for (const skip of delivery.skipped) {
    logger.warn("inbound message skipped", {
      requestId,
      operation: OPERATION,
      providerEventId: eventId,
      reason: skip.reason,
      providerMessageId: skip.providerMessageId,
    });
  }

  return {
    eventId,
    inserted,
    duplicates,
    skipped: delivery.skipped.length,
  };
}

/** Revalidates the stored JSON: the column is `jsonb`, so its type is `unknown`. */
function reparsePayload(payload: unknown): WebhookPayload | null {
  const parsed = parseWebhookPayload(JSON.stringify(payload));
  return parsed.outcome === "parsed" ? parsed.payload : null;
}

/**
 * The patient's identity within this workspace.
 *
 * `onConflict` rather than a read-then-write: two messages from the same new
 * patient in one batch would otherwise race and one would fail.
 */
async function upsertContact({
  workspaceId,
  waId,
  profileName,
  requestId,
}: {
  workspaceId: string;
  waId: string;
  profileName: string | null;
  requestId: string;
}): Promise<string> {
  const admin = createSupabaseAdminClient();

  const { data, error } = await admin
    .from("contacts")
    .upsert(
      {
        workspace_id: workspaceId,
        wa_id: waId,
        // A patient who renames their WhatsApp profile should show the new
        // name, but an absent name must not erase one we already have.
        ...(profileName === null ? {} : { profile_name: profileName }),
      },
      { onConflict: "workspace_id,wa_id" },
    )
    .select("id")
    .single();

  if (error !== null) {
    throw new AppError(ERROR_CODES.DATABASE_ERROR, undefined, {
      context: {
        operation: OPERATION,
        requestId,
        step: "contact",
        databaseCode: error.code,
      },
      cause: error,
    });
  }

  return data.id;
}

/** One thread per patient per connected number. */
async function upsertConversation({
  workspaceId,
  connectionId,
  contactId,
  requestId,
}: {
  workspaceId: string;
  connectionId: string;
  contactId: string;
  requestId: string;
}): Promise<string> {
  const admin = createSupabaseAdminClient();

  const { data, error } = await admin
    .from("conversations")
    .upsert(
      { workspace_id: workspaceId, connection_id: connectionId, contact_id: contactId },
      { onConflict: "connection_id,contact_id" },
    )
    .select("id")
    .single();

  if (error !== null) {
    throw new AppError(ERROR_CODES.DATABASE_ERROR, undefined, {
      context: {
        operation: OPERATION,
        requestId,
        step: "conversation",
        databaseCode: error.code,
      },
      cause: error,
    });
  }

  return data.id;
}

/**
 * Stores one message.
 *
 * @returns true if it was inserted, false if it was already there.
 *
 * The duplicate check is the unique index on `provider_message_id` raising
 * 23505, not a lookup. A lookup would race against a concurrent retry of the
 * same delivery and let both inserts through.
 */
async function insertMessage({
  workspaceId,
  conversationId,
  message,
  requestId,
}: {
  workspaceId: string;
  conversationId: string;
  message: ReturnType<typeof normalizeInboundDelivery>["messages"][number];
  requestId: string;
}): Promise<boolean> {
  const admin = createSupabaseAdminClient();

  const { error } = await admin.from("messages").insert({
    workspace_id: workspaceId,
    conversation_id: conversationId,
    direction: "inbound",
    message_type: message.messageType,
    provider_message_id: message.providerMessageId,
    text_body: message.textBody,
    sent_at: message.sentAt,
  });

  if (error === null) return true;
  if (error.code === UNIQUE_VIOLATION) return false;

  throw new AppError(ERROR_CODES.DATABASE_ERROR, undefined, {
    context: {
      operation: OPERATION,
      requestId,
      step: "message",
      databaseCode: error.code,
    },
    cause: error,
  });
}

async function markEvent(
  eventId: string,
  status: "processed" | "failed" | "ignored",
  requestId: string,
  failure?: { errorCode: string; errorMessage: string },
): Promise<void> {
  const admin = createSupabaseAdminClient();

  const { error } = await admin
    .from("whatsapp_webhook_events")
    .update({
      status,
      processed_at: new Date().toISOString(),
      error_code: failure?.errorCode ?? null,
      error_message: failure?.errorMessage ?? null,
    })
    .eq("id", eventId);

  if (error !== null) {
    // Deliberately not thrown. The messages are already stored; failing here
    // would make the caller think processing failed and retry it, which is
    // safe but misleading. The event simply stays 'received' and is replayed.
    logger.error("could not update webhook event status", error, {
      requestId,
      operation: OPERATION,
      providerEventId: eventId,
      status,
    });
  }
}
