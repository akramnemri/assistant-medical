import { normalizeError, type NormalizedError } from "@/lib/errors/normalize";
import { redactContext } from "@/lib/logger/redact";

export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Fields worth carrying on most log lines. Anything else goes in the rest of
 * the context object; these are named because they are what you actually filter
 * and correlate on when something breaks in production.
 */
export type LogContext = {
  /** Correlates every line produced while handling one request. */
  readonly requestId?: string;
  /** What was being attempted, e.g. "whatsapp.webhook.receive". */
  readonly operation?: string;
  /** Meta's event identifier, for tracing one webhook delivery. */
  readonly providerEventId?: string;
  /** Include only where it genuinely aids diagnosis. */
  readonly workspaceId?: string;
  readonly [key: string]: unknown;
};

export type LogEntry = {
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly message: string;
  readonly error?: NormalizedError;
} & Record<string, unknown>;

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function minimumLevel(): LogLevel {
  const configured = process.env.LOG_LEVEL;
  if (configured && configured in LEVEL_PRIORITY) return configured as LogLevel;
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

/**
 * Builds the log line without writing it.
 *
 * Exported separately so tests can assert on the exact structure — including
 * what redaction removed — without capturing console output.
 */
export function buildLogEntry(
  level: LogLevel,
  message: string,
  context: LogContext = {},
  error?: unknown,
): LogEntry {
  return {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...redactContext(context),
    // The normalized error is redacted too, not just the caller's context: an
    // AppError carries its own `context`, and a caller can put a provider
    // payload in there without thinking about what it contains.
    ...(error === undefined
      ? {}
      : {
          error: redactContext(
            normalizeError(error) as unknown as Record<string, unknown>,
          ) as NormalizedError,
        }),
  };
}

function write(level: LogLevel, entry: LogEntry): void {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[minimumLevel()]) return;

  // One JSON object per line: greppable locally and parseable by whatever log
  // aggregator this ends up behind, without a logging dependency.
  const line = JSON.stringify(entry);

  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug(message: string, context?: LogContext): void {
    write("debug", buildLogEntry("debug", message, context));
  },

  info(message: string, context?: LogContext): void {
    write("info", buildLogEntry("info", message, context));
  },

  warn(message: string, context?: LogContext): void {
    write("warn", buildLogEntry("warn", message, context));
  },

  /**
   * @param error The caught value. Anything can be thrown in JavaScript, so
   *              this accepts `unknown` rather than `Error`.
   */
  error(message: string, error?: unknown, context?: LogContext): void {
    write("error", buildLogEntry("error", message, context, error));
  },
};
