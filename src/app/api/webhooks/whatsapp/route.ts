import { AppError, ERROR_CODES } from "@/lib/errors/app-error";
import { toErrorResponse } from "@/lib/errors/response";
import { logger } from "@/lib/logger/logger";
import { getRequestId, REQUEST_ID_HEADER } from "@/lib/request-id";
import {
  verifyWebhookSubscription,
  type WebhookVerificationRejection,
} from "@/server/integrations/meta/webhook-verification";

/**
 * Meta's WhatsApp webhook endpoint.
 *
 * This task implements only the `GET` subscription handshake. The `POST`
 * receiver that accepts actual events is Task 6.2; until it exists, Next.js
 * answers a POST here with 405, which is a correct "not accepting events yet"
 * rather than a silent success.
 *
 * The URL is configured in the Meta app dashboard as the callback URL, so it
 * is part of the integration's contract: renaming this route means
 * reconfiguring the Meta app.
 */

// `node:crypto` is used for the timing-safe token comparison, and Task 6.2
// needs the raw body for signature verification. Pinned rather than inherited.
export const runtime = "nodejs";

const OPERATION = "whatsapp.webhook.verify";

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
      operation: OPERATION,
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
    return toErrorResponse(error, { requestId, operation: OPERATION });
  }
}
