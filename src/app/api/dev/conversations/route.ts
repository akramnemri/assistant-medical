import { toErrorResponse } from "@/lib/errors/response";
import { getRequestId, REQUEST_ID_HEADER } from "@/lib/request-id";
import { getRequestContext } from "@/server/request-context";
import {
  getConversation,
  listConversations,
  listMessages,
} from "@/server/services/conversations";

/**
 * Development-only view of the conversation data service.
 *
 * Task 4.1 builds the real conversation UI. This exists so the service —
 * ordering, keyset pagination, authorization and the not-found paths — can be
 * exercised by hand before there is a screen to click.
 *
 * Returns 404 outside development. It echoes synthetic patient content, which
 * is acceptable only because it is development-only and the local database
 * contains nothing real.
 *
 *   /api/dev/conversations                         list
 *   /api/dev/conversations?id=<uuid>               one conversation + first page
 *   /api/dev/conversations?id=<uuid>&cursor=<c>    next page
 *   /api/dev/conversations?id=<uuid>&limit=5       smaller pages
 */

const OPERATION = "dev.conversations";

export async function GET(request: Request): Promise<Response> {
  if (process.env.NODE_ENV === "production") {
    return new Response("Not found", { status: 404 });
  }

  const requestId = getRequestId(request.headers);
  const params = new URL(request.url).searchParams;

  try {
    const { supabase, workspace } = await getRequestContext();
    const conversationId = params.get("id");

    if (conversationId === null) {
      const conversations = await listConversations(supabase, workspace.id);

      return Response.json(
        { workspace: workspace.name, count: conversations.length, conversations },
        { headers: { [REQUEST_ID_HEADER]: requestId } },
      );
    }

    const limitParam = params.get("limit");
    const conversation = await getConversation(supabase, workspace.id, conversationId);

    const page = await listMessages(supabase, conversationId, {
      cursor: params.get("cursor"),
      limit: limitParam === null ? undefined : Number(limitParam),
    });

    return Response.json(
      {
        conversation,
        count: page.messages.length,
        nextCursor: page.nextCursor,
        messages: page.messages,
      },
      { headers: { [REQUEST_ID_HEADER]: requestId } },
    );
  } catch (error) {
    return toErrorResponse(error, { requestId, operation: OPERATION });
  }
}
