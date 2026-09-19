import type { Message } from "@/server/services/conversations";

/**
 * Ordering and merging for a message thread.
 *
 * Two different orderings are in play, deliberately:
 *
 * - The **service** returns messages newest-first, because paging backwards
 *   into history is what a cursor over `(sent_at desc, id desc)` does.
 * - The **thread** renders oldest-first, because that is how a conversation
 *   reads, with the newest message at the bottom.
 *
 * Converting between them in one place keeps the reversal from being sprinkled
 * through components, where getting it backwards would silently invert every
 * conversation.
 */

/** Newest-first (as the service returns) to oldest-first (as a thread reads). */
export function toChronological(messages: readonly Message[]): Message[] {
  return [...messages].reverse();
}

/**
 * Prepends an older page to a thread, dropping anything already shown.
 *
 * Deduplication is not paranoia. A message inserted between two page requests
 * shifts the window, and a retried request can return rows the client already
 * has. Without this, a patient's message would appear twice in their own
 * history — which in a medical context reads as them having said it twice.
 *
 * @param existing Messages already rendered, oldest-first.
 * @param older    A newer page from the service, newest-first.
 */
export function prependOlderMessages(
  existing: readonly Message[],
  older: readonly Message[],
): Message[] {
  const seen = new Set(existing.map((message) => message.id));
  const unseen = toChronological(older).filter((message) => !seen.has(message.id));

  return [...unseen, ...existing];
}

/**
 * Appends newer messages, dropping duplicates.
 *
 * Used when a message arrives while the thread is open. Realtime lands in Task
 * 4.3; the merge behaviour is defined here so both paths share one rule.
 *
 * @param newer Messages to add, oldest-first.
 */
export function appendNewerMessages(
  existing: readonly Message[],
  newer: readonly Message[],
): Message[] {
  const seen = new Set(existing.map((message) => message.id));
  const unseen = newer.filter((message) => !seen.has(message.id));

  return [...existing, ...unseen];
}

/**
 * Groups consecutive messages sent on the same day.
 *
 * A thread spanning weeks is unreadable without date separators — every
 * message looks equally recent.
 */
export type MessageGroup = {
  readonly dayKey: string;
  readonly messages: Message[];
};

export function groupByDay(messages: readonly Message[]): MessageGroup[] {
  const groups: MessageGroup[] = [];

  for (const message of messages) {
    // The date part of the ISO timestamp. Grouping on UTC rather than the
    // reader's timezone keeps the server and client renders identical; the
    // separator label itself is localised at render time.
    const dayKey = message.sentAt.slice(0, 10);
    const current = groups.at(-1);

    if (current !== undefined && current.dayKey === dayKey) {
      current.messages.push(message);
    } else {
      groups.push({ dayKey, messages: [message] });
    }
  }

  return groups;
}
