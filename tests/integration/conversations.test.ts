import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  getConversation,
  listConversations,
  listMessages,
} from "@/server/services/conversations";
import { isAppError } from "@/lib/errors/app-error";
import type { Database } from "@/types/database";

/**
 * The conversation service against the real local database.
 *
 * These use genuine RLS-bound clients signed in as the seeded doctors, because
 * the behaviour worth testing here — ordering, keyset pagination and what one
 * tenant cannot see — only exists once Postgres is involved. A mocked client
 * would assert that the code calls the functions it calls, which proves nothing.
 *
 * Requires `npx supabase start` and a seeded database; skipped otherwise.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const PASSWORD = "devpassword123";

/** Doctor A's seeded thread: 24 alternating + 3 sharing a timestamp. */
const CONVERSATION_A = "55555555-5555-5555-5555-555555555555";

type Client = SupabaseClient<Database>;

let doctorA: Client;
let doctorB: Client;
let workspaceA: string;
let workspaceB: string;

/**
 * Decided at module load so `describe.skipIf` can act on it.
 *
 * Checking inside `beforeAll` and returning early from each test would report
 * the suite as *passing* when the stack is down — which is worse than useless,
 * because a green run would mean nothing was verified.
 */
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

async function workspaceIdOf(client: Client): Promise<string> {
  const { data, error } = await client.from("workspace_members").select("workspace_id");
  if (error) throw error;
  return data[0]!.workspace_id;
}

beforeAll(async () => {
  if (!stackAvailable) return;

  doctorA = await signIn("doctor-a@example.test");
  doctorB = await signIn("doctor-b@example.test");
  workspaceA = await workspaceIdOf(doctorA);
  workspaceB = await workspaceIdOf(doctorB);
});

/**
 * Skips the whole suite when the local stack is not running, so a developer
 * without Docker sees "skipped" rather than a wall of failures — and never
 * sees a false pass.
 */
const describeWithStack = describe.skipIf(!stackAvailable);

describeWithStack("listConversations", () => {
  it("returns the workspace's conversations, most recently active first", async () => {
    const conversations = await listConversations(doctorA, workspaceA);

    expect(conversations.length).toBeGreaterThanOrEqual(2);

    const timestamps = conversations
      .map((conversation) => conversation.lastMessageAt)
      .filter((value): value is string => value !== null)
      .map((value) => Date.parse(value));

    const sorted = [...timestamps].sort((a, b) => b - a);
    expect(timestamps).toEqual(sorted);
  });

  it("includes the contact identity and unread count", async () => {
    const conversations = await listConversations(doctorA, workspaceA);
    const conversation = conversations.find((c) => c.id === CONVERSATION_A);

    expect(conversation).toBeDefined();
    expect(conversation?.contactWaId).toBe("15550000001");
    expect(conversation?.unreadCount).toBeGreaterThan(0);
  });

  // An empty workspace is an ordinary state, not an error.
  it("returns an empty list for a workspace with no conversations", async () => {
    expect(await listConversations(doctorB, workspaceB)).toEqual([]);
  });
});

describeWithStack("getConversation", () => {
  it("returns one conversation", async () => {
    const conversation = await getConversation(doctorA, workspaceA, CONVERSATION_A);

    expect(conversation.id).toBe(CONVERSATION_A);
  });

  // Reported as not found rather than forbidden on purpose: "forbidden" would
  // confirm the id exists and let someone probe for other tenants' ids.
  it("reports another workspace's conversation as not found", async () => {
    try {
      await getConversation(doctorB, workspaceB, CONVERSATION_A);
      expect.unreachable("expected NOT_FOUND");
    } catch (error) {
      expect(isAppError(error)).toBe(true);
      if (isAppError(error)) expect(error.code).toBe("NOT_FOUND");
    }
  });

  // A non-uuid fails at parse time in Postgres. That is a client mistake and
  // must not surface as a database fault.
  it.each(["not-a-uuid", "1 OR 1=1", ""])(
    "reports the malformed id %s as not found, not a server error",
    async (id) => {
      try {
        await getConversation(doctorA, workspaceA, id);
        expect.unreachable("expected NOT_FOUND");
      } catch (error) {
        expect(isAppError(error)).toBe(true);
        if (isAppError(error)) expect(error.code).toBe("NOT_FOUND");
      }
    },
  );
});

describeWithStack("listMessages", () => {
  it("returns the newest messages first", async () => {
    const page = await listMessages(doctorA, CONVERSATION_A, { limit: 10 });

    expect(page.messages.length).toBe(10);

    const times = page.messages.map((message) => Date.parse(message.sentAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("reports no further pages once the thread is exhausted", async () => {
    const page = await listMessages(doctorA, CONVERSATION_A, { limit: 100 });

    expect(page.nextCursor).toBeNull();
  });

  /**
   * The assertion this whole schema was designed around.
   *
   * The seed contains three messages sharing one `sent_at`, because Meta's
   * timestamps have one-second resolution. Paging in small steps forces a page
   * boundary to land inside that group: a cursor on the timestamp alone would
   * either skip or repeat those rows here.
   */
  it("walks the whole thread exactly once, in small pages", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;

    do {
      const page: Awaited<ReturnType<typeof listMessages>> = await listMessages(
        doctorA,
        CONVERSATION_A,
        { cursor, limit: 2 },
      );

      seen.push(...page.messages.map((message) => message.id));
      cursor = page.nextCursor;
      pages += 1;

      expect(pages).toBeLessThan(100);
    } while (cursor !== null);

    const all = await listMessages(doctorA, CONVERSATION_A, { limit: 100 });

    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBe(all.messages.length);
    expect(seen).toEqual(all.messages.map((message) => message.id));
  });

  it("returns nothing for a conversation in another workspace", async () => {
    const page = await listMessages(doctorB, CONVERSATION_A);

    expect(page.messages).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it("rejects a cursor it did not issue", async () => {
    await expect(
      listMessages(doctorA, CONVERSATION_A, { cursor: "tampered" }),
    ).rejects.toThrow();
  });

  // A caller asking for a million rows must not be able to make the database do
  // that much work.
  it("clamps an oversized page size", async () => {
    const page = await listMessages(doctorA, CONVERSATION_A, { limit: 100_000 });

    expect(page.messages.length).toBeLessThanOrEqual(100);
  });

  it.each([0, -5, 1.5, Number.NaN])(
    "falls back to the default page size for the invalid limit %s",
    async (limit) => {
      const page = await listMessages(doctorA, CONVERSATION_A, { limit });

      expect(page.messages.length).toBeGreaterThan(0);
      expect(page.messages.length).toBeLessThanOrEqual(30);
    },
  );
});
