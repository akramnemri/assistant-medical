import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import {
  ConversationList,
  ConversationListSkeleton,
} from "@/features/conversations/components/conversation-list";
import type { ConversationSummary } from "@/server/services/conversations";

function conversationOf(
  overrides: Partial<ConversationSummary> = {},
): ConversationSummary {
  return {
    id: "55555555-5555-5555-5555-555555555555",
    contactName: "Sam Patient (synthetic)",
    contactWaId: "15550000001",
    lastMessageAt: "2026-09-19T10:00:00.000Z",
    unreadCount: 0,
    lastMessageText: "Synthetic test message",
    lastMessageDirection: "inbound",
    lastMessageType: "text",
    ...overrides,
  };
}

describe("ConversationList", () => {
  it("renders a row per conversation, linking to the thread", () => {
    render(
      <ConversationList
        conversations={[
          conversationOf(),
          conversationOf({ id: "66666666-6666-6666-6666-666666666666" }),
        ]}
      />,
    );

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByRole("link")).toHaveAttribute(
      "href",
      "/conversations/55555555-5555-5555-5555-555555555555",
    );
  });

  it("shows the empty state rather than a bare list", () => {
    render(<ConversationList conversations={[]} />);

    expect(screen.getByText(/no conversations yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("shows an unread badge only when there are unread messages", () => {
    const { rerender } = render(
      <ConversationList conversations={[conversationOf({ unreadCount: 3 })]} />,
    );

    expect(screen.getByLabelText("3 unread messages")).toHaveTextContent("3");

    rerender(<ConversationList conversations={[conversationOf({ unreadCount: 0 })]} />);
    expect(screen.queryByLabelText(/unread messages/)).not.toBeInTheDocument();
  });

  // A three-digit badge would stretch the row and push the preview off screen.
  it("caps a large unread count", () => {
    render(<ConversationList conversations={[conversationOf({ unreadCount: 250 })]} />);

    expect(screen.getByLabelText("250 unread messages")).toHaveTextContent("99+");
  });

  it("falls back to the phone number when the patient has no profile name", () => {
    render(<ConversationList conversations={[conversationOf({ contactName: null })]} />);

    expect(screen.getByText("+15550000001")).toBeInTheDocument();
  });

  it("marks an outbound preview as the doctor's own message", () => {
    render(
      <ConversationList
        conversations={[
          conversationOf({
            lastMessageDirection: "outbound",
            lastMessageText: "See you Tuesday",
          }),
        ]}
      />,
    );

    expect(screen.getByText(/you:/i)).toBeInTheDocument();
    expect(screen.getByText(/see you tuesday/i)).toBeInTheDocument();
  });

  // A media message carries no text. Without a label the row renders blank and
  // looks broken.
  it.each([
    ["image", /photo/i],
    ["audio", /voice message/i],
    ["document", /document/i],
    ["unsupported", /unsupported message/i],
  ] as const)("describes a %s message that has no text", (messageType, expected) => {
    render(
      <ConversationList
        conversations={[
          conversationOf({ lastMessageText: null, lastMessageType: messageType }),
        ]}
      />,
    );

    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("handles a conversation that has no messages at all", () => {
    render(
      <ConversationList
        conversations={[
          conversationOf({
            lastMessageText: null,
            lastMessageType: null,
            lastMessageDirection: null,
            lastMessageAt: null,
          }),
        ]}
      />,
    );

    expect(screen.getByText(/no messages yet/i)).toBeInTheDocument();
  });

  // Patients choose their own WhatsApp profile name, so it is untrusted input.
  it("escapes a profile name containing markup", () => {
    const hostile = '<img src=x onerror="alert(1)">';

    render(
      <ConversationList conversations={[conversationOf({ contactName: hostile })]} />,
    );

    expect(screen.getByText(hostile)).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });

  it("renders a timestamp carrying the full value for reference", () => {
    render(<ConversationList conversations={[conversationOf()]} />);

    const time = document.querySelector("time");
    expect(time).toHaveAttribute("dateTime", "2026-09-19T10:00:00.000Z");
  });

  it("omits the timestamp when there has been no activity", () => {
    render(
      <ConversationList conversations={[conversationOf({ lastMessageAt: null })]} />,
    );

    expect(document.querySelector("time")).toBeNull();
  });
});

describe("ConversationListSkeleton", () => {
  it("announces that the list is loading", () => {
    render(<ConversationListSkeleton />);

    expect(screen.getByLabelText("Loading conversations")).toBeInTheDocument();
  });
});
