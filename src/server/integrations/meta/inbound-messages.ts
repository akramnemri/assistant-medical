import { z } from "zod";
import type { WebhookPayload } from "@/server/integrations/meta/webhook-payload";

/**
 * Meta's payload turned into this application's terms.
 *
 * This is the boundary. Everything above it deals in `NormalizedInboundMessage`
 * and never learns that Meta calls a message id a `wamid`, sends timestamps as
 * seconds-since-epoch in a *string*, or nests the sender's name three levels
 * deep in a parallel `contacts` array.
 *
 * The governing constraint is that a delivery may contain up to 1000 updates
 * and Meta will not send them again. One unrecognised message among them must
 * not cost us the other 999, so nothing here throws: anything unreadable is
 * reported as skipped and the rest of the batch proceeds.
 */

/** Our `message_type` enum, and what Meta's `type` maps onto. */
const SUPPORTED_TYPES = [
  "text",
  "image",
  "audio",
  "video",
  "document",
  "sticker",
  "location",
  "contacts",
] as const;

type SupportedType = (typeof SUPPORTED_TYPES)[number];

/** Anything Meta sends that we have no column for. Recorded, not dropped. */
const UNSUPPORTED = "unsupported" as const;

export type NormalizedMessageType = SupportedType | typeof UNSUPPORTED;

export type NormalizedInboundMessage = {
  /** Meta's `wamid`. The idempotency key for the whole pipeline. */
  readonly providerMessageId: string;
  /** The patient's WhatsApp id: E.164 without the leading '+'. */
  readonly waId: string;
  /** The name from the patient's own WhatsApp profile, when Meta includes it. */
  readonly profileName: string | null;
  readonly messageType: NormalizedMessageType;
  /** Null for message types that carry no text. Patient content — never logged. */
  readonly textBody: string | null;
  readonly sentAt: string;
};

export type SkippedInboundMessage = {
  readonly reason: "unreadable_shape" | "unusable_timestamp";
  /** Present whenever we got far enough to read one. Not patient content. */
  readonly providerMessageId: string | null;
};

export type NormalizedDelivery = {
  readonly phoneNumberId: string | null;
  readonly messages: readonly NormalizedInboundMessage[];
  readonly skipped: readonly SkippedInboundMessage[];
  /** Change entries that are not inbound messages — status updates and the like. */
  readonly ignoredFields: readonly string[];
};

/**
 * Only the fields we actually read. Everything else in a message object is
 * left alone: `.loose()` means a new Meta field cannot fail the parse.
 */
const inboundMessageSchema = z
  .object({
    id: z.string().min(1).max(256),
    from: z.string().min(1).max(32),
    timestamp: z.string().min(1),
    type: z.string().min(1),
    text: z.object({ body: z.string() }).loose().optional(),
    // A caption is the nearest thing to text a media message has, and losing it
    // would leave a doctor with an attachment and no idea what was asked.
    image: z.object({ caption: z.string().optional() }).loose().optional(),
    video: z.object({ caption: z.string().optional() }).loose().optional(),
    document: z
      .object({ caption: z.string().optional(), filename: z.string().optional() })
      .loose()
      .optional(),
  })
  .loose();

const contactSchema = z
  .object({
    wa_id: z.string().min(1).max(32),
    profile: z.object({ name: z.string().optional() }).loose().optional(),
  })
  .loose();

/** Meta sends seconds since the epoch, as a string. */
const MIN_TIMESTAMP_SECONDS = 0;
const MAX_TIMESTAMP_SECONDS = 4_102_444_800; // 2100-01-01, a sanity ceiling.

function parseTimestamp(value: string): string | null {
  const seconds = Number(value);

  if (
    !Number.isFinite(seconds) ||
    !Number.isInteger(seconds) ||
    seconds < MIN_TIMESTAMP_SECONDS ||
    seconds > MAX_TIMESTAMP_SECONDS
  ) {
    return null;
  }

  return new Date(seconds * 1000).toISOString();
}

function normalizeType(type: string): NormalizedMessageType {
  return SUPPORTED_TYPES.includes(type as SupportedType)
    ? (type as SupportedType)
    : UNSUPPORTED;
}

/**
 * The text worth storing for a message.
 *
 * A media message has no body but often has a caption, which is what the
 * patient actually wrote. An unsupported type gets null rather than a guess —
 * inventing a body for a message shape we do not understand would put words in
 * a patient's mouth.
 */
function extractText(
  message: z.infer<typeof inboundMessageSchema>,
  messageType: NormalizedMessageType,
): string | null {
  if (messageType === "text") return message.text?.body ?? null;
  if (messageType === "image") return message.image?.caption ?? null;
  if (messageType === "video") return message.video?.caption ?? null;
  if (messageType === "document") return message.document?.caption ?? null;

  return null;
}

/**
 * Normalises one stored delivery.
 *
 * @param payload A payload that has already passed `parseWebhookPayload`.
 */
export function normalizeInboundDelivery(payload: WebhookPayload): NormalizedDelivery {
  const messages: NormalizedInboundMessage[] = [];
  const skipped: SkippedInboundMessage[] = [];
  const ignoredFields: string[] = [];
  let phoneNumberId: string | null = null;

  for (const entry of payload.entry) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (value === undefined) continue;

      phoneNumberId ??= value.metadata?.phone_number_id ?? null;

      // Delivery receipts, read receipts, account updates, template approvals.
      // Expected traffic, deliberately not acted on until there is a feature
      // that needs them.
      if (change.field !== "messages" || !Array.isArray(value.messages)) {
        ignoredFields.push(change.field);
        continue;
      }

      // Names arrive in a sibling array keyed by wa_id, not on the message.
      const profileNames = profileNamesByWaId(value.contacts);

      for (const raw of value.messages) {
        const parsed = inboundMessageSchema.safeParse(raw);

        if (!parsed.success) {
          skipped.push({
            reason: "unreadable_shape",
            providerMessageId: readIdLoosely(raw),
          });
          continue;
        }

        const sentAt = parseTimestamp(parsed.data.timestamp);

        if (sentAt === null) {
          // `sent_at` is not nullable and it is what orders a thread. A message
          // stored at the wrong time is worse than one held back for replay.
          skipped.push({
            reason: "unusable_timestamp",
            providerMessageId: parsed.data.id,
          });
          continue;
        }

        const messageType = normalizeType(parsed.data.type);

        messages.push({
          providerMessageId: parsed.data.id,
          waId: parsed.data.from,
          profileName: profileNames.get(parsed.data.from) ?? null,
          messageType,
          textBody: extractText(parsed.data, messageType),
          sentAt,
        });
      }
    }
  }

  return { phoneNumberId, messages, skipped, ignoredFields };
}

function profileNamesByWaId(contacts: unknown): Map<string, string> {
  const names = new Map<string, string>();
  if (!Array.isArray(contacts)) return names;

  for (const raw of contacts) {
    const parsed = contactSchema.safeParse(raw);
    const name = parsed.success ? parsed.data.profile?.name : undefined;

    if (parsed.success && name !== undefined && name.length > 0) {
      names.set(parsed.data.wa_id, name);
    }
  }

  return names;
}

/**
 * Best-effort id for a message we could not parse, so the skip is traceable
 * without logging the message itself.
 */
function readIdLoosely(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) return null;

  const id = (raw as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}
