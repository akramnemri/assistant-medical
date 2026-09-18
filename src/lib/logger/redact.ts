/**
 * Key-based redaction for structured log context.
 *
 * This application handles doctor-patient conversations, so the bias here is
 * deliberately toward over-redacting. Losing a field from a log line costs one
 * debugging session; writing a patient's message or a Meta access token into
 * the logs is not recoverable.
 *
 * Redaction is by *key name*, not by value inspection. Value-sniffing
 * (regex for things that look like tokens) misses novel formats and produces
 * false confidence.
 */

export const REDACTED = "[redacted]";

/**
 * Credentials and signing material. Anything matching these must never reach a
 * log sink, a bug tracker, or an error report.
 */
const SECRET_KEY_PATTERNS = [
  "password",
  "passwd",
  "secret",
  "token",
  "apikey",
  "accesskey",
  "privatekey",
  "secretkey",
  "credential",
  "authorization",
  "signature",
  "cookie",
  "sessionid",
  "bearer",
] as const;

/**
 * Patient-identifying data. Matched as substrings, so `patientPhone` and
 * `phone_number` are both caught.
 */
const PII_KEY_PATTERNS = [
  "phone",
  "msisdn",
  "waid",
  "email",
  "firstname",
  "lastname",
  "fullname",
  "patientname",
  "dateofbirth",
  "address",
  "messagebody",
  "messagetext",
  "transcript",
] as const;

const SENSITIVE_KEY_PATTERNS = [...SECRET_KEY_PATTERNS, ...PII_KEY_PATTERNS];

/**
 * Message-content field names, matched **exactly** rather than as substrings.
 *
 * `body`, `text` and `caption` are what Meta calls the contents of a WhatsApp
 * message, so they must be redacted — but they are short, generic words that
 * appear inside unrelated identifiers. Matching "text" as a substring redacts
 * `context`, which silently destroys the diagnostic value of every error log.
 */
const SENSITIVE_EXACT_KEYS = new Set(["body", "text", "caption"]);

/**
 * Secrets that appear *inside* a string rather than as a field of their own —
 * most commonly a database driver putting a connection string into an error
 * message, or a provider echoing a query parameter.
 *
 * This is best-effort defence in depth, not a guarantee. Key-based redaction
 * above is the real control; a secret in an unrecognized free-text format can
 * still get through, which is why error messages are treated as internal-only
 * and never returned to a client.
 */
const INLINE_SECRET_RULES: readonly {
  readonly pattern: RegExp;
  readonly replacement: string;
}[] = [
  {
    // password=..., token: ..., api_key=..., authorization: Bearer ...
    // The optional "bearer" prefix is consumed so the token after it is what
    // gets masked, rather than the word "Bearer".
    pattern:
      /\b((?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|authorization)\s*[=:]\s*)(?:bearer\s+)?\S+/gi,
    replacement: `$1${REDACTED}`,
  },
  {
    // A bare "Bearer <token>", with no preceding field name.
    pattern: /\bbearer\s+[\w.~+/-]+=*/gi,
    replacement: `Bearer ${REDACTED}`,
  },
  {
    // Credentials embedded in a URL: scheme://user:password@host
    pattern: /(\w+:\/\/[^:@\s/]+:)[^@\s]+(@)/g,
    replacement: `$1${REDACTED}$2`,
  },
];

/**
 * Masks secrets embedded in free text. Applied to every string that passes
 * through redaction, including error messages and stack traces.
 *
 * Uses string replacements rather than callbacks on purpose: a callback's
 * trailing arguments are the match offset and full input, which is easy to
 * mistake for a capture group and splice into the output.
 */
export function scrubInlineSecrets(text: string): string {
  return INLINE_SECRET_RULES.reduce(
    (result, { pattern, replacement }) => result.replace(pattern, replacement),
    text,
  );
}

/** Beyond this, nesting is replaced rather than walked. Bounds cost and cycles. */
const MAX_DEPTH = 4;

/** Logging a huge array floods the sink and buries the useful line. */
const MAX_ARRAY_ITEMS = 20;

/**
 * `wa_id`, `WA-ID` and `waId` are the same field. Comparing on a normalized
 * form means a new casing convention cannot quietly bypass redaction.
 */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);

  if (SENSITIVE_EXACT_KEYS.has(normalized)) return true;

  return SENSITIVE_KEY_PATTERNS.some((pattern) => normalized.includes(pattern));
}

export function redact(value: unknown): unknown {
  return redactValue(value, 0, new WeakSet());
}

/** Redacts a context object, always returning an object for a stable log shape. */
export function redactContext(context: Record<string, unknown>): Record<string, unknown> {
  const result = redactValue(context, 0, new WeakSet());
  return isPlainRecord(result) ? result : {};
}

function redactValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  // Catches a secret embedded in free text, wherever it appears — including an
  // error message or a stack trace, which arrive here as ordinary strings.
  if (typeof value === "string") return scrubInlineSecrets(value);

  if (value === null || typeof value !== "object") return value;

  if (depth >= MAX_DEPTH) return "[truncated]";

  // A context object that references itself would otherwise recurse forever.
  if (seen.has(value)) return "[circular]";
  seen.add(value);

  if (value instanceof Error) {
    return { name: value.name, message: scrubInlineSecrets(value.message) };
  }

  if (value instanceof Date) return value.toISOString();

  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => redactValue(item, depth + 1, seen));

    return value.length > MAX_ARRAY_ITEMS
      ? [...items, `[${value.length - MAX_ARRAY_ITEMS} more items]`]
      : items;
  }

  if (!isPlainRecord(value)) return "[unserializable]";

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = isSensitiveKey(key) ? REDACTED : redactValue(entry, depth + 1, seen);
  }
  return result;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
