import { describe, expect, it } from "vitest";
import {
  decodeMessageCursor,
  encodeMessageCursor,
} from "@/server/services/message-cursor";
import { isAppError } from "@/lib/errors/app-error";

const VALID = {
  sentAt: "2026-09-19T12:00:00.000Z",
  id: "55555555-5555-5555-5555-555555555555",
} as const;

describe("message cursor", () => {
  it("round-trips a cursor", () => {
    expect(decodeMessageCursor(encodeMessageCursor(VALID))).toEqual(VALID);
  });

  // The cursor travels in a query string, where base64's "+" and "/" would need
  // escaping and are silently mangled if they are not.
  it("encodes to a URL-safe string", () => {
    const encoded = encodeMessageCursor({
      sentAt: "2026-09-19T12:00:00.000+02:00",
      id: VALID.id,
    });

    expect(encoded).not.toMatch(/[+/=]/);
    expect(encodeURIComponent(encoded)).toBe(encoded);
  });

  // The cursor is attacker-controlled and ends up in a query filter, so every
  // field is validated rather than trusted.
  it.each([
    ["not base64", "!!!not-base64!!!"],
    ["base64 that is not JSON", Buffer.from("hello", "utf8").toString("base64url")],
    ["JSON that is not an object", Buffer.from("42", "utf8").toString("base64url")],
    ["null", Buffer.from("null", "utf8").toString("base64url")],
    ["an empty string", ""],
  ])("rejects %s", (_label, value) => {
    expect(() => decodeMessageCursor(value)).toThrow();
  });

  it.each([
    ["a missing id", { sentAt: VALID.sentAt }],
    ["a missing timestamp", { id: VALID.id }],
    ["a non-string id", { sentAt: VALID.sentAt, id: 42 }],
    ["an unparseable timestamp", { sentAt: "not-a-date", id: VALID.id }],
    ["an id that is not a uuid", { sentAt: VALID.sentAt, id: "1 OR 1=1" }],
    [
      "a filter injected through the id",
      { sentAt: VALID.sentAt, id: "x,or(workspace_id.neq.null)" },
    ],
  ])("rejects a payload with %s", (_label, payload) => {
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");

    expect(() => decodeMessageCursor(encoded)).toThrow();
  });

  // A bad cursor is the caller's mistake. Reporting it as a server fault would
  // page someone at 3am for a stale bookmark.
  it("reports a malformed cursor as a validation failure, not a server fault", () => {
    try {
      decodeMessageCursor("garbage");
      expect.unreachable("expected a VALIDATION_FAILED error");
    } catch (error) {
      expect(isAppError(error)).toBe(true);
      if (isAppError(error)) {
        expect(error.code).toBe("VALIDATION_FAILED");
        expect(error.status).toBe(400);
      }
    }
  });
});
