import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { AppError, ERROR_CODES } from "@/lib/errors/app-error";
import { logger } from "@/lib/logger/logger";
import { randomInt } from "node:crypto";
import {
  exchangeCodeForToken,
  fetchPhoneNumber,
  registerPhoneNumber,
  subscribeWabaToApp,
} from "@/server/integrations/meta/client";

/**
 * Completing WhatsApp onboarding.
 *
 * Runs entirely server-side. It uses the admin client because
 * `whatsapp_connections` has no RLS write policy and
 * `whatsapp_connection_secrets` has no policy at all — the token must be
 * written somewhere the browser can never read.
 *
 * **Unverified against a live Meta app.** The persistence and idempotency
 * behaviour is covered by tests with a mocked provider; the provider contract
 * itself has not been exercised with real credentials.
 */

export type CompleteOnboardingInput = {
  /** Derived from the session by the caller — never taken from the request. */
  readonly workspaceId: string;
  /** Short-lived, single-use code returned by Embedded Signup. */
  readonly code: string;
  /** Claimed by the browser; verified against Meta before it is trusted. */
  readonly phoneNumberId: string;
  readonly wabaId: string;
  readonly requestId: string;
};

export type CompleteOnboardingResult = {
  readonly connectionId: string;
  /** True when this call created the connection rather than refreshing one. */
  readonly created: boolean;
};

/**
 * Exchanges the code, verifies the claimed number, and stores the connection.
 *
 * Idempotent by the provider's phone number id: a repeated completion callback
 * — a double-click, a retried request, a browser that fired the handler twice —
 * updates the existing connection instead of creating a second one. The
 * database also refuses a duplicate via the partial unique index on active
 * `phone_number_id`, so this holds even under a concurrent retry.
 */
export async function completeWhatsAppOnboarding(
  input: CompleteOnboardingInput,
): Promise<CompleteOnboardingResult> {
  const { workspaceId, code, phoneNumberId, wabaId, requestId } = input;
  const operation = "whatsapp.onboarding.complete";

  // Never log the code: it is a bearer credential until it is spent.
  logger.info("completing WhatsApp onboarding", {
    requestId,
    operation,
    workspaceId,
  });

  const admin = createSupabaseAdminClient();

  // A live number belongs to exactly one workspace. Checking first turns what
  // would otherwise be a raw 23505 into an explanatory error — the database
  // constraint remains the actual guarantee.
  const { data: existing, error: lookupError } = await admin
    .from("whatsapp_connections")
    .select("id, workspace_id, status")
    .eq("phone_number_id", phoneNumberId)
    .in("status", ["pending", "connected"])
    .maybeSingle();

  if (lookupError !== null) {
    throw databaseError(operation, lookupError, { requestId, workspaceId });
  }

  if (existing !== null && existing.workspace_id !== workspaceId) {
    logger.warn("WhatsApp number already connected to another workspace", {
      requestId,
      operation,
      workspaceId,
    });

    throw new AppError(
      ERROR_CODES.CONFLICT,
      "That WhatsApp number is already connected to another account.",
      { context: { operation, reason: "phone number owned by another workspace" } },
    );
  }

  // The exchange happens before any write, so a failure leaves no
  // half-provisioned connection behind.
  const token = await exchangeCodeForToken(code);

  // The browser supplied `phoneNumberId`. This proves the token Meta just
  // issued actually grants access to it.
  const phoneNumber = await fetchPhoneNumber(phoneNumberId, token.accessToken);

  if (phoneNumber.id !== phoneNumberId) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      "WhatsApp returned a different number than expected. Please start setup again.",
      { context: { operation, reason: "phone number id mismatch" } },
    );
  }

  const { data: connection, error: upsertError } = await admin
    .from("whatsapp_connections")
    .upsert(
      {
        ...(existing === null ? {} : { id: existing.id }),
        workspace_id: workspaceId,
        status: "connected" as const,
        phone_number_id: phoneNumber.id,
        waba_id: wabaId,
        display_phone_number: phoneNumber.displayPhoneNumber,
        verified_name: phoneNumber.verifiedName,
        // A successful reconnection clears a previous failure, so a stale
        // reason cannot linger on a working connection.
        error_code: null,
        error_message: null,
        error_at: null,
      },
      { onConflict: "id" },
    )
    .select("id")
    .single();

  if (upsertError !== null) {
    throw databaseError(operation, upsertError, { requestId, workspaceId });
  }

  // Re-registering a number needs the PIN it was first registered with, so a
  // reconnection reuses the stored one. Generating a fresh PIN here would make
  // the number un-reregisterable — Meta would reject it, and only Meta support
  // could recover it.
  const { data: existingSecret } = await admin
    .from("whatsapp_connection_secrets")
    .select("two_step_pin")
    .eq("connection_id", connection.id)
    .maybeSingle();

  const pin = existingSecret?.two_step_pin ?? generateTwoStepPin();

  // Stored separately from the connection row, in a table no policy can read.
  // Written **before** registration, so a PIN that Meta accepts can never be
  // lost by a crash between the two.
  const { error: secretError } = await admin.from("whatsapp_connection_secrets").upsert(
    {
      connection_id: connection.id,
      access_token: token.accessToken,
      token_expires_at: token.expiresAt,
      two_step_pin: pin,
    },
    { onConflict: "connection_id" },
  );

  if (secretError !== null) {
    // The connection exists but has no usable credential, which is exactly
    // what the 'error' state is for: visible, explicable, and recoverable by
    // reconnecting, rather than a connection that silently never works.
    await markConnectionFailed(connection.id, "CREDENTIAL_STORAGE_FAILED");

    throw databaseError(operation, secretError, { requestId, workspaceId });
  }

  // Everything above proves ownership and stores credentials. Neither makes the
  // number usable: without these two calls the connection looks healthy and
  // receives nothing, which is worse than failing outright.
  await activateConnection({
    connectionId: connection.id,
    phoneNumberId: phoneNumber.id,
    wabaId,
    pin,
    accessToken: token.accessToken,
    requestId,
    workspaceId,
  });

  logger.info("WhatsApp onboarding completed", {
    requestId,
    operation,
    workspaceId,
    created: existing === null,
  });

  return { connectionId: connection.id, created: existing === null };
}

/** Six digits, uniformly random. Meta accepts nothing else. */
function generateTwoStepPin(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * Makes a connected number actually able to send and receive.
 *
 * Two provider calls, in this order:
 *
 * 1. **Subscribe the WABA to our app.** Until this happens Meta delivers no
 *    webhooks for the account, whatever the app-level subscription says.
 * 2. **Register the phone number.** Embedded Signup proves the business owns
 *    the number; registration is what turns it on for the Cloud API.
 *
 * A failure marks the connection `error` rather than throwing the whole
 * onboarding away. The token is already stored, so the work is not lost, and
 * the doctor sees a state they can act on instead of a connection that
 * mysteriously never delivers.
 *
 * Registration is **not retried**: Meta permits ten attempts per number per 72
 * hours, and burning them would lock a real practice out of its own number for
 * three days.
 */
async function activateConnection({
  connectionId,
  phoneNumberId,
  wabaId,
  pin,
  accessToken,
  requestId,
  workspaceId,
}: {
  connectionId: string;
  phoneNumberId: string;
  wabaId: string;
  pin: string;
  accessToken: string;
  requestId: string;
  workspaceId: string;
}): Promise<void> {
  const operation = "whatsapp.onboarding.activate";

  try {
    await subscribeWabaToApp(wabaId, accessToken);
  } catch (error) {
    await markConnectionFailed(connectionId, "WEBHOOK_SUBSCRIPTION_FAILED");

    throw new AppError(
      ERROR_CODES.PROVIDER_ERROR,
      "Your number was connected but WhatsApp will not send us messages yet. Please try connecting again.",
      { context: { operation, requestId, workspaceId, step: "subscribe" }, cause: error },
    );
  }

  try {
    await registerPhoneNumber(phoneNumberId, pin, accessToken);
  } catch (error) {
    await markConnectionFailed(connectionId, "NUMBER_REGISTRATION_FAILED");

    throw new AppError(
      ERROR_CODES.PROVIDER_ERROR,
      // Two-step verification already set on the number is the most likely
      // cause for a number moved from the WhatsApp Business app, and it is not
      // something the doctor can guess from a generic failure.
      "Your number was connected but could not be activated. If it already has WhatsApp two-step verification enabled, turn that off and try again.",
      { context: { operation, requestId, workspaceId, step: "register" }, cause: error },
    );
  }

  logger.info("WhatsApp number activated", {
    requestId,
    operation,
    workspaceId,
  });
}

/**
 * Records that a connection is broken.
 *
 * Best-effort: it runs on a path that is already failing, so its own failure
 * is logged rather than thrown. Losing the reason is better than replacing the
 * original error with a second one.
 */
async function markConnectionFailed(
  connectionId: string,
  errorCode: string,
): Promise<void> {
  try {
    const admin = createSupabaseAdminClient();

    await admin
      .from("whatsapp_connections")
      .update({ status: "error", error_code: errorCode })
      .eq("id", connectionId);
  } catch (error) {
    logger.error("could not record connection failure", error, {
      operation: "whatsapp.onboarding.markFailed",
      connectionId,
    });
  }
}

function databaseError(
  operation: string,
  error: { code?: string; message: string },
  context: Record<string, unknown>,
): AppError {
  logger.error(`${operation} failed`, error, { operation, ...context });

  return new AppError(ERROR_CODES.DATABASE_ERROR, undefined, {
    context: { operation, providerCode: error.code },
    cause: error,
  });
}
