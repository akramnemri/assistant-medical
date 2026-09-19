import type { Metadata } from "next";
import { Suspense } from "react";
import {
  ConversationList,
  ConversationListSkeleton,
} from "@/features/conversations/components/conversation-list";
import { getRequestContext } from "@/server/request-context";
import { listConversations } from "@/server/services/conversations";

export const metadata: Metadata = { title: "Conversations" };

export default function ConversationsPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col md:h-dvh">
      <header className="border-border shrink-0 border-b px-4 py-4">
        <h1 className="text-xl font-semibold">Conversations</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Patient messages from your connected WhatsApp number.
        </p>
      </header>

      {/* Suspense so the page shell paints immediately and the list streams in.
          Without it the whole route waits on the query.

          The viewport height and internal scrolling apply from `md` up only: on
          a phone the sidebar stacks above this, so forcing a full-viewport
          child would push the page taller than the screen. */}
      <div className="min-h-0 flex-1 md:overflow-y-auto">
        <Suspense fallback={<ConversationListSkeleton />}>
          <ConversationListLoader />
        </Suspense>
      </div>
    </div>
  );
}

/**
 * Separated from the page so only this part suspends.
 *
 * The workspace comes from the session, never from the request, so there is no
 * client-supplied identifier to authorize here.
 */
async function ConversationListLoader() {
  const { supabase, workspace } = await getRequestContext();
  const conversations = await listConversations(supabase, workspace.id);

  return <ConversationList conversations={conversations} />;
}
