import { Check, CheckCheck, Clock, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConversationTimestamp } from "@/features/conversations/components/conversation-timestamp";
import type { Message } from "@/server/services/conversations";

/**
 * One message.
 *
 * Direction is carried by more than colour and alignment: the bubble is
 * labelled for screen readers, and outbound messages carry a delivery state.
 * Colour alone would make the thread unreadable to anyone who cannot see it.
 */
export function MessageBubble({ message }: { message: Message }) {
  const isOutbound = message.direction === "outbound";

  return (
    <li className={cn("flex w-full", isOutbound ? "justify-end" : "justify-start")}>
      <article
        aria-label={isOutbound ? "Message you sent" : "Message from patient"}
        className={cn(
          "flex max-w-[85%] flex-col gap-1 rounded-2xl px-3 py-2 sm:max-w-[70%]",
          isOutbound
            ? "bg-primary text-primary-foreground rounded-br-sm"
            : "bg-muted text-foreground rounded-bl-sm",
        )}
      >
        <MessageBody message={message} />

        <div
          className={cn(
            "flex items-center gap-1 self-end text-[0.6875rem]",
            isOutbound ? "text-primary-foreground/70" : "text-muted-foreground",
          )}
        >
          <ConversationTimestamp value={message.sentAt} />
          {isOutbound ? <DeliveryIndicator status={message.deliveryStatus} /> : null}
        </div>
      </article>
    </li>
  );
}

/**
 * The message content, or a description of it.
 *
 * Text is rendered as plain text — React escapes it, and patient messages are
 * untrusted input that must never be interpreted as markup.
 *
 * `whitespace-pre-wrap` preserves the line breaks a patient typed; collapsing
 * them would run a list of symptoms into one paragraph.
 */
function MessageBody({ message }: { message: Message }) {
  if (message.textBody !== null && message.textBody.trim() !== "") {
    return <p className="text-sm break-words whitespace-pre-wrap">{message.textBody}</p>;
  }

  const label: Record<string, string> = {
    image: "Photo",
    audio: "Voice message",
    video: "Video",
    document: "Document",
    sticker: "Sticker",
    location: "Location",
    contacts: "Contact card",
    unsupported: "This message type is not supported yet",
    text: "Empty message",
  };

  // A message with no text still occupied the patient's attention. Rendering an
  // empty bubble would read as a delivery failure.
  return (
    <p className="text-sm italic opacity-80">{label[message.messageType] ?? "Message"}</p>
  );
}

/** WhatsApp-style delivery ticks, with a text label for screen readers. */
function DeliveryIndicator({ status }: { status: Message["deliveryStatus"] }) {
  if (status === null) return null;

  const presentation = {
    pending: { Icon: Clock, label: "Sending" },
    sent: { Icon: Check, label: "Sent" },
    delivered: { Icon: CheckCheck, label: "Delivered" },
    read: { Icon: CheckCheck, label: "Read" },
    failed: { Icon: TriangleAlert, label: "Failed to send" },
  } as const;

  const { Icon, label } = presentation[status];

  return (
    <span className="inline-flex items-center" title={label}>
      <Icon className={cn("size-3.5", status === "read" && "text-sky-300")} aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}
