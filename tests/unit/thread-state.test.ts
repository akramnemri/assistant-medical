import { describe, expect, it } from "vitest";
import {
  appendNewerMessages,
  groupByDay,
  prependOlderMessages,
  toChronological,
} from "@/features/conversations/thread-state";
import type { Message } from "@/server/services/conversations";

function messageOf(id: string, sentAt: string): Message {
  return {
    id,
    direction: "inbound",
    messageType: "text",
    textBody: `message ${id}`,
    deliveryStatus: null,
    sentAt,
  };
}

/** As the service returns them: newest first. */
const NEWEST_FIRST = [
  messageOf("c", "2026-09-19T12:00:00.000Z"),
  messageOf("b", "2026-09-19T11:00:00.000Z"),
  messageOf("a", "2026-09-19T10:00:00.000Z"),
];

describe("toChronological", () => {
  // The service pages newest-first; a thread reads oldest-first. Getting this
  // backwards silently inverts every conversation in the app.
  it("reverses a newest-first page into reading order", () => {
    expect(toChronological(NEWEST_FIRST).map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("does not mutate its input", () => {
    const input = [...NEWEST_FIRST];
    toChronological(input);

    expect(input.map((m) => m.id)).toEqual(["c", "b", "a"]);
  });

  it("handles an empty page", () => {
    expect(toChronological([])).toEqual([]);
  });
});

describe("prependOlderMessages", () => {
  it("puts an older page before what is already shown, in reading order", () => {
    const existing = toChronological(NEWEST_FIRST);
    const older = [
      messageOf("z", "2026-09-19T09:00:00.000Z"),
      messageOf("y", "2026-09-19T08:00:00.000Z"),
    ];

    expect(prependOlderMessages(existing, older).map((m) => m.id)).toEqual([
      "y",
      "z",
      "a",
      "b",
      "c",
    ]);
  });

  /**
   * The assertion that matters. A message arriving between two page requests
   * shifts the window, and a retried request can return rows the client already
   * has. Rendered twice, a patient appears to have said the same thing twice.
   */
  it("drops messages already present", () => {
    const existing = toChronological(NEWEST_FIRST);
    const overlapping = [
      messageOf("b", "2026-09-19T11:00:00.000Z"),
      messageOf("a", "2026-09-19T10:00:00.000Z"),
      messageOf("z", "2026-09-19T09:00:00.000Z"),
    ];

    const merged = prependOlderMessages(existing, overlapping);

    expect(merged.map((m) => m.id)).toEqual(["z", "a", "b", "c"]);
    expect(new Set(merged.map((m) => m.id)).size).toBe(merged.length);
  });

  it("is a no-op when the whole page is already shown", () => {
    const existing = toChronological(NEWEST_FIRST);

    expect(prependOlderMessages(existing, NEWEST_FIRST)).toEqual(existing);
  });

  it("handles an empty older page", () => {
    const existing = toChronological(NEWEST_FIRST);

    expect(prependOlderMessages(existing, [])).toEqual(existing);
  });

  // Walking the whole thread in small pages must never duplicate or lose a row.
  it("stays duplicate-free across repeated merges", () => {
    const pages = [
      [
        messageOf("f", "2026-09-19T06:00:00.000Z"),
        messageOf("e", "2026-09-19T05:00:00.000Z"),
      ],
      [
        messageOf("e", "2026-09-19T05:00:00.000Z"),
        messageOf("d", "2026-09-19T04:00:00.000Z"),
      ],
      [messageOf("d", "2026-09-19T04:00:00.000Z")],
    ];

    let thread = toChronological(NEWEST_FIRST);
    for (const page of pages) thread = prependOlderMessages(thread, page);

    expect(thread.map((m) => m.id)).toEqual(["d", "e", "f", "a", "b", "c"]);
  });
});

describe("appendNewerMessages", () => {
  it("adds newer messages at the end", () => {
    const existing = toChronological(NEWEST_FIRST);
    const arriving = [messageOf("d", "2026-09-19T13:00:00.000Z")];

    expect(appendNewerMessages(existing, arriving).map((m) => m.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  // Realtime can deliver a message the initial render already included.
  it("ignores a message already in the thread", () => {
    const existing = toChronological(NEWEST_FIRST);

    expect(
      appendNewerMessages(existing, [messageOf("c", "2026-09-19T12:00:00.000Z")]),
    ).toEqual(existing);
  });
});

describe("groupByDay", () => {
  it("groups consecutive messages from the same day", () => {
    const groups = groupByDay([
      messageOf("a", "2026-09-18T10:00:00.000Z"),
      messageOf("b", "2026-09-18T18:00:00.000Z"),
      messageOf("c", "2026-09-19T09:00:00.000Z"),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.dayKey).toBe("2026-09-18");
    expect(groups[0]?.messages.map((m) => m.id)).toEqual(["a", "b"]);
    expect(groups[1]?.messages.map((m) => m.id)).toEqual(["c"]);
  });

  it("preserves order within a group", () => {
    const groups = groupByDay([
      messageOf("a", "2026-09-19T08:00:00.000Z"),
      messageOf("b", "2026-09-19T09:00:00.000Z"),
    ]);

    expect(groups[0]?.messages.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("returns nothing for an empty thread", () => {
    expect(groupByDay([])).toEqual([]);
  });
});
