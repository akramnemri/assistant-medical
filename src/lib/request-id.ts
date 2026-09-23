/**
 * Correlation IDs.
 *
 * Every request gets one, it appears on every log line produced while handling
 * that request, and it is returned to the caller. When a doctor reports "it
 * failed at 14:32", the ID on their screen is the thing that finds the logs.
 */

/** Header used to propagate a correlation ID between services. */
export const REQUEST_ID_HEADER = "x-request-id";

/** Bounds what an upstream caller can push into our logs. */
const MAX_REQUEST_ID_LENGTH = 128;

/**
 * An inbound ID is attacker-controlled, so it is accepted only if it looks like
 * an identifier. Without this, a caller could inject newlines into a log line
 * and forge entries.
 */
const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function newRequestId(): string {
  return crypto.randomUUID();
}

/**
 * Reuses a valid inbound correlation ID so a request can be traced across
 * hops, and generates a fresh one otherwise.
 */
export function getRequestId(headers: Headers): string {
  const inbound = headers.get(REQUEST_ID_HEADER);

  if (
    inbound !== null &&
    inbound.length <= MAX_REQUEST_ID_LENGTH &&
    SAFE_REQUEST_ID.test(inbound)
  ) {
    return inbound;
  }

  return newRequestId();
}
