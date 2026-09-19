"use client";

import { useCallback, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { MessageBubble } from "@/features/conversations/components/message-bubble";
import { loadOlderMessagesAction } from "@/features/conversations/actions";
import {
  appendNewerMessages,
  groupByDay,
  prependOlderMessages,
} from "@/features/conversations/thread-state";
import {
  useRealtimeMessages,
  type RealtimeStatus,
} from "@/features/conversations/use-realtime-messages";
import type { Message } from "@/server/services/conversations";

/**
 * A message thread with backwards pagination.
 *
 * Client component because it accumulates pages as the reader loads history.
 * The first page is rendered on the server and handed in, so the thread is
 * readable before any JavaScript runs.
 *
 * New messages arrive over Realtime and append themselves, so a doctor sees a
 * patient's message without refreshing. They are merged rather than pushed: the
 * initial server render may already contain a message that also arrives as an
 * event, and rendering it twice would read as the patient sending it twice.
 *
 * Older messages load on an explicit button rather than a scroll observer:
 * scroll-triggered loading fights the browser's scroll anchoring and jumps the
 * reader's position mid-sentence. A button is predictable, and it is also the
 * accessible option — an infinite scroll with no control is a trap for keyboard
 * and screen-reader users.
 */
export function MessageThread({
  conversationId,
  initialMessages,
  initialCursor,
}: {
  conversationId: string;
  /** Oldest-first, as the thread reads. */
  initialMessages: Message[];
  initialCursor: string | null;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [cursor, setCursor] = useState(initialCursor);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>("connecting");

  const handleIncoming = useCallback((message: Message) => {
    setMessages((current) => appendNewerMessages(current, [message]));
  }, []);

  useRealtimeMessages(conversationId, handleIncoming, setRealtimeStatus);

  function loadOlder() {
    if (cursor === null || isPending) return;

    setError(null);

    startTransition(async () => {
      const result = await loadOlderMessagesAction(conversationId, cursor);

      if (!result.ok) {
        setError(result.error);
        return;
      }

      // Merged rather than concatenated: a message arriving between two
      // requests shifts the window, and a retry can return rows already shown.
      setMessages((current) => prependOlderMessages(current, result.messages));
      setCursor(result.nextCursor);
    });
  }

  if (messages.length === 0) return <EmptyThread />;

  const groups = groupByDay(messages);

  return (
    <div className="flex flex-col gap-4 px-4 py-4" data-realtime-status={realtimeStatus}>
      {/* A silently dead subscription looks identical to a quiet patient, so
          the disconnected state is stated rather than left to be inferred. */}
      {realtimeStatus === "error" ? (
        <p className="text-muted-foreground text-center text-xs">
          Live updates are unavailable. Reload to see new messages.
        </p>
      ) : null}

      {cursor === null ? (
        <p className="text-muted-foreground text-center text-xs">
          Beginning of the conversation
        </p>
      ) : (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={loadOlder}
            disabled={isPending}
            aria-busy={isPending}
          >
            {isPending ? "Loading..." : "Load older messages"}
          </Button>
        </div>
      )}

      {error === null ? null : (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {groups.map((group) => (
        <section key={group.dayKey} className="flex flex-col gap-2">
          <DaySeparator dayKey={group.dayKey} />

          <ul className="flex flex-col gap-2">
            {group.messages.map((message) => (
              // Keyed by message id, so React reuses rows instead of
              // re-creating them when an older page is prepended.
              <MessageBubble key={message.id} message={message} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function DaySeparator({ dayKey }: { dayKey: string }) {
  const date = new Date(`${dayKey}T00:00:00Z`);

  return (
    <div className="flex items-center gap-3">
      <div className="bg-border h-px flex-1" />
      <span className="text-muted-foreground text-xs" suppressHydrationWarning>
        {Number.isNaN(date.getTime())
          ? dayKey
          : date.toLocaleDateString(undefined, {
              day: "numeric",
              month: "short",
              year:
                date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
              timeZone: "UTC",
            })}
      </span>
      <div className="bg-border h-px flex-1" />
    </div>
  );
}

function EmptyThread() {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
      <p className="text-sm font-medium">No messages yet</p>
      <p className="text-muted-foreground max-w-sm text-sm">
        Messages from this patient will appear here.
      </p>
    </div>
  );
}
