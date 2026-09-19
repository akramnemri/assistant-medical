import Link from "next/link";
import { MessagesSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConversationTimestamp } from "@/features/conversations/components/conversation-timestamp";
import type { ConversationSummary } from "@/server/services/conversations";

/**
 * The inbox: every conversation in a workspace, most recent activity first.
 *
 * Presentation only. It renders whatever it is given, which is what lets each
 * state be tested without a database.
 */
export function ConversationList({
  conversations,
}: {
  conversations: readonly ConversationSummary[];
}) {
  if (conversations.length === 0) return <EmptyState />;

  return (
    <ul className="divide-border divide-y" aria-label="Conversations">
      {conversations.map((conversation) => (
        <li key={conversation.id}>
          <ConversationRow conversation={conversation} />
        </li>
      ))}
    </ul>
  );
}

function ConversationRow({ conversation }: { conversation: ConversationSummary }) {
  const hasUnread = conversation.unreadCount > 0;

  return (
    <Link
      href={`/conversations/${conversation.id}`}
      className="hover:bg-muted/50 focus-visible:ring-ring flex items-start gap-3 px-4 py-3 transition-colors focus-visible:ring-2 focus-visible:outline-none"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p
            className={cn(
              "truncate text-sm",
              hasUnread ? "font-semibold" : "font-medium",
            )}
          >
            <ContactName conversation={conversation} />
          </p>

          {conversation.lastMessageAt === null ? null : (
            <ConversationTimestamp
              value={conversation.lastMessageAt}
              className="text-muted-foreground shrink-0 text-xs"
            />
          )}
        </div>

        <div className="mt-1 flex items-center justify-between gap-3">
          <p
            className={cn(
              "truncate text-sm",
              hasUnread ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <MessagePreview conversation={conversation} />
          </p>

          {hasUnread ? (
            <span
              className="bg-primary text-primary-foreground shrink-0 rounded-full px-2 py-0.5 text-xs font-medium"
              aria-label={`${conversation.unreadCount} unread messages`}
            >
              {conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

/**
 * Patients set their own WhatsApp profile name, so it is untrusted input. React
 * escapes it on render; the phone number is the fallback and the identity that
 * actually matters clinically.
 */
function ContactName({ conversation }: { conversation: ConversationSummary }) {
  return <>{conversation.contactName ?? `+${conversation.contactWaId}`}</>;
}

/**
 * The newest message, or a description of it when it has no text.
 *
 * A media or unsupported message would otherwise render as a blank row that
 * looks like a bug.
 */
function MessagePreview({ conversation }: { conversation: ConversationSummary }) {
  const { lastMessageText, lastMessageType, lastMessageDirection } = conversation;

  if (lastMessageText !== null && lastMessageText.trim() !== "") {
    return (
      <>
        {lastMessageDirection === "outbound" ? (
          <span className="text-muted-foreground">You: </span>
        ) : null}
        {lastMessageText}
      </>
    );
  }

  if (lastMessageType === null) return <span>No messages yet</span>;

  const label: Record<string, string> = {
    image: "Photo",
    audio: "Voice message",
    video: "Video",
    document: "Document",
    sticker: "Sticker",
    location: "Location",
    contacts: "Contact card",
    unsupported: "Unsupported message",
    text: "Message",
  };

  return <span className="italic">{label[lastMessageType] ?? "Message"}</span>;
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <MessagesSquare className="text-muted-foreground size-8" aria-hidden />
      <p className="text-sm font-medium">No conversations yet</p>
      <p className="text-muted-foreground max-w-sm text-sm">
        When a patient messages your connected WhatsApp number, their conversation appears
        here.
      </p>
    </div>
  );
}

/** Skeleton rows, shown while the list loads. */
export function ConversationListSkeleton() {
  return (
    <ul className="divide-border divide-y" aria-label="Loading conversations">
      {Array.from({ length: 6 }, (_, index) => (
        <li key={index} className="flex flex-col gap-2 px-4 py-3">
          <div className="flex justify-between gap-3">
            <div className="bg-muted h-4 w-40 animate-pulse rounded" />
            <div className="bg-muted h-3 w-10 animate-pulse rounded" />
          </div>
          <div className="bg-muted h-3 w-3/4 animate-pulse rounded" />
        </li>
      ))}
    </ul>
  );
}
