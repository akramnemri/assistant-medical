"use client";

/**
 * A message timestamp, formatted in the reader's own timezone.
 *
 * Client component on purpose. Formatting on the server would use the server's
 * timezone, so a doctor in Tunis reading a server in Virginia would see every
 * message shifted by hours — wrong in a way that looks plausible, which is the
 * worst kind of wrong for a medical record.
 *
 * `suppressHydrationWarning` is the documented escape hatch for exactly this:
 * the server render and the client render legitimately differ, because only the
 * browser knows the reader's timezone.
 */
export function ConversationTimestamp({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return null;

  return (
    <time
      dateTime={value}
      title={date.toLocaleString()}
      className={className}
      suppressHydrationWarning
    >
      {formatInboxTimestamp(date)}
    </time>
  );
}

/**
 * Inbox-style relative formatting: the time for today, a weekday within the
 * last week, a date beyond that.
 *
 * Deliberately not "2 minutes ago" — that goes stale the moment it renders and
 * would need a ticking timer on every row to stay honest.
 */
function formatInboxTimestamp(date: Date): string {
  const now = new Date();
  const isSameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (isSameDay) {
    return date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  const daysAgo = (now.getTime() - date.getTime()) / 86_400_000;

  if (daysAgo < 7 && daysAgo >= 0) {
    return date.toLocaleDateString(undefined, { weekday: "short" });
  }

  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    // Only show the year when it is not the current one; "19 Sep 2026" on every
    // row is noise for a list that is mostly recent.
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}
