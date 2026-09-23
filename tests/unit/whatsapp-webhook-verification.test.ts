import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The webhook subscription handshake (Task 6.1).
 *
 * What a wrong implementation costs here is specific: echoing `hub.challenge`
 * without checking the token lets anyone subscribe their own Meta app to our
 * endpoint and start feeding us events. So the cases below are weighted toward
 * refusal — a wrong token, a missing parameter, a different mode, no token
 * configured — rather than toward the happy path.
 *
 * `serverEnv()` caches its parse, so each case sets the environment, resets the
 * module registry and imports fresh.
 */

const VERIFY_TOKEN = "synthetic-verify-token-not-a-real-secret";
const CHALLENGE = "1158201444";

const originalEnv = process.env;

beforeEach(() => {
  vi.resetModules();
  process.env = { ...originalEnv, META_WEBHOOK_VERIFY_TOKEN: VERIFY_TOKEN };
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = originalEnv;
});

async function verify(query: Record<string, string>) {
  const { verifyWebhookSubscription } =
    await import("@/server/integrations/meta/webhook-verification");

  return verifyWebhookSubscription(new URLSearchParams(query));
}

function validQuery(overrides: Record<string, string> = {}) {
  return {
    "hub.mode": "subscribe",
    "hub.verify_token": VERIFY_TOKEN,
    "hub.challenge": CHALLENGE,
    ...overrides,
  };
}

describe("verifyWebhookSubscription", () => {
  it("returns the challenge when the mode and token are correct", async () => {
    await expect(verify(validQuery())).resolves.toEqual({
      outcome: "verified",
      challenge: CHALLENGE,
    });
  });

  it("returns the challenge verbatim rather than a parsed or re-encoded form", async () => {
    // Meta compares the body byte for byte. A handler that coerced this to a
    // number would pass a numeric-challenge test and fail verification for real.
    const challenge = "0123 challenge+value/with=padding";

    await expect(verify(validQuery({ "hub.challenge": challenge }))).resolves.toEqual({
      outcome: "verified",
      challenge,
    });
  });

  it("rejects a wrong token", async () => {
    await expect(
      verify(validQuery({ "hub.verify_token": "wrong-token" })),
    ).resolves.toEqual({ outcome: "rejected", reason: "invalid_token" });
  });

  // A prefix is the case a naive `startsWith` or a truncated comparison would
  // wave through.
  it("rejects a token that is a prefix of the configured one", async () => {
    await expect(
      verify(validQuery({ "hub.verify_token": VERIFY_TOKEN.slice(0, -1) })),
    ).resolves.toEqual({ outcome: "rejected", reason: "invalid_token" });
  });

  it("rejects a token that extends the configured one", async () => {
    await expect(
      verify(validQuery({ "hub.verify_token": `${VERIFY_TOKEN}x` })),
    ).resolves.toEqual({ outcome: "rejected", reason: "invalid_token" });
  });

  it("rejects an empty token", async () => {
    await expect(verify(validQuery({ "hub.verify_token": "" }))).resolves.toEqual({
      outcome: "rejected",
      reason: "invalid_token",
    });
  });

  it.each([["hub.mode"], ["hub.verify_token"], ["hub.challenge"]])(
    "rejects a request missing %s",
    async (parameter) => {
      const query = validQuery();
      delete query[parameter as keyof typeof query];

      await expect(verify(query)).resolves.toEqual({
        outcome: "rejected",
        reason: "missing_parameters",
      });
    },
  );

  it("rejects a bare request with no hub parameters at all", async () => {
    await expect(verify({})).resolves.toEqual({
      outcome: "rejected",
      reason: "missing_parameters",
    });
  });

  it("rejects a mode other than subscribe", async () => {
    await expect(verify(validQuery({ "hub.mode": "unsubscribe" }))).resolves.toEqual({
      outcome: "rejected",
      reason: "unsupported_mode",
    });
  });

  // Fail closed: with nothing configured there is no token to be right about,
  // and accepting the handshake would attach a webhook we cannot authenticate.
  it("rejects every request when no verify token is configured", async () => {
    delete process.env.META_WEBHOOK_VERIFY_TOKEN;

    await expect(verify(validQuery())).resolves.toEqual({
      outcome: "rejected",
      reason: "not_configured",
    });
  });
});

async function get(url: string) {
  const { GET } = await import("@/app/api/webhooks/whatsapp/route");
  return GET(new Request(url));
}

const ENDPOINT = "https://example.test/api/webhooks/whatsapp";

function verificationUrl(query: Record<string, string>) {
  return `${ENDPOINT}?${new URLSearchParams(query).toString()}`;
}

describe("GET /api/webhooks/whatsapp", () => {
  it("answers a valid handshake with 200 and the challenge as the whole body", async () => {
    const response = await get(verificationUrl(validQuery()));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    await expect(response.text()).resolves.toBe(CHALLENGE);
  });

  it("answers a wrong token with 403 and does not echo the challenge", async () => {
    const response = await get(
      verificationUrl(validQuery({ "hub.verify_token": "wrong-token" })),
    );

    expect(response.status).toBe(403);

    const body = await response.text();
    expect(body).not.toContain(CHALLENGE);
    expect(body).not.toContain(VERIFY_TOKEN);
  });

  it("answers a request with missing parameters with 400", async () => {
    const response = await get(ENDPOINT);

    expect(response.status).toBe(400);
  });

  it("answers an unsupported mode with 400", async () => {
    const response = await get(verificationUrl(validQuery({ "hub.mode": "delete" })));

    expect(response.status).toBe(400);
  });

  it("answers with 500 when no verify token is configured", async () => {
    delete process.env.META_WEBHOOK_VERIFY_TOKEN;

    const response = await get(verificationUrl(validQuery()));

    expect(response.status).toBe(500);
  });

  it("returns a correlation ID on both success and refusal", async () => {
    const verified = await get(verificationUrl(validQuery()));
    const refused = await get(
      verificationUrl(validQuery({ "hub.verify_token": "wrong-token" })),
    );

    expect(verified.headers.get("x-request-id")).toBeTruthy();
    expect(refused.headers.get("x-request-id")).toBeTruthy();
  });

  it("reuses a valid inbound correlation ID so one delivery can be traced", async () => {
    const { GET } = await import("@/app/api/webhooks/whatsapp/route");
    const response = await GET(
      new Request(verificationUrl(validQuery()), {
        headers: { "x-request-id": "trace-abc-123" },
      }),
    );

    expect(response.headers.get("x-request-id")).toBe("trace-abc-123");
  });

  // The refusal is logged so a failed Meta setup is diagnosable, and the whole
  // point of that log line is that it names the failure without carrying the
  // token that was offered or the one we expected.
  it("logs a refusal without writing either token to the log", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await get(verificationUrl(validQuery({ "hub.verify_token": "wrong-token" })));

    expect(warn).toHaveBeenCalledTimes(1);
    const line = warn.mock.calls[0]?.[0] as string;

    expect(line).toContain("invalid_token");
    expect(line).not.toContain(VERIFY_TOKEN);
    expect(line).not.toContain("wrong-token");
  });
});
