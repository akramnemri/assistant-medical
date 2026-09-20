import { z } from "zod";

/**
 * Runtime shape of a WhatsApp webhook delivery.
 *
 * Deliberately permissive about everything the receiver does not need. Meta
 * adds fields and event types without warning, and a schema that rejected
 * anything unfamiliar would turn every such addition into a rejected delivery
 * — which costs 36 hours of retries and, since historical webhook data cannot
 * be queried later, real patient messages.
 *
 * So: validate only what routing depends on, keep the rest of the payload
 * intact for storage, and let Task 6.3 interpret it.
 */

/** Meta sends this for WhatsApp; anything else is a subscription we did not ask for. */
export const WHATSAPP_OBJECT = "whatsapp_business_account";

/**
 * The part the receiver genuinely needs: which of our numbers this delivery is
 * about. Everything else is passed through untouched.
 */
const metadataSchema = z.object({
  phone_number_id: z.string().min(1).max(64),
  display_phone_number: z.string().optional(),
});

const changeSchema = z.object({
  field: z.string(),
  // `.loose()` keeps unknown keys instead of stripping them. The stored payload
  // must be what Meta sent, not what this version of the schema understood.
  value: z.object({ metadata: metadataSchema.optional() }).loose().optional(),
});

const entrySchema = z.object({
  id: z.string().optional(),
  changes: z.array(changeSchema).optional(),
});

export const webhookPayloadSchema = z.object({
  object: z.string(),
  entry: z.array(entrySchema),
});

export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;

export type ParsedWebhookPayload =
  | { readonly outcome: "parsed"; readonly payload: WebhookPayload }
  | { readonly outcome: "rejected"; readonly reason: "invalid_json" | "invalid_shape" };

/**
 * Parses a delivery body that has **already had its signature verified**.
 *
 * Order matters: parsing unauthenticated input is how a malformed-payload bug
 * becomes reachable by anyone. The signature check comes first, always.
 */
export function parseWebhookPayload(rawBody: string): ParsedWebhookPayload {
  let json: unknown;

  try {
    json = JSON.parse(rawBody);
  } catch {
    // Not rethrown: a body we cannot parse is an expected kind of bad input,
    // not a fault of ours, and the caller answers 200 to it regardless.
    return { outcome: "rejected", reason: "invalid_json" };
  }

  const parsed = webhookPayloadSchema.safeParse(json);
  if (!parsed.success) {
    return { outcome: "rejected", reason: "invalid_shape" };
  }

  return { outcome: "parsed", payload: parsed.data };
}

/**
 * The business phone number ids a delivery concerns.
 *
 * Meta batches up to 1000 updates per delivery and the batch can in principle
 * span numbers, so this returns all of them rather than assuming one. Returned
 * in first-seen order, without duplicates.
 */
export function phoneNumberIdsInPayload(payload: WebhookPayload): readonly string[] {
  const ids = new Set<string>();

  for (const entry of payload.entry) {
    for (const change of entry.changes ?? []) {
      const phoneNumberId = change.value?.metadata?.phone_number_id;
      if (phoneNumberId !== undefined) ids.add(phoneNumberId);
    }
  }

  return [...ids];
}
