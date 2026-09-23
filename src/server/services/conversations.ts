import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/errors/app-error";
import { logger } from "@/lib/logger/logger";
import {
  decodeMessageCursor,
  encodeMessageCursor,
  type MessageCursor,
} from "@/server/services/message-cursor";
import type { Database } from "@/types/database";

/**
 * Reads of a workspace's conversations and messages.
 *
 * Every function takes the Supabase client as its first argument rather than
 * building one. That keeps the request-scoped client at the edge (a page or
 * route handler creates it once) and lets these functions be tested against a
 * real database without a request context.
 *
 * The client passed in is expected to be RLS-bound, so the database enforces
 * tenant isolation independently of the `workspaceId` filters here. Those
 * filters are the second layer, not the only one.
 */

type Client = SupabaseClient<Database>;

export type MessageDirection = Database["public"]["Enums"]["message_direction"];
export type MessageType = Database["public"]["Enums"]["message_type"];
export type DeliveryStatus = Database["public"]["Enums"]["message_delivery_status"];

export type ConversationSummary = {
  readonly id: string;
  readonly contactName: string | null;
  readonly contactWaId: string;
  readonly lastMessageAt: string | null;
  readonly unreadCount: number;
  /** Newest message text, or null when there are no messages or it carries none. */
  readonly lastMessageText: string | null;
  readonly lastMessageDirection: MessageDirection | null;
  readonly lastMessageType: MessageType | null;
};

export type Message = {
  readonly id: string;
  readonly direction: MessageDirection;
  readonly messageType: MessageType;
  readonly textBody: string | null;
  readonly deliveryStatus: DeliveryStatus | null;
  readonly sentAt: string;
};

export type MessagePage = {
  readonly messages: Message[];
  /** Pass to the next call to continue. `null` when the thread is exhausted. */
  readonly nextCursor: string | null;
};

/** Bounds a single request's work regardless of what the caller asks for. */
const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;

/**
 * A workspace's conversations, most recently active first.
 *
 * `nulls last` so a conversation with no messages yet sorts to the bottom
 * rather than to the top, where Postgres would otherwise put it.
 */
export async function listConversations(
  supabase: Client,
  workspaceId: string,
): Promise<ConversationSummary[]> {
  // Reads the `conversation_list` view, which attaches each conversation's
  // newest message through a lateral join. Fetching the list and then a message
  // per row would be an N+1 that grows with the doctor's inbox.
  const { data, error } = await supabase
    .from("conversation_list")
    .select(
      "id, last_message_at, unread_count, contact_wa_id, contact_profile_name, last_message_text, last_message_direction, last_message_type",
    )
    .eq("workspace_id", workspaceId)
    .order("last_message_at", { ascending: false, nullsFirst: false });

  if (error) {
    throw databaseError("conversations.list", error, { workspaceId });
  }

  return data.flatMap((row) => {
    // Every column of a view is nullable in the generated types. `id` and the
    // contact identity cannot actually be null, but skipping a surprising row
    // beats a non-null assertion that crashes the whole inbox.
    if (row.id === null || row.contact_wa_id === null) return [];

    return [
      {
        id: row.id,
        contactName: row.contact_profile_name,
        contactWaId: row.contact_wa_id,
        lastMessageAt: row.last_message_at,
        unreadCount: row.unread_count ?? 0,
        lastMessageText: row.last_message_text,
        lastMessageDirection: row.last_message_direction,
        lastMessageType: row.last_message_type,
      },
    ];
  });
}

/**
 * One conversation, or `NOT_FOUND`.
 *
 * A conversation in another workspace is invisible to an RLS-bound client, so
 * it is reported as not found rather than forbidden. That is deliberate:
 * "forbidden" would confirm the id exists, letting someone probe for other
 * tenants' conversation ids.
 */
export async function getConversation(
  supabase: Client,
  workspaceId: string,
  conversationId: string,
): Promise<ConversationSummary> {
  const { data, error } = await supabase
    .from("conversations")
    .select("id, last_message_at, unread_count, contacts (wa_id, profile_name)")
    .eq("workspace_id", workspaceId)
    .eq("id", conversationId)
    .maybeSingle();

  if (error) {
    // An id that is not a uuid fails at parse time in Postgres (22P02). That is
    // a client mistake, not a database fault, and must not be reported as one.
    if (error.code === "22P02") {
      throw new AppError(ERROR_CODES.NOT_FOUND, "Conversation not found.", {
        context: { operation: "conversations.get", reason: "malformed id" },
      });
    }

    throw databaseError("conversations.get", error, { workspaceId });
  }

  if (data === null || data.contacts === null) {
    throw new AppError(ERROR_CODES.NOT_FOUND, "Conversation not found.", {
      context: { operation: "conversations.get", workspaceId },
    });
  }

  return {
    id: data.id,
    contactName: data.contacts.profile_name,
    contactWaId: data.contacts.wa_id,
    lastMessageAt: data.last_message_at,
    unreadCount: data.unread_count,
    // The thread view renders the messages themselves, so a preview would be
    // dead weight here.
    lastMessageText: null,
    lastMessageDirection: null,
    lastMessageType: null,
  };
}

/**
 * One page of a thread, newest first.
 *
 * @param cursor Opaque value from a previous page's `nextCursor`. Omit for the
 *               first page.
 */
export async function listMessages(
  supabase: Client,
  conversationId: string,
  options: { cursor?: string | null; limit?: number } = {},
): Promise<MessagePage> {
  const limit = clampPageSize(options.limit);
  const cursor =
    options.cursor === undefined || options.cursor === null
      ? null
      : decodeMessageCursor(options.cursor);

  let query = supabase
    .from("messages")
    .select("id, direction, message_type, text_body, delivery_status, sent_at")
    .eq("conversation_id", conversationId)
    .order("sent_at", { ascending: false })
    .order("id", { ascending: false })
    // One extra row purely to discover whether another page exists, without a
    // second count query.
    .limit(limit + 1);

  if (cursor !== null) {
    query = query.or(buildKeysetFilter(cursor));
  }

  const { data, error } = await query;

  if (error) {
    if (error.code === "22P02") {
      throw new AppError(ERROR_CODES.NOT_FOUND, "Conversation not found.", {
        context: { operation: "messages.list", reason: "malformed id" },
      });
    }

    throw databaseError("messages.list", error, { conversationId });
  }

  const hasMore = data.length > limit;
  const rows = hasMore ? data.slice(0, limit) : data;
  const last = rows.at(-1);

  return {
    messages: rows.map((row) => ({
      id: row.id,
      direction: row.direction,
      messageType: row.message_type,
      textBody: row.text_body,
      deliveryStatus: row.delivery_status,
      sentAt: row.sent_at,
    })),
    nextCursor:
      hasMore && last !== undefined
        ? encodeMessageCursor({ sentAt: last.sent_at, id: last.id })
        : null,
  };
}

/**
 * The row-value comparison `(sent_at, id) < (cursorSentAt, cursorId)`, spelled
 * out because PostgREST has no row-constructor syntax.
 *
 * Reads as: strictly older, or the same instant with a lower id. The second
 * clause is what keeps messages sharing a timestamp from being skipped or
 * repeated.
 */
function buildKeysetFilter(cursor: MessageCursor): string {
  return [
    `sent_at.lt.${cursor.sentAt}`,
    `and(sent_at.eq.${cursor.sentAt},id.lt.${cursor.id})`,
  ].join(",");
}

function clampPageSize(requested: number | undefined): number {
  if (requested === undefined) return DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(requested) || requested < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(requested, MAX_PAGE_SIZE);
}

function databaseError(
  operation: string,
  error: { code?: string; message: string },
  context: Record<string, unknown>,
): AppError {
  logger.error(`${operation} failed`, error, { operation, ...context });

  return new AppError(ERROR_CODES.DATABASE_ERROR, undefined, {
    context: { operation, providerCode: error.code },
    cause: error,
  });
}
