/**
 * Where to send a user after authentication.
 *
 * The "return to where you were going" path arrives from the URL, so it is
 * attacker-controlled: a link to
 * `/sign-in?next=https://evil.example/login` would otherwise turn our own
 * sign-in page into an open redirect, which is a credible phishing primitive
 * on a site doctors are told to trust.
 */

export const DEFAULT_SIGNED_IN_PATH = "/dashboard";

/** Query parameter carrying the originally requested path. */
export const NEXT_PARAM = "next";

/**
 * Returns `candidate` only if it is a path on this site.
 *
 * Accepts a single leading slash and nothing else. That rejects absolute URLs
 * (`https://evil.example`), scheme-relative URLs (`//evil.example`, which
 * browsers treat as absolute), and backslash variants that some parsers
 * normalise into `//`.
 */
export function safeRedirectPath(candidate: unknown): string {
  if (typeof candidate !== "string") return DEFAULT_SIGNED_IN_PATH;

  const value = candidate.trim();

  if (!value.startsWith("/")) return DEFAULT_SIGNED_IN_PATH;
  if (value.startsWith("//") || value.startsWith("/\\")) {
    return DEFAULT_SIGNED_IN_PATH;
  }
  // A control character could be used to smuggle a header or confuse a parser.
  if (/[\u0000-\u001f\u007f]/.test(value)) return DEFAULT_SIGNED_IN_PATH;

  return value;
}
