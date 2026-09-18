import { describe, expect, it } from "vitest";
import {
  REDACTED,
  isSensitiveKey,
  redact,
  redactContext,
  scrubInlineSecrets,
} from "@/lib/logger/redact";

describe("isSensitiveKey", () => {
  it.each([
    "password",
    "accessToken",
    "META_APP_SECRET",
    "authorization",
    "x-hub-signature-256",
    "apiKey",
    "Cookie",
    "sessionId",
  ])("treats %s as a credential", (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it.each([
    "patientPhone",
    "wa_id",
    "waId",
    "WA-ID",
    "email",
    "messageBody",
    "text",
    "caption",
    "lastName",
  ])("treats %s as patient data", (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  // Regression: "text" was matched as a substring, so "context" was redacted
  // and every AppError log line lost its diagnostic payload.
  it.each([
    "requestId",
    "operation",
    "workspaceId",
    "status",
    "conversationId",
    "context",
    "subtext",
    "providerEventId",
  ])("leaves %s alone", (key) => {
    expect(isSensitiveKey(key)).toBe(false);
  });

  // ...but the exact message-content fields must still be caught.
  it.each(["body", "text", "caption"])("still redacts the exact key %s", (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });
});

describe("scrubInlineSecrets", () => {
  // A database driver putting its connection string into an error message is
  // the realistic way a secret reaches the logs despite key-based redaction.
  it.each([
    ["password=hunter2", "hunter2"],
    ["token: abc123", "abc123"],
    ["api_key=xyz789", "xyz789"],
    ["API-KEY = xyz789", "xyz789"],
    ["Authorization: Bearer abc.def.ghi", "abc.def.ghi"],
    ["Bearer abc.def.ghi", "abc.def.ghi"],
  ])("masks the secret in %s", (input, secret) => {
    const result = scrubInlineSecrets(`connection failed: ${input}`);

    expect(result).not.toContain(secret);
    expect(result).toContain(REDACTED);
  });

  it("masks credentials embedded in a connection URL", () => {
    const result = scrubInlineSecrets(
      "could not connect to postgres://admin:s3cr3t@db.internal:5432/app",
    );

    expect(result).not.toContain("s3cr3t");
    expect(result).toContain("postgres://admin:");
    expect(result).toContain("@db.internal:5432/app");
  });

  it("leaves ordinary text untouched", () => {
    const text = "conversation 11111111-1111-1111-1111-111111111111 not found";

    expect(scrubInlineSecrets(text)).toBe(text);
  });
});

describe("redactContext", () => {
  it("redacts credentials and patient data but keeps correlation fields", () => {
    const result = redactContext({
      requestId: "req-1",
      operation: "whatsapp.webhook.receive",
      accessToken: "EAAG-real-looking-token",
      patientPhone: "+15550001111",
      messageBody: "I have had a headache since Tuesday",
    });

    expect(result).toEqual({
      requestId: "req-1",
      operation: "whatsapp.webhook.receive",
      accessToken: REDACTED,
      patientPhone: REDACTED,
      messageBody: REDACTED,
    });
  });

  it("redacts sensitive keys nested inside objects and arrays", () => {
    const result = redactContext({
      entry: [{ changes: [{ value: { text: "patient message", waId: "15550001111" } }] }],
    });

    expect(JSON.stringify(result)).not.toContain("patient message");
    expect(JSON.stringify(result)).not.toContain("15550001111");
  });

  // A wrong implementation that only matches exact lowercase keys would pass the
  // happy path and silently leak everything else.
  it("is not defeated by casing or separators", () => {
    const result = redactContext({
      ACCESS_TOKEN: "a",
      "access-token": "b",
      accessToken: "c",
    });

    expect(Object.values(result)).toEqual([REDACTED, REDACTED, REDACTED]);
  });

  it("does not recurse forever on a circular structure", () => {
    const node: Record<string, unknown> = { requestId: "req-1" };
    node.self = node;

    expect(() => redactContext(node)).not.toThrow();
    expect(JSON.stringify(redactContext(node))).toContain("[circular]");
  });

  it("truncates deep nesting rather than walking it", () => {
    const deep = { a: { b: { c: { d: { e: "too deep" } } } } };

    expect(JSON.stringify(redactContext(deep))).not.toContain("too deep");
  });

  it("caps long arrays so one log line cannot flood the sink", () => {
    const result = redact(Array.from({ length: 50 }, (_, index) => index));

    expect(Array.isArray(result)).toBe(true);
    expect(result as unknown[]).toHaveLength(21);
    expect((result as unknown[]).at(-1)).toBe("[30 more items]");
  });

  it("reduces an Error to name and message without a stack", () => {
    const result = redact(new Error("boom")) as Record<string, unknown>;

    expect(result).toEqual({ name: "Error", message: "boom" });
    expect(result).not.toHaveProperty("stack");
  });

  it("passes primitives through untouched", () => {
    expect(redact("plain")).toBe("plain");
    expect(redact(42)).toBe(42);
    expect(redact(null)).toBe(null);
  });
});
