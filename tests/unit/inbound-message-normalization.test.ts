import { describe, expect, it } from "vitest";
import { normalizeInboundDelivery } from "@/server/integrations/meta/inbound-messages";
import { parseWebhookPayload } from "@/server/integrations/meta/webhook-payload";

/**
 * Meta's payload into our domain model (Task 6.3).
 *
 * The rule these tests exist to protect: **one bad message must not cost the
 * batch.** Meta sends up to 1000 updates per delivery and will not send them
 * again, so a normaliser that threw on the first unfamiliar shape would discard
 * every valid patient message alongside it.
 *
 * The second rule: never invent content. A message type we cannot read gets a
 * null body, not a guess — a guess would put words in a patient's mouth.
 */

const WA_ID = "21600000000";
const PHONE_NUMBER_ID = "1275386478999841";

function deliveryWith(messages: unknown[], contacts?: unknown[]) {
  const parsed = parseWebhookPayload(
    JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "2439042053289493",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  display_phone_number: "15550000000",
                  phone_number_id: PHONE_NUMBER_ID,
                },
                ...(contacts === undefined ? {} : { contacts }),
                messages,
              },
            },
          ],
        },
      ],
    }),
  );

  if (parsed.outcome !== "parsed") throw new Error("fixture is invalid");
  return normalizeInboundDelivery(parsed.payload);
}

function textMessage(overrides: Record<string, unknown> = {}) {
  return {
    from: WA_ID,
    id: "wamid.SYNTHETIC1",
    timestamp: "1758254144",
    type: "text",
    text: { body: "synthetic message content" },
    ...overrides,
  };
}

describe("normalizeInboundDelivery", () => {
  it("normalises a text message into domain terms", () => {
    const result = deliveryWith([textMessage()]);

    expect(result.phoneNumberId).toBe(PHONE_NUMBER_ID);
    expect(result.messages).toEqual([
      {
        providerMessageId: "wamid.SYNTHETIC1",
        waId: WA_ID,
        profileName: null,
        messageType: "text",
        textBody: "synthetic message content",
        sentAt: "2025-09-19T03:55:44.000Z",
      },
    ]);
  });

  // Meta sends seconds as a string; JavaScript dates are milliseconds. Getting
  // this wrong puts every message in 1970 and silently breaks thread ordering.
  it("converts Meta's seconds-as-string timestamp to an ISO instant", () => {
    const result = deliveryWith([textMessage({ timestamp: "0" })]);

    expect(result.messages[0]?.sentAt).toBe("1970-01-01T00:00:00.000Z");
  });

  it("takes the profile name from the sibling contacts array", () => {
    const result = deliveryWith(
      [textMessage()],
      [{ wa_id: WA_ID, profile: { name: "Synthetic Patient" } }],
    );

    expect(result.messages[0]?.profileName).toBe("Synthetic Patient");
  });

  it("leaves the profile name null when the contact entry is for someone else", () => {
    const result = deliveryWith(
      [textMessage()],
      [{ wa_id: "21611111111", profile: { name: "Someone Else" } }],
    );

    expect(result.messages[0]?.profileName).toBeNull();
  });

  it("keeps a media caption, which is what the patient actually wrote", () => {
    const result = deliveryWith([
      {
        from: WA_ID,
        id: "wamid.SYNTHETIC_IMAGE",
        timestamp: "1758254144",
        type: "image",
        image: { id: "media-id", mime_type: "image/jpeg", caption: "synthetic caption" },
      },
    ]);

    expect(result.messages[0]).toMatchObject({
      messageType: "image",
      textBody: "synthetic caption",
    });
  });

  it("stores a media message with no caption rather than skipping it", () => {
    const result = deliveryWith([
      {
        from: WA_ID,
        id: "wamid.SYNTHETIC_AUDIO",
        timestamp: "1758254144",
        type: "audio",
        audio: { id: "media-id", mime_type: "audio/ogg" },
      },
    ]);

    expect(result.messages[0]).toMatchObject({
      messageType: "audio",
      textBody: null,
    });
  });

  // A type we have no column for still reaches the doctor as "something
  // arrived", which is far better than silence.
  it("records an unknown message type as unsupported instead of dropping it", () => {
    const result = deliveryWith([
      {
        from: WA_ID,
        id: "wamid.SYNTHETIC_FUTURE",
        timestamp: "1758254144",
        type: "some_future_type",
        some_future_type: { data: "whatever Meta adds next" },
      },
    ]);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      messageType: "unsupported",
      textBody: null,
    });
    expect(result.skipped).toHaveLength(0);
  });

  // The headline guarantee of this module.
  it("keeps the good messages when one in the batch is unreadable", () => {
    const result = deliveryWith([
      textMessage({ id: "wamid.GOOD_ONE" }),
      { nonsense: true },
      textMessage({ id: "wamid.GOOD_TWO" }),
    ]);

    expect(result.messages.map((message) => message.providerMessageId)).toEqual([
      "wamid.GOOD_ONE",
      "wamid.GOOD_TWO",
    ]);
    expect(result.skipped).toEqual([
      { reason: "unreadable_shape", providerMessageId: null },
    ]);
  });

  it.each([["not-a-number"], ["-1"], ["99999999999"], ["1.5"]])(
    "skips a message whose timestamp %s cannot be trusted",
    (timestamp) => {
      const result = deliveryWith([textMessage({ timestamp })]);

      // sent_at is what orders a thread. A message at the wrong time is worse
      // than one held back in the payload for replay.
      expect(result.messages).toHaveLength(0);
      expect(result.skipped).toEqual([
        { reason: "unusable_timestamp", providerMessageId: "wamid.SYNTHETIC1" },
      ]);
    },
  );

  it("reports the id of an unreadable message when it can find one", () => {
    const result = deliveryWith([{ id: "wamid.BROKEN", type: "text" }]);

    expect(result.skipped).toEqual([
      { reason: "unreadable_shape", providerMessageId: "wamid.BROKEN" },
    ]);
  });

  it("normalises every message in a batch, in order", () => {
    const result = deliveryWith([
      textMessage({ id: "wamid.ONE", timestamp: "1758254144" }),
      textMessage({ id: "wamid.TWO", timestamp: "1758254145" }),
      textMessage({ id: "wamid.THREE", timestamp: "1758254146" }),
    ]);

    expect(result.messages.map((message) => message.providerMessageId)).toEqual([
      "wamid.ONE",
      "wamid.TWO",
      "wamid.THREE",
    ]);
  });

  it("ignores a status-update change without treating it as an error", () => {
    const parsed = parseWebhookPayload(
      JSON.stringify({
        object: "whatsapp_business_account",
        entry: [
          {
            id: "2439042053289493",
            changes: [
              {
                field: "messages",
                value: {
                  metadata: { phone_number_id: PHONE_NUMBER_ID },
                  statuses: [
                    {
                      id: "wamid.SYNTHETIC1",
                      status: "delivered",
                      timestamp: "1758254144",
                    },
                  ],
                },
              },
            ],
          },
        ],
      }),
    );

    if (parsed.outcome !== "parsed") throw new Error("fixture is invalid");
    const result = normalizeInboundDelivery(parsed.payload);

    expect(result.messages).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
    expect(result.ignoredFields).toEqual(["messages"]);
  });

  it("returns nothing for an empty delivery rather than failing", () => {
    const parsed = parseWebhookPayload(
      JSON.stringify({ object: "whatsapp_business_account", entry: [] }),
    );

    if (parsed.outcome !== "parsed") throw new Error("fixture is invalid");
    const result = normalizeInboundDelivery(parsed.payload);

    expect(result).toEqual({
      phoneNumberId: null,
      messages: [],
      skipped: [],
      ignoredFields: [],
    });
  });
});
