import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/types/database";

/**
 * The whole inbound pipeline against the real local database (Task 6.3).
 *
 * Stored event → contact → conversation → message, exactly once.
 *
 * Every guarantee worth having here is a database constraint: the unique index
 * on provider_message_id, the composite foreign keys that stop a message
 * pointing at another workspace's conversation, the trigger that maintains
 * last_message_at. Mocking any of it would test the mock.
 *
 * Requires `npx supabase start`; skipped otherwise.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY ?? "";

const DOCTOR_A = "11111111-1111-1111-1111-111111111111";
const DOCTOR_B = "22222222-2222-2222-2222-222222222222";

const PHONE_NUMBER_ID = `TEST_PIPE_PHONE_${Date.now()}`;
const WA_ID = `2169${Date.now().toString().slice(-7)}`;

let admin: SupabaseClient<Database>;
let workspaceA: string;
let workspaceB: string;
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

async function workspaceOf(userId: string): Promise<string> {
  const { data } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .single();

  return data?.workspace_id ?? "";
}

beforeAll(async () => {
  if (!stackAvailable) return;

  admin = createClient<Database>(SUPABASE_URL, SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  workspaceA = await workspaceOf(DOCTOR_A);
  workspaceB = await workspaceOf(DOCTOR_B);

  const { data } = await admin
    .from("whatsapp_connections")
    .insert({
      workspace_id: workspaceA,
      status: "connected",
      phone_number_id: PHONE_NUMBER_ID,
      waba_id: `TEST_PIPE_WABA_${Date.now()}`,
      display_phone_number: "+1 555 0101",
      verified_name: "Synthetic Clinic",
    })
    .select("id")
    .single();

  connectionA = data?.id ?? "";
});

afterEach(async () => {
  if (!stackAvailable) return;

  // Messages and conversations cascade from the contact.
  await admin.from("contacts").delete().eq("wa_id", WA_ID);
  await admin
    .from("whatsapp_webhook_events")
    .delete()
    .eq("phone_number_id", PHONE_NUMBER_ID);
});

// Leaving this behind would give a seeded workspace a second connection, which
// breaks the pgTAP suite and the connection E2E spec in confusing ways.
afterAll(async () => {
  if (!stackAvailable) return;

  await admin.from("contacts").delete().eq("wa_id", WA_ID);
  await admin
    .from("whatsapp_connections")
    .delete()
    .eq("phone_number_id", PHONE_NUMBER_ID);
});

function payload(messages: unknown[], contacts?: unknown[]) {
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
              ...(contacts === undefined ? {} : { contacts }),
              messages,
            },
          },
        ],
      },
    ],
  };
}

function textMessage(id: string, body: string, timestamp = "1758254144") {
  return {
    from: WA_ID,
    id,
    timestamp,
    type: "text",
    text: { body },
  };
}

/** Stores a delivery the way the route does, then processes it. */
async function deliver(body: unknown) {
  const { recordWebhookEvent } =
    await import("@/server/services/whatsapp-webhook-events");
  const { processWebhookEvent } =
    await import("@/server/services/inbound-message-processing");
  const { parseWebhookPayload } =
    await import("@/server/integrations/meta/webhook-payload");

  const rawBody = JSON.stringify(body);
  const parsed = parseWebhookPayload(rawBody);
  if (parsed.outcome !== "parsed") throw new Error("fixture payload is invalid");

  const event = await recordWebhookEvent({
    rawBody,
    payload: parsed.payload,
    requestId: "test-request-id",
  });

  const processed = await processWebhookEvent({
    eventId: event.eventId,
    requestId: "test-request-id",
  });

  return { event, processed };
}

async function storedMessages() {
  const { data } = await admin
    .from("messages")
    .select(
      "provider_message_id, text_body, direction, message_type, sent_at, workspace_id",
    )
    .eq("workspace_id", workspaceA)
    .like("provider_message_id", "wamid.PIPE%")
    .order("sent_at", { ascending: true });

  return data ?? [];
}

describe.skipIf(!stackAvailable)("inbound message pipeline", () => {
  it("turns a delivery into a contact, a conversation and a message", async () => {
    const { processed } = await deliver(
      payload(
        [textMessage("wamid.PIPE_1", "synthetic message content")],
        [{ wa_id: WA_ID, profile: { name: "Synthetic Patient" } }],
      ),
    );

    expect(processed).toMatchObject({ inserted: 1, duplicates: 0, skipped: 0 });

    const { data: contact } = await admin
      .from("contacts")
      .select("id, workspace_id, profile_name")
      .eq("wa_id", WA_ID)
      .single();

    expect(contact).toMatchObject({
      workspace_id: workspaceA,
      profile_name: "Synthetic Patient",
    });

    const { data: conversation } = await admin
      .from("conversations")
      .select("id, workspace_id, connection_id, last_message_at")
      .eq("contact_id", contact?.id ?? "")
      .single();

    expect(conversation).toMatchObject({
      workspace_id: workspaceA,
      connection_id: connectionA,
    });
    // Maintained by trigger; the conversation list orders on it.
    expect(conversation?.last_message_at).not.toBeNull();

    expect(await storedMessages()).toMatchObject([
      {
        provider_message_id: "wamid.PIPE_1",
        text_body: "synthetic message content",
        direction: "inbound",
        message_type: "text",
      },
    ]);
  });

  // The milestone's hardest requirement: a retry must not duplicate a patient's
  // message.
  it("stores one message when the same delivery is processed twice", async () => {
    const body = payload([textMessage("wamid.PIPE_DUP", "synthetic message content")]);

    const first = await deliver(body);
    const second = await deliver(body);

    expect(first.processed.inserted).toBe(1);
    // The second never reaches processing: the delivery digest already matched.
    expect(second.event.created).toBe(false);

    expect(await storedMessages()).toHaveLength(1);
  });

  // A rebatched delivery hashes differently, so event-level dedup misses it.
  // This is the case the message-level unique index exists for.
  it("stores one message when the same wamid arrives in a different batch", async () => {
    await deliver(payload([textMessage("wamid.PIPE_REBATCH", "first")]));

    const { processed } = await deliver(
      payload([
        textMessage("wamid.PIPE_REBATCH", "first"),
        textMessage("wamid.PIPE_REBATCH_NEW", "second", "1758254145"),
      ]),
    );

    expect(processed).toMatchObject({ inserted: 1, duplicates: 1 });
    expect(await storedMessages()).toHaveLength(2);
  });

  it("puts several messages from one patient in a single conversation", async () => {
    await deliver(
      payload([
        textMessage("wamid.PIPE_A", "first", "1758254144"),
        textMessage("wamid.PIPE_B", "second", "1758254145"),
        textMessage("wamid.PIPE_C", "third", "1758254146"),
      ]),
    );

    const { data: conversations } = await admin
      .from("conversations")
      .select("id")
      .eq("workspace_id", workspaceA)
      .eq("connection_id", connectionA);

    expect(conversations).toHaveLength(1);
    expect(await storedMessages()).toHaveLength(3);
  });

  it("keeps the readable messages when one in the batch is not", async () => {
    const { processed } = await deliver(
      payload([
        textMessage("wamid.PIPE_OK_1", "first"),
        { id: "wamid.PIPE_BROKEN", nonsense: true },
        textMessage("wamid.PIPE_OK_2", "second", "1758254145"),
      ]),
    );

    expect(processed).toMatchObject({ inserted: 2, skipped: 1 });
    expect(await storedMessages()).toHaveLength(2);
  });

  it("marks the event processed so it is not replayed", async () => {
    const { event } = await deliver(payload([textMessage("wamid.PIPE_STATUS", "x")]));

    const { data } = await admin
      .from("whatsapp_webhook_events")
      .select("status, processed_at")
      .eq("id", event.eventId)
      .single();

    expect(data?.status).toBe("processed");
    expect(data?.processed_at).not.toBeNull();
  });

  // Tenant isolation is the thing that must never be got wrong: one doctor
  // seeing another's patient is the worst outcome this system has.
  it("never writes a message into another workspace", async () => {
    await deliver(payload([textMessage("wamid.PIPE_TENANT", "synthetic")]));

    const { count } = await admin
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceB)
      .like("provider_message_id", "wamid.PIPE%");

    expect(count).toBe(0);
  });

  it("records an unsupported message type rather than losing it", async () => {
    const { processed } = await deliver(
      payload([
        {
          from: WA_ID,
          id: "wamid.PIPE_FUTURE",
          timestamp: "1758254144",
          type: "some_future_type",
          some_future_type: { data: "whatever Meta adds next" },
        },
      ]),
    );

    expect(processed.inserted).toBe(1);
    expect(await storedMessages()).toMatchObject([
      { provider_message_id: "wamid.PIPE_FUTURE", message_type: "unsupported" },
    ]);
  });
});
