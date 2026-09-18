/**
 * Application errors with stable, greppable codes.
 *
 * Design rule that everything else depends on: **`AppError.message` is always
 * safe to show a user.** Internal detail belongs in `context` (logged, never
 * serialized to a response) or in `cause`. This makes leaking internals a thing
 * you have to do deliberately rather than something you can do by accident.
 */

/**
 * Stable error codes. These appear in logs, in API responses and in support
 * conversations, so treat a code as a public contract: add new ones freely,
 * but do not rename or repurpose an existing one.
 */
export const ERROR_CODES = {
  UNKNOWN: "UNKNOWN",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  PROVIDER_ERROR: "PROVIDER_ERROR",
  DATABASE_ERROR: "DATABASE_ERROR",
  CONFIGURATION_ERROR: "CONFIGURATION_ERROR",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

type ErrorDefault = {
  readonly status: number;
  readonly safeMessage: string;
};

/**
 * Default HTTP status and user-facing message per code.
 *
 * The messages are deliberately vague about internals. "Something went wrong"
 * is a feature here, not laziness: the useful detail goes to the logs under a
 * request ID the user can quote.
 */
const ERROR_DEFAULTS: Record<ErrorCode, ErrorDefault> = {
  UNKNOWN: {
    status: 500,
    safeMessage: "Something went wrong. Please try again.",
  },
  VALIDATION_FAILED: {
    status: 400,
    safeMessage: "The submitted data is not valid.",
  },
  UNAUTHENTICATED: {
    status: 401,
    safeMessage: "You need to sign in to continue.",
  },
  FORBIDDEN: {
    status: 403,
    safeMessage: "You do not have access to this resource.",
  },
  NOT_FOUND: {
    status: 404,
    safeMessage: "The requested resource was not found.",
  },
  CONFLICT: {
    status: 409,
    safeMessage: "That action conflicts with the current state.",
  },
  RATE_LIMITED: {
    status: 429,
    safeMessage: "Too many requests. Please wait and try again.",
  },
  PROVIDER_ERROR: {
    status: 502,
    safeMessage: "An external service failed. Please try again shortly.",
  },
  DATABASE_ERROR: {
    status: 500,
    safeMessage: "Something went wrong. Please try again.",
  },
  CONFIGURATION_ERROR: {
    status: 500,
    safeMessage: "The service is not configured correctly.",
  },
};

export type AppErrorOptions = {
  /**
   * Diagnostic detail for logs. Never serialized into a response. Still passed
   * through the logger's redaction, because a caller may put a provider payload
   * in here without thinking about it.
   */
  readonly context?: Record<string, unknown>;
  readonly cause?: unknown;
  /** Overrides the code's default HTTP status. */
  readonly status?: number;
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly context: Record<string, unknown>;

  /**
   * @param code       Stable error code.
   * @param safeMessage Shown to the user. Omit to use the code's default.
   */
  constructor(code: ErrorCode, safeMessage?: string, options: AppErrorOptions = {}) {
    const defaults = ERROR_DEFAULTS[code];
    super(safeMessage ?? defaults.safeMessage, { cause: options.cause });

    this.name = "AppError";
    this.code = code;
    this.status = options.status ?? defaults.status;
    this.context = options.context ?? {};

    // Without this the prototype chain breaks when targeting ES5-era output,
    // and `instanceof AppError` silently returns false.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/** The user-facing message and HTTP status for a code, without constructing an error. */
export function errorDefaults(code: ErrorCode): ErrorDefault {
  return ERROR_DEFAULTS[code];
}
