import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { MessageThread } from "@/features/conversations/components/message-thread";
import { toChronological } from "@/features/conversations/thread-state";
import { getRequestContext } from "@/server/request-context";
import { getConversation, listMessages } from "@/server/services/conversations";
import { isAppError } from "@/lib/errors/app-error";

export const metadata: Metadata = { title: "Conversation" };

export default async function ConversationThreadPage({
  params,
}: PageProps<"/conversations/[conversationId]">) {
  const { conversationId } = await params;
  const { supabase, workspace } = await getRequestContext();

  // The id comes from the URL, so it is a claim. `getConversation` filters by
  // the workspace derived from the session, so another tenant's conversation
  // resolves to NOT_FOUND rather than being rendered.
  const conversation = await getConversation(
    supabase,
    workspace.id,
    conversationId,
  ).catch((error: unknown) => {
    // A missing or foreign conversation is an ordinary 404, not an error page.
    // Anything else is a real fault and belongs to the error boundary.
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  });

  const page = await listMessages(supabase, conversationId);

  return (
    <div className="mx-auto flex max-w-3xl flex-col md:h-dvh">
      <header className="border-border flex shrink-0 items-center gap-3 border-b px-4 py-3">
        <Link
          href="/conversations"
          aria-label="Back to conversations"
          className="hover:bg-muted rounded-md p-1.5 transition-colors"
        >
          <ArrowLeft className="size-4" aria-hidden />
        </Link>

        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold">
            {conversation.contactName ?? `+${conversation.contactWaId}`}
          </h1>
          <p className="text-muted-foreground truncate text-xs">
            +{conversation.contactWaId}
          </p>
        </div>
      </header>

      <div className="min-h-0 flex-1 md:overflow-y-auto">
        <MessageThread
          conversationId={conversationId}
          // The service pages newest-first; a thread reads oldest-first.
          initialMessages={toChronological(page.messages)}
          initialCursor={page.nextCursor}
        />
      </div>
    </div>
  );
}
