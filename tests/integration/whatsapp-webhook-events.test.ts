import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/types/database";

/**
 * Webhook delivery storage against the real local database (Task 6.2).
 *
 * Mocking the database here would test nothing worth testing. The guarantee
 * this task rests on — that a retried delivery cannot produce a second copy —
 * is enforced by a unique index, not by the code, and the code's job is only
 * to react correctly when that index fires. So the index has to be real.
 *
 * Requires `npx supabase start`; skipped otherwise.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY ?? "";

const DOCTOR_A = "11111111-1111-1111-1111-111111111111";

/** Unique per run, so repeated runs never collide on the active-number index. */
const PHONE_NUMBER_ID = `TEST_WEBHOOK_PHONE_${Date.now()}`;
const UNKNOWN_PHONE_NUMBER_ID = `TEST_UNKNOWN_PHONE_${Date.now()}`;

let admin: SupabaseClient<Database>;
let workspaceA: string;
let connectionA: string;

const stackAvailable = await isStackAvailable();

async function isStackAvailable(): Promise<boolean> {
  if (SUPABASE_URL === "" || SECRET_KEY === "") return false;

  try {
    return (await fetch(`${SUPABASE_URL}/auth/v1/health`)).ok;
  } catch {
    return false;
  }
}

beforeAll(async () => {
  if (!stackAvailable) return;

  admin = createClient<Database>(SUPABASE_URL, SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: membership } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", DOCTOR_A)
    .single();

  workspaceA = membership?.workspace_id ?? "";

  // A connected number of our own, rather than the seeded one, so this suite
  // cannot change what the other suites see.
  const { data: connection } = await admin
    .from("whatsapp_connections")
    .insert({
      workspace_id: workspaceA,
      status: "connected",
      phone_number_id: PHONE_NUMBER_ID,
      waba_id: `TEST_WABA_${Date.now()}`,
      display_phone_number: "+1 555 0100",
      verified_name: "Synthetic Clinic",
    })
    .select("id")
    .single();

  connectionA = connection?.id ?? "";
});

afterEach(async () => {
  if (!stackAvailable) return;

  await admin
    .from("whatsapp_webhook_events")
    .delete()
    .in("phone_number_id", [PHONE_NUMBER_ID, UNKNOWN_PHONE_NUMBER_ID]);
});

// The connection created above belongs to a seeded workspace, so leaving it
// behind is not merely untidy: the pgTAP suite and the connection E2E spec both
// assume that workspace has exactly one connection, and an extra row makes them
// fail somewhere else entirely.
afterAll(async () => {
  if (!stackAvailable) return;

  await admin
    .from("whatsapp_connections")
    .delete()
    .eq("phone_number_id", PHONE_NUMBER_ID);
});

function payloadFor(phoneNumberId: string, wamid: string) {
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
                phone_number_id: phoneNumberId,
              },
              messages: [
                {
                  from: "21600000000",
                  id: wamid,
                  timestamp: "1758254144",
                  type: "text",
                  text: { body: "synthetic message content" },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

async function record(body: unknown) {
  const { recordWebhookEvent } =
    await import("@/server/services/whatsapp-webhook-events");
  const { parseWebhookPayload } =
    await import("@/server/integrations/meta/webhook-payload");

  const rawBody = JSON.stringify(body);
  const parsed = parseWebhookPayload(rawBody);
  if (parsed.outcome !== "parsed") throw new Error("fixture payload is invalid");

  return recordWebhookEvent({
    rawBody,
    payload: parsed.payload,
    requestId: "test-request-id",
  });
}

describe.skipIf(!stackAvailable)("recordWebhookEvent", () => {
  it("stores a delivery and routes it to the owning workspace", async () => {
    const result = await record(payloadFor(PHONE_NUMBER_ID, "wamid.SYNTHETIC_A"));

    expect(result.created).toBe(true);
    expect(result.workspaceId).toBe(workspaceA);

    const { data } = await admin
      .from("whatsapp_webhook_events")
      .select("connection_id, workspace_id, status, phone_number_id")
      .eq("id", result.eventId)
      .single();

    expect(data).toMatchObject({
      connection_id: connectionA,
      workspace_id: workspaceA,
      status: "received",
      phone_number_id: PHONE_NUMBER_ID,
    });
  });

  // The whole point of the task. Meta retries until it gets a 200, and a retry
  // repeats the same bytes.
  it("stores a retried delivery exactly once", async () => {
    const payload = payloadFor(PHONE_NUMBER_ID, "wamid.SYNTHETIC_RETRY");

    const first = await record(payload);
    const second = await record(payload);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.eventId).toBe(first.eventId);

    const { count } = await admin
      .from("whatsapp_webhook_events")
      .select("id", { count: "exact", head: true })
      .eq("phone_number_id", PHONE_NUMBER_ID);

    expect(count).toBe(1);
  });

  // Concurrency is the case a "check then insert" implementation gets wrong:
  // both callers look, both find nothing, both insert. Only a constraint
  // survives this.
  it("stores one row when the same delivery arrives twice at once", async () => {
    const payload = payloadFor(PHONE_NUMBER_ID, "wamid.SYNTHETIC_CONCURRENT");

    const results = await Promise.all([record(payload), record(payload)]);

    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(results[0].eventId).toBe(results[1].eventId);
  });

  it("treats a different delivery as new even for the same number", async () => {
    const first = await record(payloadFor(PHONE_NUMBER_ID, "wamid.SYNTHETIC_ONE"));
    const second = await record(payloadFor(PHONE_NUMBER_ID, "wamid.SYNTHETIC_TWO"));

    expect(first.created).toBe(true);
    expect(second.created).toBe(true);
    expect(second.eventId).not.toBe(first.eventId);
  });

  // An unroutable event is evidence of a misconfiguration. Dropping it would
  // destroy the only trace, and Meta cannot be asked for it again.
  it("stores a delivery for a number no workspace has connected", async () => {
    const result = await record(
      payloadFor(UNKNOWN_PHONE_NUMBER_ID, "wamid.SYNTHETIC_ORPHAN"),
    );

    expect(result.created).toBe(true);
    expect(result.workspaceId).toBeNull();

    const { data } = await admin
      .from("whatsapp_webhook_events")
      .select("connection_id, workspace_id, phone_number_id")
      .eq("id", result.eventId)
      .single();

    expect(data).toMatchObject({
      connection_id: null,
      workspace_id: null,
      phone_number_id: UNKNOWN_PHONE_NUMBER_ID,
    });
  });

  // A pending connection is a doctor who has not finished claiming the number.
  // Routing patient messages into that inbox would be worse than not routing.
  it("does not route a delivery to a connection that is not connected", async () => {
    await admin
      .from("whatsapp_connections")
      .update({ status: "disconnected", disconnected_at: new Date().toISOString() })
      .eq("id", connectionA);

    const result = await record(payloadFor(PHONE_NUMBER_ID, "wamid.SYNTHETIC_PENDING"));

    expect(result.created).toBe(true);
    expect(result.workspaceId).toBeNull();

    await admin
      .from("whatsapp_connections")
      .update({ status: "connected", disconnected_at: null })
      .eq("id", connectionA);
  });

  it("keeps the payload intact, including fields the schema does not model", async () => {
    const payload = payloadFor(PHONE_NUMBER_ID, "wamid.SYNTHETIC_INTACT");
    const result = await record(payload);

    const { data } = await admin
      .from("whatsapp_webhook_events")
      .select("payload")
      .eq("id", result.eventId)
      .single();

    // Task 6.3 reads this back to build messages. Anything the schema silently
    // stripped here would be unrecoverable, since Meta cannot resend it.
    expect(data?.payload).toEqual(payload);
  });
});

describe.skipIf(!stackAvailable)("whatsapp_webhook_events access", () => {
  // The payload holds patient message content, so no browser-reachable role
  // may read it — this table is service_role only, by absence of any policy.
  it("is unreadable by the anonymous and authenticated roles", async () => {
    const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
    const anon = createClient<Database>(SUPABASE_URL, publishable, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    await record(payloadFor(PHONE_NUMBER_ID, "wamid.SYNTHETIC_RLS"));

    const { data, error } = await anon.from("whatsapp_webhook_events").select("id");

    expect(error ?? data).not.toBeNull();
    expect(data ?? []).toHaveLength(0);
  });
});
