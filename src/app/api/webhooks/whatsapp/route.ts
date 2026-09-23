import { AppError, ERROR_CODES } from "@/lib/errors/app-error";
import { toErrorResponse } from "@/lib/errors/response";
import { logger } from "@/lib/logger/logger";
import { getRequestId, REQUEST_ID_HEADER } from "@/lib/request-id";
import {
  verifyWebhookSubscription,
  type WebhookVerificationRejection,
} from "@/server/integrations/meta/webhook-verification";
import {
  SIGNATURE_HEADER,
  verifyWebhookSignature,
} from "@/server/integrations/meta/webhook-signature";
import {
  parseWebhookPayload,
  WHATSAPP_OBJECT,
} from "@/server/integrations/meta/webhook-payload";
import { recordWebhookEvent } from "@/server/services/whatsapp-webhook-events";
import { processWebhookEvent } from "@/server/services/inbound-message-processing";

/**
 * Meta's WhatsApp webhook endpoint.
 *
 * `GET` is Meta's subscription handshake. `POST` is the delivery of actual
 * events.
 *
 * The URL is configured in the Meta app dashboard as the callback URL, so it
 * is part of the integration's contract: renaming this route means
 * reconfiguring the Meta app.
 */

// `node:crypto` is used for the timing-safe token comparison, and Task 6.2
// needs the raw body for signature verification. Pinned rather than inherited.
export const runtime = "nodejs";

const VERIFY_OPERATION = "whatsapp.webhook.verify";
const RECEIVE_OPERATION = "whatsapp.webhook.receive";

/**
 * How each refusal is answered.
 *
 * A misconfigured server is a 500 because it is our fault; everything else is
 * the caller's. The bodies carry only the generic per-code message, so the
 * response never tells a prober which parameter was wrong — that detail exists
 * only in our logs, keyed by the request ID.
 */
const REJECTION_ERRORS: Record<
  WebhookVerificationRejection,
  { readonly code: (typeof ERROR_CODES)[keyof typeof ERROR_CODES] }
> = {
  not_configured: { code: ERROR_CODES.CONFIGURATION_ERROR },
  missing_parameters: { code: ERROR_CODES.VALIDATION_FAILED },
  unsupported_mode: { code: ERROR_CODES.VALIDATION_FAILED },
  invalid_token: { code: ERROR_CODES.FORBIDDEN },
};

export async function GET(request: Request): Promise<Response> {
  const requestId = getRequestId(request.headers);

  try {
    const { searchParams } = new URL(request.url);
    const result = verifyWebhookSubscription(searchParams);

    if (result.outcome === "rejected") {
      // The rejection reason is diagnostic, not sensitive: it names which check
      // failed, never the token that was offered.
      throw new AppError(REJECTION_ERRORS[result.reason].code, undefined, {
        context: { reason: result.reason },
      });
    }

    logger.info("whatsapp webhook subscription verified", {
      requestId,
      operation: VERIFY_OPERATION,
    });

    // Meta requires the challenge echoed verbatim, as the entire body. Sent as
    // text/plain so the echoed value can never be interpreted as markup by
    // anything that looks at this response.
    return new Response(result.challenge, {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        [REQUEST_ID_HEADER]: requestId,
      },
    });
  } catch (error) {
    return toErrorResponse(error, { requestId, operation: VERIFY_OPERATION });
  }
}

/**
 * Receives WhatsApp events.
 *
 * The response rules here are unusual and deliberate. Meta retries a non-200
 * for 36 hours, and historical webhook data cannot be fetched again — so a
 * payload we will *never* be able to process must still be acknowledged, or it
 * buys a day and a half of pointless retries. A payload we *failed* to store,
 * by contrast, must not be acknowledged: a retry is the only chance to keep it.
 *
 * Hence:
 *
 * | Situation                        | Answer | Why                                  |
 * | -------------------------------- | ------ | ------------------------------------ |
 * | Stored (or already held)         | 200    | Done.                                |
 * | Bad signature / not configured   | 403    | Not Meta. Never acknowledge it.      |
 * | Unparseable or unknown object    | 200    | Retrying will not make it parse.     |
 * | Database write failed            | 500    | Retry is the only way to keep it.    |
 */
export async function POST(request: Request): Promise<Response> {
  const requestId = getRequestId(request.headers);

  try {
    // Read as text, never `request.json()`. The signature is computed over the
    // exact bytes Meta sent, and parsing then re-serialising changes them.
    const rawBody = await request.text();

    const signature = verifyWebhookSignature(
      rawBody,
      request.headers.get(SIGNATURE_HEADER),
    );

    if (signature.outcome === "rejected") {
      const code =
        signature.reason === "not_configured"
          ? ERROR_CODES.CONFIGURATION_ERROR
          : ERROR_CODES.FORBIDDEN;

      // Nothing is stored. An unauthenticated caller must not be able to write
      // a row, or the events table becomes a way to fill a doctor's inbox.
      throw new AppError(code, undefined, {
        context: { reason: signature.reason },
      });
    }

    const parsed = parseWebhookPayload(rawBody);

    if (parsed.outcome === "rejected") {
      // Signed by Meta but not something we can read. Acknowledged, because a
      // retry would deliver the same bytes to the same failure.
      logger.warn("unreadable webhook delivery acknowledged", {
        requestId,
        operation: RECEIVE_OPERATION,
        reason: parsed.reason,
      });

      return acknowledge(requestId);
    }

    if (parsed.payload.object !== WHATSAPP_OBJECT) {
      // A subscription to something other than WhatsApp. Observable, ignored,
      // and acknowledged so it does not retry forever.
      logger.warn("webhook delivery for an unexpected object acknowledged", {
        requestId,
        operation: RECEIVE_OPERATION,
        object: parsed.payload.object,
      });

      return acknowledge(requestId);
    }

    const event = await recordWebhookEvent({
      rawBody,
      payload: parsed.payload,
      requestId,
    });

    // Only a new delivery is interpreted. A retry's messages are already
    // stored, and re-running would do nothing but repeat the work.
    if (event.created) {
      await processWebhookEvent({ eventId: event.eventId, requestId });
    }

    return acknowledge(requestId, { duplicate: !event.created });
  } catch (error) {
    return toErrorResponse(error, { requestId, operation: RECEIVE_OPERATION });
  }
}

/**
 * Meta ignores the body and reads only the status, but a duplicate flag makes
 * retry behaviour visible when replaying a delivery by hand.
 */
function acknowledge(requestId: string, extra: { duplicate?: boolean } = {}): Response {
  return Response.json(
    { received: true, ...extra },
    { status: 200, headers: { [REQUEST_ID_HEADER]: requestId } },
  );
}
