import "server-only";
import { createHash } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { AppError, ERROR_CODES } from "@/lib/errors/app-error";
import { logger } from "@/lib/logger/logger";
import {
  phoneNumberIdsInPayload,
  type WebhookPayload,
} from "@/server/integrations/meta/webhook-payload";

/**
 * Storing inbound webhook deliveries.
 *
 * Meta cannot be asked for an event again — historical webhook data is not
 * queryable — so a delivery we fail to write is a patient message destroyed.
 * Everything here is arranged around that: write the raw payload first,
 * acknowledge, and interpret afterwards (Task 6.3).
 *
 * The privileged Supabase client is used because a webhook has no session. It
 * is authenticated by Meta's signature, and it must write for a workspace
 * nobody is signed in to, so the RLS-bound client has no identity to act as.
 */

const OPERATION = "whatsapp.webhook.record";

export type RecordedEvent = {
  readonly eventId: string;
  /** False when this delivery had already been stored — a Meta retry. */
  readonly created: boolean;
  readonly workspaceId: string | null;
};

/** Postgres unique-violation. The expected outcome of a retry, not a fault. */
const UNIQUE_VIOLATION = "23505";

/**
 * Digest of the exact bytes Meta sent.
 *
 * A retry repeats the body verbatim, so this identifies one. Computed over the
 * raw string for the same reason the signature is: re-serialising the parsed
 * JSON would produce a different digest for identical deliveries.
 */
export function hashWebhookBody(rawBody: string): string {
  return createHash("sha256").update(rawBody, "utf8").digest("hex");
}

/**
 * Stores one delivery, exactly once.
 *
 * @param rawBody The body as received, used for the idempotency digest.
 * @param payload The same body, already validated.
 */
export async function recordWebhookEvent({
  rawBody,
  payload,
  requestId,
}: {
  rawBody: string;
  payload: WebhookPayload;
  requestId: string;
}): Promise<RecordedEvent> {
  const admin = createSupabaseAdminClient();
  const payloadHash = hashWebhookBody(rawBody);

  // A batch can in principle span numbers. The first is used for routing and
  // the whole payload is stored regardless, so nothing is lost if it does.
  const [phoneNumberId] = phoneNumberIdsInPayload(payload);
  const owner =
    phoneNumberId === undefined
      ? null
      : await findConnectionByPhoneNumberId(phoneNumberId, requestId);

  const { data, error } = await admin
    .from("whatsapp_webhook_events")
    .insert({
      payload_hash: payloadHash,
      connection_id: owner?.connectionId ?? null,
      workspace_id: owner?.workspaceId ?? null,
      phone_number_id: phoneNumberId ?? null,
      payload: payload as never,
    })
    .select("id")
    .single();

  if (error !== null) {
    if (error.code === UNIQUE_VIOLATION) {
      // Meta retried a delivery we already hold. Reporting this as an error
      // would make the normal retry path look like a failure; it is the
      // idempotency boundary doing its job.
      logger.info("duplicate webhook delivery ignored", {
        requestId,
        operation: OPERATION,
        workspaceId: owner?.workspaceId,
      });

      return {
        eventId: await findEventIdByHash(payloadHash, requestId),
        created: false,
        workspaceId: owner?.workspaceId ?? null,
      };
    }

    throw new AppError(ERROR_CODES.DATABASE_ERROR, undefined, {
      context: { operation: OPERATION, requestId, databaseCode: error.code },
      cause: error,
    });
  }

  logger.info("webhook delivery stored", {
    requestId,
    operation: OPERATION,
    providerEventId: data.id,
    workspaceId: owner?.workspaceId,
    // Absence of a workspace is the signal that a number is not connected to
    // any account here, which is a configuration problem worth seeing.
    routed: owner !== null,
  });

  return {
    eventId: data.id,
    created: true,
    workspaceId: owner?.workspaceId ?? null,
  };
}

/**
 * Finds which workspace owns a business phone number.
 *
 * Only a `connected` connection counts. A pending or disconnected one must not
 * receive messages: accepting events for a half-finished onboarding would put
 * patient messages into an inbox the doctor has not finished claiming.
 */
async function findConnectionByPhoneNumberId(
  phoneNumberId: string,
  requestId: string,
): Promise<{ connectionId: string; workspaceId: string } | null> {
  const admin = createSupabaseAdminClient();

  const { data, error } = await admin
    .from("whatsapp_connections")
    .select("id, workspace_id")
    .eq("phone_number_id", phoneNumberId)
    .eq("status", "connected")
    .maybeSingle();

  if (error !== null) {
    throw new AppError(ERROR_CODES.DATABASE_ERROR, undefined, {
      context: { operation: OPERATION, requestId, databaseCode: error.code },
      cause: error,
    });
  }

  if (data === null) {
    // Not an error. It means Meta is sending us events for a number no account
    // here has connected — misconfiguration, or a connection since removed.
    // The event is still stored; only its ownership is unknown.
    logger.warn("webhook delivery for an unknown phone number", {
      requestId,
      operation: OPERATION,
      // The id, not the number itself: one is a provider identifier, the other
      // is the doctor's contact detail.
      phoneNumberId,
    });

    return null;
  }

  return { connectionId: data.id, workspaceId: data.workspace_id };
}

/** Recovers the id of a delivery that was already stored. */
async function findEventIdByHash(
  payloadHash: string,
  requestId: string,
): Promise<string> {
  const admin = createSupabaseAdminClient();

  const { data, error } = await admin
    .from("whatsapp_webhook_events")
    .select("id")
    .eq("payload_hash", payloadHash)
    .single();

  if (error !== null) {
    throw new AppError(ERROR_CODES.DATABASE_ERROR, undefined, {
      context: { operation: OPERATION, requestId, databaseCode: error.code },
      cause: error,
    });
  }

  return data.id;
}
