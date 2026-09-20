// @vitest-environment node
//
// Runs under Node rather than the project-wide jsdom default: this test opens a
// real websocket, and jsdom's `Event` implementation clashes with undici's,
// which surfaces as "The \"event\" argument must be an instance of Event" and
// is reported as an unhandled error even while the assertions pass.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/types/database";

/**
 * Realtime delivery against the real local stack.
 *
 * The security-critical assertion is the negative one: a doctor subscribed to
 * their own workspace must not receive another workspace's messages. Realtime
 * pushes rows straight into a browser with no request to audit afterwards, so a
 * leak here would be both silent and unlogged.
 *
 * Requires `npx supabase start` and a seeded database; skipped otherwise.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const PASSWORD = "devpassword123";

/** Doctor A's seeded thread. */
const CONVERSATION_A = "55555555-5555-5555-5555-555555555555";

/** Realtime is a network round trip; this is generous enough not to flake. */
const DELIVERY_TIMEOUT_MS = 20_000;

/**
 * SUBSCRIBED means the channel joined, not that the Postgres Changes binding
 * is serving yet. Inserting in that window loses the event and the test fails
 * for a reason unrelated to the code under test — which is what made this
 * suite intermittent. Observed in the browser too: the first seconds after a
 * page load deliver nothing.
 */
const BINDING_SETTLE_MS = 2_000;

type Client = SupabaseClient<Database>;

const stackAvailable = await isStackAvailable();

async function isStackAvailable(): Promise<boolean> {
  if (SUPABASE_URL === "" || PUBLISHABLE_KEY === "") return false;

  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/health`);
    return response.ok;
  } catch {
    return false;
  }
}

async function signIn(email: string): Promise<Client> {
  const client = createClient<Database>(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;

  return client;
}

/**
 * Subscribes and resolves once the channel is live.
 *
 * Waiting for SUBSCRIBED matters: inserting before the subscription is
 * established produces a test that fails intermittently for reasons that have
 * nothing to do with the code under test.
 */
async function subscribeToConversation(
  client: Client,
  conversationId: string,
  onInsert: (row: Record<string, unknown>) => void,
) {
  const channel = client.channel(`test:${conversationId}:${Math.random()}`).on(
    "postgres_changes",
    {
      event: "INSERT",
      schema: "public",
      table: "messages",
      filter: `conversation_id=eq.${conversationId}`,
    },
    (payload) => onInsert(payload.new),
  );

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("subscription timed out")), 15_000);

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timer);
        resolve();
      }
    });
  });

  await new Promise((resolve) => setTimeout(resolve, BINDING_SETTLE_MS));

  return channel;
}

let doctorA: Client;
let doctorB: Client;
let admin: Client;
let workspaceA: string;

beforeAll(async () => {
  if (!stackAvailable) return;

  doctorA = await signIn("doctor-a@example.test");
  doctorB = await signIn("doctor-b@example.test");

  const secretKey = process.env.SUPABASE_SECRET_KEY ?? "";
  if (secretKey !== "") {
    admin = createClient<Database>(SUPABASE_URL, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  const { data } = await doctorA
    .from("conversations")
    .select("workspace_id")
    .eq("id", CONVERSATION_A)
    .single();

  workspaceA = data?.workspace_id ?? "";
});

afterAll(async () => {
  await doctorA?.removeAllChannels();
  await doctorB?.removeAllChannels();

  // These tests insert inbound messages into a seeded conversation that other
  // suites read. Left behind, they fill the first page of that thread with
  // inbound rows and the thread E2E stops finding an outbound bubble — a
  // failure with no connection to the code being changed.
  if (admin !== undefined) {
    await admin.from("messages").delete().like("provider_message_id", "wamid.RTTEST.%");
  }
});

/** The webhook writes with the secret key, so the test does too. */
async function insertMessage(text: string) {
  const { error } = await admin.from("messages").insert({
    workspace_id: workspaceA,
    conversation_id: CONVERSATION_A,
    direction: "inbound",
    message_type: "text",
    provider_message_id: `wamid.RTTEST.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`,
    text_body: text,
    sent_at: new Date().toISOString(),
  });

  if (error) throw error;
}

const describeWithStack = describe.skipIf(
  !stackAvailable || (process.env.SUPABASE_SECRET_KEY ?? "") === "",
);

describeWithStack("realtime message delivery", () => {
  it("delivers a new message to the workspace that owns it", async () => {
    const received: string[] = [];
    const text = `realtime owner probe ${Date.now()}`;

    const channel = await subscribeToConversation(doctorA, CONVERSATION_A, (row) => {
      received.push(String(row.text_body));
    });

    try {
      await insertMessage(text);

      await expect.poll(() => received, { timeout: DELIVERY_TIMEOUT_MS }).toContain(text);
    } finally {
      await doctorA.removeChannel(channel);
    }
  });

  /**
   * The assertion that matters most. Realtime evaluates each subscriber's RLS
   * policies before delivering, so doctor B must receive nothing even while
   * explicitly subscribed to doctor A's conversation id.
   */
  it("does not deliver another workspace's message to a subscriber", async () => {
    const receivedByB: string[] = [];
    const text = `realtime cross-tenant probe ${Date.now()}`;

    const channelB = await subscribeToConversation(doctorB, CONVERSATION_A, (row) => {
      receivedByB.push(String(row.text_body));
    });

    try {
      await insertMessage(text);

      // Wait out the delivery window, then assert nothing arrived. An
      // immediate assertion would pass simply by being too early.
      await new Promise((resolve) => setTimeout(resolve, 6000));

      expect(receivedByB).toEqual([]);
    } finally {
      await doctorB.removeChannel(channelB);
    }
  }, 30_000);
});
