import { AppError, ERROR_CODES } from "@/lib/errors/app-error";

/**
 * Keyset cursor for paging a message thread.
 *
 * The cursor is `(sent_at, id)`, never `sent_at` alone. Meta's timestamps have
 * **one-second resolution**, so several messages in a thread routinely share
 * one. A cursor on the timestamp alone either skips messages or repeats them at
 * a page boundary, intermittently and usually only under load. Including the id
 * makes the ordering total.
 *
 * Keyset rather than OFFSET because a thread grows while it is being read: with
 * OFFSET, a message arriving between two page requests shifts every later row
 * and the reader silently misses one.
 */

export type MessageCursor = {
  readonly sentAt: string;
  readonly id: string;
};

/**
 * Cursors are opaque to callers, so the encoding can change without breaking
 * anyone. base64url — not plain base64 — because the value travels in a query
 * string, where `+` and `/` would need escaping.
 */
export function encodeMessageCursor(cursor: MessageCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/**
 * Parses a cursor supplied by the browser.
 *
 * Every field is validated rather than trusted: this value is
 * attacker-controlled, and it is interpolated into a query filter. A malformed
 * cursor is a client error, not a server fault, so it raises
 * `VALIDATION_FAILED` rather than surfacing as an unexplained empty page.
 */
export function decodeMessageCursor(value: string): MessageCursor {
  const invalid = () =>
    new AppError(ERROR_CODES.VALIDATION_FAILED, "That page link is not valid.", {
      context: { operation: "messages.decodeCursor" },
    });

  let parsed: unknown;

  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    // Not base64url, or not JSON. Either way the caller sent something we did
    // not issue.
    throw invalid();
  }

  if (typeof parsed !== "object" || parsed === null) throw invalid();

  const { sentAt, id } = parsed as Record<string, unknown>;

  if (typeof sentAt !== "string" || typeof id !== "string") throw invalid();
  if (Number.isNaN(Date.parse(sentAt))) throw invalid();
  if (!UUID_PATTERN.test(id)) throw invalid();

  return { sentAt, id };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
