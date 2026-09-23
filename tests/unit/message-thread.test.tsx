import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MessageThread } from "@/features/conversations/components/message-thread";
import type { Message } from "@/server/services/conversations";

/**
 * The server action is mocked: it is a network boundary, and what is worth
 * testing here is how the thread merges and renders what comes back. The
 * action's own authorization is covered where it lives.
 */
const loadOlder = vi.hoisted(() => vi.fn());

vi.mock("@/features/conversations/actions", () => ({
  loadOlderMessagesAction: loadOlder,
}));

/**
 * Realtime is mocked too. It opens a websocket and needs Supabase
 * configuration, neither of which this file is testing — what matters here is
 * how the thread merges and renders messages. Delivery itself is covered by an
 * integration test against the real stack.
 */
vi.mock("@/features/conversations/use-realtime-messages", () => ({
  useRealtimeMessages: () => undefined,
}));

function messageOf(id: string, overrides: Partial<Message> = {}): Message {
  return {
    id,
    direction: "inbound",
    messageType: "text",
    textBody: `message ${id}`,
    deliveryStatus: null,
    sentAt: "2026-09-19T10:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  loadOlder.mockReset();
});

describe("MessageThread", () => {
  it("renders messages in reading order, oldest at the top", () => {
    render(
      <MessageThread
        conversationId="c1"
        initialMessages={[
          messageOf("a", { sentAt: "2026-09-19T10:00:00.000Z" }),
          messageOf("b", { sentAt: "2026-09-19T11:00:00.000Z" }),
        ]}
        initialCursor={null}
      />,
    );

    const items = screen.getAllByRole("listitem");
    expect(within(items[0]!).getByText("message a")).toBeInTheDocument();
    expect(within(items[1]!).getByText("message b")).toBeInTheDocument();
  });

  // Colour and alignment alone would make direction invisible to a screen
  // reader, and this is a clinical record.
  it("labels each message with its direction", () => {
    render(
      <MessageThread
        conversationId="c1"
        initialMessages={[
          messageOf("a"),
          messageOf("b", { direction: "outbound", deliveryStatus: "delivered" }),
        ]}
        initialCursor={null}
      />,
    );

    expect(screen.getByLabelText("Message from patient")).toBeInTheDocument();
    expect(screen.getByLabelText("Message you sent")).toBeInTheDocument();
    expect(screen.getByText("Delivered")).toBeInTheDocument();
  });

  it("shows the start of the conversation when there is nothing older", () => {
    render(
      <MessageThread
        conversationId="c1"
        initialMessages={[messageOf("a")]}
        initialCursor={null}
      />,
    );

    expect(screen.getByText(/beginning of the conversation/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /load older/i })).not.toBeInTheDocument();
  });

  it("loads an older page and places it above the existing messages", async () => {
    loadOlder.mockResolvedValue({
      ok: true,
      messages: [messageOf("z", { sentAt: "2026-09-19T09:00:00.000Z" })],
      nextCursor: null,
    });

    render(
      <MessageThread
        conversationId="c1"
        initialMessages={[messageOf("a")]}
        initialCursor="cursor-1"
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /load older/i }));

    await waitFor(() => {
      expect(screen.getByText("message z")).toBeInTheDocument();
    });

    const items = screen.getAllByRole("listitem");
    expect(within(items[0]!).getByText("message z")).toBeInTheDocument();
    expect(loadOlder).toHaveBeenCalledWith("c1", "cursor-1");
  });

  /**
   * A retried or overlapping page must not render a patient's message twice —
   * in a medical record that reads as them having said it twice.
   */
  it("does not render a message twice when a page overlaps", async () => {
    loadOlder.mockResolvedValue({
      ok: true,
      messages: [messageOf("a"), messageOf("z", { sentAt: "2026-09-19T09:00:00.000Z" })],
      nextCursor: null,
    });

    render(
      <MessageThread
        conversationId="c1"
        initialMessages={[messageOf("a")]}
        initialCursor="cursor-1"
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /load older/i }));

    await waitFor(() => {
      expect(screen.getByText("message z")).toBeInTheDocument();
    });

    expect(screen.getAllByText("message a")).toHaveLength(1);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("hides the load button once the thread is exhausted", async () => {
    loadOlder.mockResolvedValue({
      ok: true,
      messages: [messageOf("z", { sentAt: "2026-09-19T09:00:00.000Z" })],
      nextCursor: null,
    });

    render(
      <MessageThread
        conversationId="c1"
        initialMessages={[messageOf("a")]}
        initialCursor="cursor-1"
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /load older/i }));

    await waitFor(() => {
      expect(screen.getByText(/beginning of the conversation/i)).toBeInTheDocument();
    });
  });

  it("keeps the button when more pages remain, using the new cursor", async () => {
    loadOlder.mockResolvedValue({
      ok: true,
      messages: [messageOf("z", { sentAt: "2026-09-19T09:00:00.000Z" })],
      nextCursor: "cursor-2",
    });

    render(
      <MessageThread
        conversationId="c1"
        initialMessages={[messageOf("a")]}
        initialCursor="cursor-1"
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /load older/i }));
    await waitFor(() => expect(screen.getByText("message z")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /load older/i }));
    expect(loadOlder).toHaveBeenLastCalledWith("c1", "cursor-2");
  });

  it("surfaces a failure without losing the messages already shown", async () => {
    loadOlder.mockResolvedValue({
      ok: false,
      error: "Older messages could not be loaded.",
    });

    render(
      <MessageThread
        conversationId="c1"
        initialMessages={[messageOf("a")]}
        initialCursor="cursor-1"
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /load older/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/could not be loaded/i);
    });

    expect(screen.getByText("message a")).toBeInTheDocument();
    // `findBy` rather than `getBy`: the button reads "Loading..." until the
    // transition settles, so asserting immediately races the pending state.
    expect(
      await screen.findByRole("button", { name: /load older/i }),
    ).toBeInTheDocument();
  });

  it("shows an empty state rather than a blank panel", () => {
    render(
      <MessageThread conversationId="c1" initialMessages={[]} initialCursor={null} />,
    );

    expect(screen.getByText(/no messages yet/i)).toBeInTheDocument();
  });

  // A thread spanning weeks is unreadable without separators.
  it("separates messages from different days", () => {
    render(
      <MessageThread
        conversationId="c1"
        initialMessages={[
          messageOf("a", { sentAt: "2026-09-18T10:00:00.000Z" }),
          messageOf("b", { sentAt: "2026-09-19T10:00:00.000Z" }),
        ]}
        initialCursor={null}
      />,
    );

    // Two day groups means two <section> wrappers around the message lists.
    expect(screen.getAllByRole("list")).toHaveLength(2);
  });

  // Patient messages are untrusted input.
  it("renders message text as text, never as markup", () => {
    render(
      <MessageThread
        conversationId="c1"
        initialMessages={[messageOf("a", { textBody: '<img src=x onerror="alert(1)">' })]}
        initialCursor={null}
      />,
    );

    expect(screen.getByText('<img src=x onerror="alert(1)">')).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });

  it("describes a message that carries no text", () => {
    render(
      <MessageThread
        conversationId="c1"
        initialMessages={[messageOf("a", { textBody: null, messageType: "unsupported" })]}
        initialCursor={null}
      />,
    );

    expect(screen.getByText(/not supported yet/i)).toBeInTheDocument();
  });
});
