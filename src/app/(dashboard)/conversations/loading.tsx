import { ConversationListSkeleton } from "@/features/conversations/components/conversation-list";

/** Shown during navigation to the inbox, before the server component resolves. */
export default function ConversationsLoading() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col md:h-dvh">
      <header className="border-border shrink-0 border-b px-4 py-4">
        <h1 className="text-xl font-semibold">Conversations</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Patient messages from your connected WhatsApp number.
        </p>
      </header>

      <ConversationListSkeleton />
    </div>
  );
}
