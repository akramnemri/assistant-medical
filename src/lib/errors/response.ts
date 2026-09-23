import {
  AppError,
  ERROR_CODES,
  errorDefaults,
  isAppError,
  type ErrorCode,
} from "@/lib/errors/app-error";
import { logger } from "@/lib/logger/logger";
import { REQUEST_ID_HEADER } from "@/lib/request-id";

/**
 * The only shape this application returns for a failed request.
 *
 * Deliberately minimal: a stable code a client can branch on, a message safe to
 * render, and the correlation ID that ties it to the logs. No stack, no cause,
 * no provider payload, no SQL.
 */
export type ErrorResponseBody = {
  readonly error: {
    readonly code: ErrorCode;
    readonly message: string;
    readonly requestId: string;
  };
};

export function toErrorResponseBody(
  error: unknown,
  requestId: string,
): ErrorResponseBody {
  // An unexpected throw is reported as UNKNOWN. Its real message is not
  // forwarded, because at this point we have no idea what is in it.
  const code = isAppError(error) ? error.code : ERROR_CODES.UNKNOWN;
  const message = isAppError(error)
    ? error.message
    : errorDefaults(ERROR_CODES.UNKNOWN).safeMessage;

  return { error: { code, message, requestId } };
}

/**
 * Logs the failure and builds the client response.
 *
 * Route handlers call this from their catch block so that logging and
 * serialization cannot drift apart.
 *
 * @param operation Used as the log's `operation` field, e.g. "whatsapp.webhook.receive".
 */
export function toErrorResponse(
  error: unknown,
  { requestId, operation }: { requestId: string; operation: string },
): Response {
  const status = isAppError(error)
    ? error.status
    : errorDefaults(ERROR_CODES.UNKNOWN).status;

  // Client mistakes are expected traffic and would otherwise drown the error
  // channel; genuine faults stay at error level.
  const isClientError = status >= 400 && status < 500;
  const logMessage = `${operation} failed`;
  const code = isAppError(error) ? error.code : ERROR_CODES.UNKNOWN;
  const base = { requestId, operation, status, code };

  if (isClientError) {
    // No stack for an expected client mistake, but keep the AppError's own
    // context — "which field failed validation" is the whole diagnostic value.
    logger.warn(logMessage, {
      ...base,
      ...(isAppError(error) ? error.context : {}),
    });
  } else {
    logger.error(logMessage, error, base);
  }

  return Response.json(toErrorResponseBody(error, requestId), {
    status,
    headers: { [REQUEST_ID_HEADER]: requestId },
  });
}

/** Re-exported so a route handler needs one import to throw a typed failure. */
export { AppError, ERROR_CODES };
