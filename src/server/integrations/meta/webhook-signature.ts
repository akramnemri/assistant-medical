import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/config/server-env";

/**
 * Authenticity of an inbound webhook delivery.
 *
 * This is the only thing standing between Meta and anyone who knows our URL.
 * The endpoint writes patient messages into a doctor's inbox without a session,
 * so a forged POST that passed here would let a stranger fabricate messages
 * from patients. Every refusal below is refusing exactly that.
 *
 * Verified against Meta's documentation in Task 5.1; see the Webhooks section
 * of `docs/integrations/whatsapp.md`.
 */

/** Meta's header, and the only signature format it sends. */
export const SIGNATURE_HEADER = "x-hub-signature-256";
const SIGNATURE_PREFIX = "sha256=";

export type SignatureRejection =
  /** No `META_APP_SECRET` configured, so authenticity cannot be established. */
  | "not_configured"
  /** Header absent — an unsigned request is not from Meta. */
  | "missing_signature"
  /** Header present but not `sha256=<hex>`. */
  | "malformed_signature"
  /** Correctly shaped, wrong digest. */
  | "invalid_signature";

export type SignatureResult =
  | { readonly outcome: "valid" }
  | { readonly outcome: "rejected"; readonly reason: SignatureRejection };

/** `sha256=` followed by a SHA-256 digest in lowercase hex. */
const SIGNATURE_PATTERN = /^sha256=[0-9a-f]{64}$/;

/**
 * Verifies Meta's HMAC over the delivery.
 *
 * @param rawBody The request body as Meta sent it. **Must be the raw bytes.**
 *                Parsing and re-serialising JSON changes whitespace and key
 *                order, which changes the digest — the comparison would then
 *                fail for every legitimate delivery, or, worse, be "fixed"
 *                later by someone removing the check.
 * @param header  The `X-Hub-Signature-256` header value, or null.
 */
export function verifyWebhookSignature(
  rawBody: string,
  header: string | null,
): SignatureResult {
  const appSecret = serverEnv().META_APP_SECRET;

  // Fail closed. An endpoint that cannot authenticate its caller must not
  // accept patient messages from it.
  if (appSecret === undefined) {
    return { outcome: "rejected", reason: "not_configured" };
  }

  if (header === null || header.length === 0) {
    return { outcome: "rejected", reason: "missing_signature" };
  }

  // Checked before comparing so a malformed header is diagnosable as such,
  // rather than reported as a wrong digest and sending someone hunting for a
  // secret mismatch that does not exist.
  if (!SIGNATURE_PATTERN.test(header)) {
    return { outcome: "rejected", reason: "malformed_signature" };
  }

  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");

  if (!digestsMatch(header.slice(SIGNATURE_PREFIX.length), expected)) {
    return { outcome: "rejected", reason: "invalid_signature" };
  }

  return { outcome: "valid" };
}

/**
 * Constant-time comparison of two hex digests.
 *
 * Both are already fixed-length by the pattern check above, but they are hashed
 * again rather than compared directly: `timingSafeEqual` throws on a length
 * mismatch, and hashing removes any path where a future change to the pattern
 * turns that throw into a 500 on every delivery.
 */
function digestsMatch(provided: string, expected: string): boolean {
  const providedDigest = createHash("sha256").update(provided, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();

  return timingSafeEqual(providedDigest, expectedDigest);
}

/**
 * The digest Meta would send for this body.
 *
 * Exported for tests, which must be able to produce a genuinely valid
 * signature — a test that fakes one proves nothing about the verifier.
 */
export function signWebhookBody(rawBody: string, appSecret: string): string {
  return `${SIGNATURE_PREFIX}${createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`;
}
