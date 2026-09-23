import { describe, expect, it } from "vitest";
import { AppError, ERROR_CODES } from "@/lib/errors/app-error";
import { toErrorResponseBody } from "@/lib/errors/response";
import { buildLogEntry } from "@/lib/logger/logger";
import { REDACTED } from "@/lib/logger/redact";
import { getRequestId, REQUEST_ID_HEADER } from "@/lib/request-id";

describe("toErrorResponseBody", () => {
  it("forwards an AppError's code and safe message", () => {
    const body = toErrorResponseBody(
      new AppError(ERROR_CODES.VALIDATION_FAILED, "Phone is invalid."),
      "req-1",
    );

    expect(body).toEqual({
      error: {
        code: "VALIDATION_FAILED",
        message: "Phone is invalid.",
        requestId: "req-1",
      },
    });
  });

  // The whole point of the boundary: an unexpected throw must not have its
  // message forwarded, because nothing has vetted what is in it.
  it("replaces an unexpected error with a generic UNKNOWN response", () => {
    const body = toErrorResponseBody(
      new Error("db-primary auth failed: password=hunter2"),
      "req-2",
    );

    expect(body.error.code).toBe("UNKNOWN");
    expect(body.error.message).not.toContain("hunter2");
    expect(body.error.message).not.toContain("db-primary");
  });

  it("never includes a stack, cause or context", () => {
    const body = toErrorResponseBody(
      new AppError(ERROR_CODES.DATABASE_ERROR, undefined, {
        context: { accessToken: "secret-value" },
        cause: new Error("connection refused"),
      }),
      "req-3",
    );

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("secret-value");
    expect(serialized).not.toContain("connection refused");
    expect(Object.keys(body.error).sort()).toEqual(["code", "message", "requestId"]);
  });
});

describe("buildLogEntry", () => {
  it("includes the correlation fields needed to trace a request", () => {
    const entry = buildLogEntry("info", "webhook received", {
      requestId: "req-1",
      operation: "whatsapp.webhook.receive",
      providerEventId: "wamid.TEST",
    });

    expect(entry).toMatchObject({
      level: "info",
      message: "webhook received",
      requestId: "req-1",
      operation: "whatsapp.webhook.receive",
      providerEventId: "wamid.TEST",
    });
    expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("redacts secrets and patient content passed in context", () => {
    const entry = buildLogEntry("info", "inbound message", {
      requestId: "req-1",
      accessToken: "EAAG-token",
      messageBody: "patient symptoms",
    });

    expect(entry.accessToken).toBe(REDACTED);
    expect(entry.messageBody).toBe(REDACTED);
    expect(entry.requestId).toBe("req-1");
  });

  // An AppError carries its own context, which is easy to populate with a raw
  // provider payload. It has to be redacted on the way into the log too.
  it("redacts sensitive values carried inside an AppError's own context", () => {
    const entry = buildLogEntry(
      "error",
      "provider call failed",
      { requestId: "req-1" },
      new AppError(ERROR_CODES.PROVIDER_ERROR, undefined, {
        context: { accessToken: "EAAG-token", patientPhone: "+15550001111" },
      }),
    );

    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain("EAAG-token");
    expect(serialized).not.toContain("+15550001111");
    expect(entry.error?.code).toBe("PROVIDER_ERROR");
  });

  it("produces a single JSON line", () => {
    const entry = buildLogEntry("warn", "slow query", { requestId: "req-1" });
    const line = JSON.stringify(entry);

    expect(line.split("\n")).toHaveLength(1);
    expect(JSON.parse(line)).toMatchObject({ level: "warn" });
  });
});

describe("getRequestId", () => {
  it("reuses a valid inbound correlation ID", () => {
    const headers = new Headers({ [REQUEST_ID_HEADER]: "abc-123_XYZ" });

    expect(getRequestId(headers)).toBe("abc-123_XYZ");
  });

  it("generates one when the header is absent", () => {
    expect(getRequestId(new Headers())).toMatch(/^[0-9a-f-]{36}$/);
  });

  // An inbound header is attacker-controlled. A newline would let a caller
  // forge extra lines in a log file.
  //
  // The value is supplied through a stub rather than a real `Headers`, because
  // the platform constructor rejects a newline outright — that is defence in
  // depth, but it means a real Headers cannot reach our own guard at all.
  it.each([
    ["a newline", "abc\ninjected"],
    ["a space", "abc 123"],
    ["json", '{"a":1}'],
    ["an over-long value", "a".repeat(200)],
  ])("rejects %s and generates a fresh ID", (_label, value) => {
    const headers = { get: () => value } as unknown as Headers;

    expect(getRequestId(headers)).not.toBe(value);
    expect(getRequestId(headers)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("is also protected by the platform, which rejects a newline header value", () => {
    expect(() => new Headers({ [REQUEST_ID_HEADER]: "abc\ninjected" })).toThrow();
  });
});
