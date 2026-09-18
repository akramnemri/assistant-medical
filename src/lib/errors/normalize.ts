import { isAppError, type ErrorCode } from "@/lib/errors/app-error";

/**
 * A thrown value reduced to a predictable, loggable shape.
 *
 * This is for logs and internal diagnostics only. `message` may contain
 * internal detail (a database error string, a provider response fragment) and
 * must never be returned to a client.
 */
export type NormalizedError = {
  readonly name: string;
  readonly message: string;
  readonly code?: ErrorCode;
  readonly stack?: string;
  readonly context?: Record<string, unknown>;
  readonly cause?: NormalizedError;
};

/** Guards against a self-referencing `cause` chain turning into infinite recursion. */
const MAX_CAUSE_DEPTH = 3;

/**
 * JavaScript lets you throw anything — a string, a number, `undefined`, a
 * plain object from a rejected fetch. Every one of those reaches a catch block
 * eventually, so normalize before logging rather than assuming `Error`.
 */
export function normalizeError(value: unknown, depth = 0): NormalizedError {
  if (isAppError(value)) {
    return {
      name: value.name,
      message: value.message,
      code: value.code,
      ...(value.stack === undefined ? {} : { stack: value.stack }),
      ...(Object.keys(value.context).length === 0 ? {} : { context: value.context }),
      ...causeOf(value.cause, depth),
    };
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      ...(value.stack === undefined ? {} : { stack: value.stack }),
      ...causeOf(value.cause, depth),
    };
  }

  if (typeof value === "string") {
    return { name: "ThrownString", message: value };
  }

  if (value === null || value === undefined) {
    return { name: "ThrownNullish", message: String(value) };
  }

  return { name: "ThrownValue", message: safeStringify(value) };
}

function causeOf(
  cause: unknown,
  depth: number,
): { cause?: NormalizedError } | Record<string, never> {
  if (cause === undefined || depth >= MAX_CAUSE_DEPTH) return {};
  return { cause: normalizeError(cause, depth + 1) };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    // Circular structures and BigInt both make JSON.stringify throw. Losing the
    // detail is acceptable; losing the log line because normalization threw is
    // not.
    return String(value);
  }
}
