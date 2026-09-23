import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/config/server-env";

/**
 * Meta's webhook verification handshake, as a pure decision.
 *
 * Kept out of the route handler so the security-relevant part — "may this
 * caller attach a webhook to our endpoint?" — can be tested directly, without
 * constructing HTTP requests, and so the route is left with nothing but
 * translating the decision into a response.
 *
 * Verified against Meta's documentation in Task 5.1; see the Webhooks section
 * of `docs/integrations/whatsapp.md`. Not yet exercised by a real Meta app.
 */

/** Meta always sends this value; anything else is not the handshake. */
const SUBSCRIBE_MODE = "subscribe";

/**
 * Why a handshake was refused. Logged and used to pick a status code, never
 * returned to the caller — telling an unauthenticated caller *which* part of
 * their guess was wrong is free help for whoever is probing the endpoint.
 */
export type WebhookVerificationRejection =
  /** No `META_WEBHOOK_VERIFY_TOKEN` configured, so nothing can be verified. */
  | "not_configured"
  /** One or more `hub.*` parameters absent — most likely not Meta at all. */
  | "missing_parameters"
  /** `hub.mode` was present but was not `subscribe`. */
  | "unsupported_mode"
  /** Well-formed handshake, wrong token. */
  | "invalid_token";

export type WebhookVerificationResult =
  | { readonly outcome: "verified"; readonly challenge: string }
  | { readonly outcome: "rejected"; readonly reason: WebhookVerificationRejection };

/**
 * Constant-time string comparison.
 *
 * `timingSafeEqual` requires equal-length buffers and throws otherwise, which
 * would itself leak the expected length. Hashing first gives two 32-byte
 * digests to compare; the explicit length check then rules out the (already
 * negligible) collision case without reintroducing a timing signal, because it
 * runs after the comparison rather than short-circuiting it.
 */
function secretsMatch(provided: string, expected: string): boolean {
  const providedDigest = createHash("sha256").update(provided, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();

  const digestsMatch = timingSafeEqual(providedDigest, expectedDigest);
  return digestsMatch && provided.length === expected.length;
}

/**
 * Decides whether a `GET` on the webhook endpoint is Meta completing the
 * subscription handshake.
 *
 * The token is checked **before** the challenge is returned. Echoing
 * `hub.challenge` unconditionally — which is what most tutorial snippets do —
 * lets anyone point their own Meta app at our endpoint and have it accepted.
 *
 * @param searchParams The request's query string.
 */
export function verifyWebhookSubscription(
  searchParams: URLSearchParams,
): WebhookVerificationResult {
  const expectedToken = serverEnv().META_WEBHOOK_VERIFY_TOKEN;

  // Fail closed. Without a configured token every token is equally wrong, and
  // an endpoint that verifies nothing is worse than one that is unavailable.
  if (expectedToken === undefined) {
    return { outcome: "rejected", reason: "not_configured" };
  }

  const mode = searchParams.get("hub.mode");
  const providedToken = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === null || providedToken === null || challenge === null) {
    return { outcome: "rejected", reason: "missing_parameters" };
  }

  if (mode !== SUBSCRIBE_MODE) {
    return { outcome: "rejected", reason: "unsupported_mode" };
  }

  if (!secretsMatch(providedToken, expectedToken)) {
    return { outcome: "rejected", reason: "invalid_token" };
  }

  return { outcome: "verified", challenge };
}
