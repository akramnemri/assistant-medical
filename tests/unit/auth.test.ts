import { describe, expect, it } from "vitest";
import type { AuthError } from "@supabase/supabase-js";
import { mapAuthError } from "@/features/auth/auth-errors";
import { parseCredentials } from "@/features/auth/schemas";
import { DEFAULT_SIGNED_IN_PATH, safeRedirectPath } from "@/features/auth/redirects";

function formDataOf(values: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(values)) formData.set(key, value);
  return formData;
}

/** Minimal stand-in for a Supabase AuthError; only `code`/`status` are read. */
function authErrorOf(code: string, status = 400): AuthError {
  return { name: "AuthApiError", message: "provider message", code, status } as AuthError;
}

describe("parseCredentials", () => {
  it("accepts valid credentials", () => {
    const result = parseCredentials(
      formDataOf({ email: "doctor@example.test", password: "synthetic-pw" }),
    );

    expect(result).toEqual({
      ok: true,
      data: { email: "doctor@example.test", password: "synthetic-pw" },
    });
  });

  it("reports a per-field message for a malformed email", () => {
    const result = parseCredentials(
      formDataOf({ email: "not-an-email", password: "synthetic-pw" }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.email).toMatch(/valid email/i);
      expect(result.fieldErrors.password).toBeUndefined();
    }
  });

  it("reports a short password", () => {
    const result = parseCredentials(
      formDataOf({ email: "doctor@example.test", password: "abc" }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.password).toMatch(/at least/i);
  });

  it("treats entirely missing fields as invalid rather than throwing", () => {
    const result = parseCredentials(new FormData());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.email).toBeDefined();
      expect(result.fieldErrors.password).toBeDefined();
    }
  });
});

describe("mapAuthError", () => {
  it("maps invalid credentials to UNAUTHENTICATED with a safe message", () => {
    const appError = mapAuthError(authErrorOf("invalid_credentials"));

    expect(appError.code).toBe("UNAUTHENTICATED");
    expect(appError.message).toBe("Incorrect email or password.");
  });

  // Distinguishing "no such user" from "wrong password" would let anyone test
  // whether a given doctor has an account here.
  it("does not reveal whether the account exists", () => {
    const appError = mapAuthError(authErrorOf("invalid_credentials"));

    expect(appError.message).not.toMatch(/not found|no account|unknown user/i);
  });

  it.each([
    ["weak_password", "VALIDATION_FAILED"],
    ["email_exists", "CONFLICT"],
    ["user_already_exists", "CONFLICT"],
    ["over_request_rate_limit", "RATE_LIMITED"],
    ["email_not_confirmed", "UNAUTHENTICATED"],
  ])("maps %s to %s", (providerCode, expectedCode) => {
    expect(mapAuthError(authErrorOf(providerCode)).code).toBe(expectedCode);
  });

  // An unmapped code means Supabase failed or changed; it must not surface as a
  // validation error, and the real code has to reach the logs.
  it("treats an unrecognized provider code as a provider fault", () => {
    const appError = mapAuthError(authErrorOf("some_new_code_we_do_not_know"));

    expect(appError.code).toBe("PROVIDER_ERROR");
    expect(appError.context.providerCode).toBe("some_new_code_we_do_not_know");
  });

  it("never forwards the provider's own message to the user", () => {
    const appError = mapAuthError(authErrorOf("invalid_credentials"));

    expect(appError.message).not.toContain("provider message");
  });
});

describe("safeRedirectPath", () => {
  it.each(["/dashboard", "/conversations", "/conversations/abc-123"])(
    "allows the in-app path %s",
    (path) => {
      expect(safeRedirectPath(path)).toBe(path);
    },
  );

  // An open redirect on a sign-in page is a credible phishing primitive: the
  // link looks like ours right up to the moment credentials are entered.
  it.each([
    ["an absolute URL", "https://evil.example/login"],
    ["a scheme-relative URL", "//evil.example"],
    ["a backslash variant", "/\\evil.example"],
    ["a javascript URL", "javascript:alert(1)"],
    ["a relative path", "dashboard"],
    ["an empty string", ""],
    ["a newline injection", "/dashboard\nLocation: https://evil.example"],
  ])("rejects %s", (_label, candidate) => {
    expect(safeRedirectPath(candidate)).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it.each([undefined, null, 42, {}])("rejects the non-string %s", (candidate) => {
    expect(safeRedirectPath(candidate)).toBe(DEFAULT_SIGNED_IN_PATH);
  });
});
