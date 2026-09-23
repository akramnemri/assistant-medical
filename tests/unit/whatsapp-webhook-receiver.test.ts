import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signWebhookBody } from "@/server/integrations/meta/webhook-signature";

/**
 * The webhook receiver's security and acknowledgement rules (Task 6.2).
 *
 * The failure modes worth testing here are specific and asymmetric:
 *
 * - accept a forged POST → a stranger writes messages into a doctor's inbox;
 * - reject a payload we simply cannot read → 36 hours of Meta retries;
 * - acknowledge a delivery we failed to store → that patient message is gone,
 *   permanently, because Meta cannot be asked for it again.
 *
 * So the assertions below are as much about *which status* is returned as
 * about whether the work happened.
 */

const APP_SECRET = "synthetic-app-secret-not-a-real-secret";
const PHONE_NUMBER_ID = "1275386478999841";
const SYNTHETIC_BODY = "synthetic message content";
const SYNTHETIC_WA_ID = "21600000000";

const originalEnv = process.env;

const recordWebhookEvent = vi.fn();
const processWebhookEvent = vi.fn();

// The database is exercised by the integration suite; here both services are
// stubbed so the status-code rules can be tested in isolation, including the
// paths a real database would make hard to reach (a write failing at the wrong
// moment).
vi.mock("@/server/services/whatsapp-webhook-events", () => ({
  recordWebhookEvent: (...args: unknown[]) => recordWebhookEvent(...args),
}));

vi.mock("@/server/services/inbound-message-processing", () => ({
  processWebhookEvent: (...args: unknown[]) => processWebhookEvent(...args),
}));

beforeEach(() => {
  vi.resetModules();
  recordWebhookEvent.mockReset();
  recordWebhookEvent.mockResolvedValue({
    eventId: "11111111-1111-1111-1111-111111111111",
    created: true,
    workspaceId: "22222222-2222-2222-2222-222222222222",
  });

  processWebhookEvent.mockReset();
  processWebhookEvent.mockResolvedValue({
    eventId: "11111111-1111-1111-1111-111111111111",
    inserted: 1,
    duplicates: 0,
    skipped: 0,
  });

  process.env = {
    ...originalEnv,
    META_APP_SECRET: APP_SECRET,
    META_WEBHOOK_VERIFY_TOKEN: "synthetic-verify-token",
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = originalEnv;
});

function inboundPayload() {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "2439042053289493",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "15550000000",
                phone_number_id: PHONE_NUMBER_ID,
              },
              messages: [
                {
                  from: SYNTHETIC_WA_ID,
                  id: "wamid.SYNTHETIC1",
                  timestamp: "1758254144",
                  type: "text",
                  text: { body: SYNTHETIC_BODY },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

async function post(body: string, signature?: string | null) {
  const { POST } = await import("@/app/api/webhooks/whatsapp/route");

  const headers: Record<string, string> = { "content-type": "application/json" };
  const value = signature === undefined ? signWebhookBody(body, APP_SECRET) : signature;
  if (value !== null) headers["x-hub-signature-256"] = value;

  return POST(
    new Request("https://example.test/api/webhooks/whatsapp", {
      method: "POST",
      headers,
      body,
    }),
  );
}

describe("POST /api/webhooks/whatsapp — authenticity", () => {
  it("accepts a correctly signed delivery", async () => {
    const response = await post(JSON.stringify(inboundPayload()));

    expect(response.status).toBe(200);
    expect(recordWebhookEvent).toHaveBeenCalledTimes(1);
  });

  it("rejects an unsigned delivery without storing anything", async () => {
    const response = await post(JSON.stringify(inboundPayload()), null);

    expect(response.status).toBe(403);
    expect(recordWebhookEvent).not.toHaveBeenCalled();
  });

  it("rejects a signature computed with the wrong secret", async () => {
    const body = JSON.stringify(inboundPayload());
    const response = await post(body, signWebhookBody(body, "a-different-secret"));

    expect(response.status).toBe(403);
    expect(recordWebhookEvent).not.toHaveBeenCalled();
  });

  // The case that matters most: a valid signature for a *different* body would
  // let an attacker who has seen one delivery replay its header with altered
  // content — inventing a patient message.
  it("rejects a valid signature paired with a tampered body", async () => {
    const original = JSON.stringify(inboundPayload());
    const signature = signWebhookBody(original, APP_SECRET);

    const tampered = original.replace(SYNTHETIC_BODY, "tampered content");
    const response = await post(tampered, signature);

    expect(response.status).toBe(403);
    expect(recordWebhookEvent).not.toHaveBeenCalled();
  });

  it.each([["notsha256=abc"], ["sha256="], ["sha256=nothex"], ["sha1=abc123"]])(
    "rejects a malformed signature header %s",
    async (header) => {
      const response = await post(JSON.stringify(inboundPayload()), header);

      expect(response.status).toBe(403);
      expect(recordWebhookEvent).not.toHaveBeenCalled();
    },
  );

  it("refuses every delivery when no app secret is configured", async () => {
    delete process.env.META_APP_SECRET;

    const response = await post(
      JSON.stringify(inboundPayload()),
      `sha256=${"a".repeat(64)}`,
    );

    expect(response.status).toBe(500);
    expect(recordWebhookEvent).not.toHaveBeenCalled();
  });
});

describe("POST /api/webhooks/whatsapp — acknowledgement rules", () => {
  // Retrying will not make invalid JSON parse, and a non-200 costs 36 hours of
  // redelivery attempts for a body that can never succeed.
  it("acknowledges an unparseable body rather than making Meta retry it", async () => {
    const response = await post("{ not json at all");

    expect(response.status).toBe(200);
    expect(recordWebhookEvent).not.toHaveBeenCalled();
  });

  it("acknowledges a payload whose shape it does not recognise", async () => {
    const response = await post(JSON.stringify({ object: "whatsapp_business_account" }));

    expect(response.status).toBe(200);
    expect(recordWebhookEvent).not.toHaveBeenCalled();
  });

  it("acknowledges and ignores a subscription for another Meta product", async () => {
    const response = await post(
      JSON.stringify({ ...inboundPayload(), object: "instagram" }),
    );

    expect(response.status).toBe(200);
    expect(recordWebhookEvent).not.toHaveBeenCalled();
  });

  // The asymmetry: an event we failed to store is gone unless Meta retries, so
  // this is the one failure that must NOT be acknowledged.
  it("does not acknowledge a delivery it failed to store", async () => {
    recordWebhookEvent.mockRejectedValue(new Error("database unavailable"));

    const response = await post(JSON.stringify(inboundPayload()));

    expect(response.status).toBe(500);
  });

  it("acknowledges a retry of a delivery it already holds", async () => {
    recordWebhookEvent.mockResolvedValue({
      eventId: "11111111-1111-1111-1111-111111111111",
      created: false,
      workspaceId: "22222222-2222-2222-2222-222222222222",
    });

    const response = await post(JSON.stringify(inboundPayload()));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true, duplicate: true });

    // Re-processing a retry would be harmless but pointless: its messages are
    // already stored.
    expect(processWebhookEvent).not.toHaveBeenCalled();
  });

  // Processing happens in the request, so a failure there must not be
  // acknowledged either — the event is stored, but the retry is what gets the
  // messages in front of the doctor.
  it("does not acknowledge a delivery it stored but could not process", async () => {
    processWebhookEvent.mockRejectedValue(new Error("processing failed"));

    const response = await post(JSON.stringify(inboundPayload()));

    expect(response.status).toBe(500);
  });

  it("stores a delivery naming a number no workspace has connected", async () => {
    recordWebhookEvent.mockResolvedValue({
      eventId: "11111111-1111-1111-1111-111111111111",
      created: true,
      workspaceId: null,
    });

    const response = await post(JSON.stringify(inboundPayload()));

    // Unroutable is not the same as invalid: the event is evidence of a
    // misconfiguration and discarding it would destroy the only trace.
    expect(response.status).toBe(200);
    expect(recordWebhookEvent).toHaveBeenCalledTimes(1);
  });

  it("reads the body as raw text, so the signature is checked over Meta's bytes", async () => {
    // Key order differs from anything JSON.stringify would reproduce from the
    // parsed object; a handler that re-serialised would compute a different
    // digest and reject this.
    const body =
      '{"entry":[{"changes":[],"id":"x"}],"object":"whatsapp_business_account"}';
    const response = await post(body);

    expect(response.status).toBe(200);
  });
});

describe("POST /api/webhooks/whatsapp — logging", () => {
  it("never writes patient message content to the logs", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line) => logs.push(String(line)));
    vi.spyOn(console, "warn").mockImplementation((line) => logs.push(String(line)));
    vi.spyOn(console, "error").mockImplementation((line) => logs.push(String(line)));

    await post(JSON.stringify(inboundPayload()));
    await post("{ not json at all");

    const everything = logs.join("\n");
    expect(everything).not.toContain(SYNTHETIC_BODY);
    expect(everything).not.toContain(SYNTHETIC_WA_ID);
  });
});
