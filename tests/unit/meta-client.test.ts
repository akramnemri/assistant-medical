import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  META_GRAPH_VERSION,
  exchangeCodeForToken,
  fetchPhoneNumber,
} from "@/server/integrations/meta/client";
import { isAppError } from "@/lib/errors/app-error";

/**
 * The Meta boundary, with `fetch` mocked.
 *
 * Meta is an unreliable external dependency that this project has never called
 * for real, so what is tested is how the boundary behaves when the provider
 * misbehaves: wrong shapes, 4xx, 5xx and transport failures. Those paths are
 * the ones that decide whether a doctor sees something actionable or a stack
 * trace.
 */

const originalFetch = globalThis.fetch;
const originalEnv = process.env;

function mockFetch(response: {
  ok?: boolean;
  status?: number;
  body?: unknown;
  reject?: Error;
}) {
  // Typed with its parameters so the assertions below can read back the URL
  // and init that were actually sent.
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    void url;
    void init;

    if (response.reject) throw response.reject;

    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => response.body,
    } as unknown as Response;
  });

  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

beforeEach(() => {
  process.env = {
    ...originalEnv,
    META_APP_ID: "synthetic-app-id",
    META_APP_SECRET: "synthetic-app-secret",
  };
  vi.resetModules();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = originalEnv;
});

describe("exchangeCodeForToken", () => {
  it("returns the access token from a well-formed response", async () => {
    mockFetch({ body: { access_token: "synthetic-token", expires_in: 3600 } });

    const result = await exchangeCodeForToken("synthetic-code");

    expect(result.accessToken).toBe("synthetic-token");
    expect(result.expiresAt).not.toBeNull();
  });

  it("treats a token with no expiry as long-lived rather than expired", async () => {
    mockFetch({ body: { access_token: "synthetic-token" } });

    expect((await exchangeCodeForToken("synthetic-code")).expiresAt).toBeNull();
  });

  // A URL reaches proxy logs, browser history and error reports; a POST body
  // does not.
  it("sends credentials in the request body, never the URL", async () => {
    const fetchMock = mockFetch({ body: { access_token: "synthetic-token" } });

    await exchangeCodeForToken("synthetic-code");

    const [url, init] = fetchMock.mock.calls[0]!;

    expect(url).not.toContain("synthetic-app-secret");
    expect(url).not.toContain("synthetic-code");
    expect(String(init?.body)).toContain("client_secret=synthetic-app-secret");
  });

  it("pins the API version rather than following Meta's default", async () => {
    const fetchMock = mockFetch({ body: { access_token: "synthetic-token" } });

    await exchangeCodeForToken("synthetic-code");

    expect(fetchMock.mock.calls[0]![0]).toContain(`/${META_GRAPH_VERSION}/`);
    expect(META_GRAPH_VERSION).toMatch(/^v\d+\.\d+$/);
  });

  // A 200 in an unrecognised shape is a provider fault. Reporting it as a
  // validation error would tell the doctor to fix something they cannot.
  it("rejects a success response whose shape is unrecognised", async () => {
    mockFetch({ body: { unexpected: true } });

    await expect(exchangeCodeForToken("synthetic-code")).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
    });
  });

  // 4xx during onboarding means the code or id was not acceptable — retrying
  // the same values cannot help.
  it("maps a 4xx to a validation failure that tells the doctor to start again", async () => {
    mockFetch({
      ok: false,
      status: 400,
      body: { error: { message: "Invalid code", code: 100, fbtrace_id: "abc" } },
    });

    try {
      await exchangeCodeForToken("synthetic-code");
      expect.unreachable("expected a rejection");
    } catch (error) {
      expect(isAppError(error)).toBe(true);
      if (isAppError(error)) {
        expect(error.code).toBe("VALIDATION_FAILED");
        expect(error.message).toMatch(/start setup again/i);
        // Meta's own message is written for developers and can echo input.
        expect(error.message).not.toContain("Invalid code");
        expect(error.context.fbtraceId).toBe("abc");
      }
    }
  });

  it("maps a 5xx to a retryable provider error", async () => {
    mockFetch({ ok: false, status: 503, body: { error: { code: 1 } } });

    try {
      await exchangeCodeForToken("synthetic-code");
      expect.unreachable("expected a rejection");
    } catch (error) {
      expect(isAppError(error)).toBe(true);
      if (isAppError(error)) {
        expect(error.code).toBe("PROVIDER_ERROR");
        expect(error.message).toMatch(/try again/i);
      }
    }
  });

  it("maps a transport failure to a retryable provider error", async () => {
    mockFetch({ reject: new Error("network down") });

    await expect(exchangeCodeForToken("synthetic-code")).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
    });
  });

  it("refuses to attempt an exchange with no Meta app configured", async () => {
    process.env = { ...originalEnv };
    delete process.env.META_APP_ID;
    delete process.env.META_APP_SECRET;
    vi.resetModules();

    const { exchangeCodeForToken: freshExchange } =
      await import("@/server/integrations/meta/client");

    await expect(freshExchange("synthetic-code")).rejects.toMatchObject({
      code: "CONFIGURATION_ERROR",
    });
  });
});

describe("fetchPhoneNumber", () => {
  it("returns the number's identity", async () => {
    mockFetch({
      body: {
        id: "PHONE_ID",
        display_phone_number: "+1 555 0100",
        verified_name: "Synthetic Clinic",
      },
    });

    const result = await fetchPhoneNumber("PHONE_ID", "synthetic-token");

    expect(result).toEqual({
      id: "PHONE_ID",
      displayPhoneNumber: "+1 555 0100",
      verifiedName: "Synthetic Clinic",
    });
  });

  it("tolerates a number Meta has not yet named", async () => {
    mockFetch({ body: { id: "PHONE_ID" } });

    const result = await fetchPhoneNumber("PHONE_ID", "synthetic-token");

    expect(result.displayPhoneNumber).toBeNull();
    expect(result.verifiedName).toBeNull();
  });

  // A token in a query string is logged by every intermediary that sees it.
  it("sends the token as a header, not a query parameter", async () => {
    const fetchMock = mockFetch({ body: { id: "PHONE_ID" } });

    await fetchPhoneNumber("PHONE_ID", "synthetic-token");

    const [url, init] = fetchMock.mock.calls[0]!;

    expect(url).not.toContain("synthetic-token");
    expect((init?.headers as Record<string, string>).authorization).toBe(
      "Bearer synthetic-token",
    );
  });

  it("rejects a response missing the id", async () => {
    mockFetch({ body: { display_phone_number: "+1 555 0100" } });

    await expect(fetchPhoneNumber("PHONE_ID", "t")).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
    });
  });
});
