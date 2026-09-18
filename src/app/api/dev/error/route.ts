import { AppError, ERROR_CODES } from "@/lib/errors/app-error";
import { toErrorResponse } from "@/lib/errors/response";
import { logger } from "@/lib/logger/logger";
import { getRequestId, REQUEST_ID_HEADER } from "@/lib/request-id";

/**
 * Development-only endpoint for exercising the error and logging path.
 *
 * It exists so the error format, the correlation ID and — most importantly —
 * the log redaction can be verified by hand, rather than trusted because the
 * unit tests pass.
 *
 * Returns 404 outside development, so it is inert if it ever reaches a
 * deployed environment.
 */

const OPERATION = "dev.error";

export async function GET(request: Request): Promise<Response> {
  if (process.env.NODE_ENV === "production") {
    return new Response("Not found", { status: 404 });
  }

  const requestId = getRequestId(request.headers);
  const kind = new URL(request.url).searchParams.get("kind") ?? "app";

  try {
    // The fake credential and patient fields below are here on purpose: the
    // response and the log line prove they are never echoed back or written.
    const sensitiveContext = {
      accessToken: "fake-token-value-not-a-real-secret",
      patientPhone: "+10000000000",
      messageBody: "synthetic message content",
      conversationId: "11111111-1111-1111-1111-111111111111",
    };

    switch (kind) {
      case "app":
        throw new AppError(ERROR_CODES.PROVIDER_ERROR, undefined, {
          context: { ...sensitiveContext, providerStatus: 503 },
        });

      case "validation":
        throw new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          "The phone number is not in a supported format.",
          { context: { ...sensitiveContext, field: "phoneNumber" } },
        );

      case "unexpected":
        // A raw throw whose message contains something that must not be
        // forwarded to the client.
        throw new Error(
          "connection to db-primary failed: password=fake-not-a-real-secret",
        );

      case "thrown-string":
        throw "a bare string was thrown";

      default:
        logger.info("dev error endpoint called with no matching kind", {
          requestId,
          operation: OPERATION,
          kind,
        });

        return Response.json(
          { ok: true, kinds: ["app", "validation", "unexpected", "thrown-string"] },
          { headers: { [REQUEST_ID_HEADER]: requestId } },
        );
    }
  } catch (error) {
    return toErrorResponse(error, { requestId, operation: OPERATION });
  }
}
