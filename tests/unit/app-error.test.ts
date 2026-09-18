import { describe, expect, it } from "vitest";
import { AppError, ERROR_CODES, errorDefaults, isAppError } from "@/lib/errors/app-error";
import { normalizeError } from "@/lib/errors/normalize";

describe("AppError", () => {
  it("falls back to the code's default message and status", () => {
    const error = new AppError(ERROR_CODES.FORBIDDEN);

    expect(error.code).toBe("FORBIDDEN");
    expect(error.status).toBe(403);
    expect(error.message).toBe(errorDefaults(ERROR_CODES.FORBIDDEN).safeMessage);
  });

  it("accepts an explicit safe message and status override", () => {
    const error = new AppError(ERROR_CODES.VALIDATION_FAILED, "Phone is invalid.", {
      status: 422,
    });

    expect(error.message).toBe("Phone is invalid.");
    expect(error.status).toBe(422);
  });

  it("keeps context and cause without putting them in the message", () => {
    const cause = new Error("underlying failure");
    const error = new AppError(ERROR_CODES.DATABASE_ERROR, undefined, {
      context: { table: "messages" },
      cause,
    });

    expect(error.context).toEqual({ table: "messages" });
    expect(error.cause).toBe(cause);
    expect(error.message).not.toContain("underlying failure");
  });

  // Subclassing a built-in breaks `instanceof` without an explicit prototype
  // fix, and every catch block in the app depends on this working.
  it("survives instanceof checks", () => {
    const error = new AppError(ERROR_CODES.NOT_FOUND);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(Error);
    expect(isAppError(error)).toBe(true);
    expect(isAppError(new Error("plain"))).toBe(false);
  });
});

describe("normalizeError", () => {
  it("keeps the code and context of an AppError", () => {
    const normalized = normalizeError(
      new AppError(ERROR_CODES.PROVIDER_ERROR, "Provider failed.", {
        context: { providerStatus: 503 },
      }),
    );

    expect(normalized.name).toBe("AppError");
    expect(normalized.code).toBe("PROVIDER_ERROR");
    expect(normalized.context).toEqual({ providerStatus: 503 });
  });

  it("normalizes a plain Error", () => {
    const normalized = normalizeError(new TypeError("bad type"));

    expect(normalized.name).toBe("TypeError");
    expect(normalized.message).toBe("bad type");
    expect(normalized.stack).toBeDefined();
  });

  // Anything can be thrown in JavaScript; a logger that assumes Error will
  // itself throw at the worst possible moment.
  it.each([
    ["a string", "boom", "ThrownString", "boom"],
    ["null", null, "ThrownNullish", "null"],
    ["undefined", undefined, "ThrownNullish", "undefined"],
  ])("handles %s being thrown", (_label, thrown, expectedName, expectedMessage) => {
    const normalized = normalizeError(thrown);

    expect(normalized.name).toBe(expectedName);
    expect(normalized.message).toBe(expectedMessage);
  });

  it("serializes a thrown plain object", () => {
    const normalized = normalizeError({ status: 500 });

    expect(normalized.name).toBe("ThrownValue");
    expect(normalized.message).toBe('{"status":500}');
  });

  it("follows a cause chain but stops before recursing forever", () => {
    const circular = new Error("outer");
    circular.cause = circular;

    const normalized = normalizeError(circular);

    expect(normalized.cause).toBeDefined();
    expect(() => JSON.stringify(normalized)).not.toThrow();
  });
});
