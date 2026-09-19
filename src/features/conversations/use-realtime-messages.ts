"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import { clientEnv } from "@/lib/config/client-env";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Message } from "@/server/services/conversations";
import type { Database } from "@/types/database";

/**
 * Subscribes to new messages in one conversation.
 *
 * Row Level Security applies to the subscription itself: Realtime evaluates the
 * subscriber's policies before delivering a change, so this cannot receive
 * another workspace's messages even though the filter below is only by
 * conversation id. The filter is an optimisation; the policy is the boundary.
 *
 * **A dedicated client, not the cookie-backed browser client.** The
 * `@supabase/ssr` browser client never registered a Postgres Changes binding:
 * the channel reported SUBSCRIBED while `realtime.subscription` stayed empty
 * and no event was ever delivered — a completely silent failure that looks
 * exactly like a quiet conversation. Creating a plain client and handing it the
 * access token explicitly is what actually registers the binding.
 *
 * The session still comes from the shared browser client, so there is one
 * source of truth for who is signed in; this client only ever holds a token.
 *
 * Deliberately INSERT only. Editing or deleting a patient's message is not part
 * of the product, and handling events the product cannot produce means
 * maintaining code no one exercises.
 */

type MessageRow = Database["public"]["Tables"]["messages"]["Row"];

export type RealtimeStatus = "connecting" | "live" | "error";

export function useRealtimeMessages(
  conversationId: string,
  onMessage: (message: Message) => void,
  onStatusChange?: (status: RealtimeStatus) => void,
) {
  // Held in refs so a new callback identity on each render does not tear down
  // and re-establish the websocket.
  const handler = useRef(onMessage);
  const statusHandler = useRef(onStatusChange);

  useEffect(() => {
    handler.current = onMessage;
    statusHandler.current = onStatusChange;
  }, [onMessage, onStatusChange]);

  useEffect(() => {
    const env = clientEnv();
    const browser = createSupabaseBrowserClient();

    const realtimeClient = createClient<Database>(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      // This client exists only to hold a websocket. Persisting or refreshing a
      // session here would fight the cookie-backed client that owns auth.
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    let cancelled = false;
    let channel: ReturnType<typeof realtimeClient.channel> | null = null;

    async function subscribe() {
      const {
        data: { session },
      } = await browser.auth.getSession();

      if (cancelled || session === null) return;

      // Without a user token the socket is `anon`, RLS denies every row, and
      // nothing is ever delivered.
      await realtimeClient.realtime.setAuth(session.access_token);

      if (cancelled) return;

      channel = realtimeClient
        .channel(`messages:${conversationId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "messages",
            filter: `conversation_id=eq.${conversationId}`,
          },
          (payload) => {
            handler.current(toMessage(payload.new as MessageRow));
          },
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            statusHandler.current?.("live");
          } else if (
            status === "CHANNEL_ERROR" ||
            status === "TIMED_OUT" ||
            status === "CLOSED"
          ) {
            statusHandler.current?.("error");
          }
        });
    }

    // Access tokens expire hourly. Without this the socket keeps a stale token
    // and quietly stops receiving rows partway through a shift.
    const {
      data: { subscription: authSubscription },
    } = browser.auth.onAuthStateChange((_event, session) => {
      if (session !== null) {
        void realtimeClient.realtime.setAuth(session.access_token);
      }
    });

    // A rejected promise here would otherwise vanish, leaving a thread that
    // looks like a quiet conversation.
    void subscribe().catch(() => {
      statusHandler.current?.("error");
    });

    return () => {
      cancelled = true;
      authSubscription.unsubscribe();

      // Without this, navigating between conversations leaves the previous
      // channel open and the next thread receives both conversations' events.
      if (channel !== null) void realtimeClient.removeChannel(channel);
      void realtimeClient.realtime.disconnect();
    };
  }, [conversationId]);
}

/**
 * Maps a raw row from the realtime payload to the domain type.
 *
 * Realtime delivers the database row, not the shape the service returns, so the
 * conversion has to exist somewhere. Keeping it beside the subscription means
 * the rest of the thread only ever sees `Message`.
 */
export function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    direction: row.direction,
    messageType: row.message_type,
    textBody: row.text_body,
    deliveryStatus: row.delivery_status,
    sentAt: row.sent_at,
  };
}
