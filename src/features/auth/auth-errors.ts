import type { AuthError } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/errors/app-error";

/**
 * Translates a Supabase auth failure into an `AppError`.
 *
 * Keeps provider-specific error codes at this boundary: nothing outside the
 * auth feature should need to know what string Supabase used.
 *
 * On user enumeration — sign-in deliberately gives the *same* message whether
 * the email is unknown or the password is wrong. Distinguishing them would let
 * anyone test whether a given doctor has an account here, which for a medical
 * platform is itself sensitive.
 */
export function mapAuthError(error: AuthError): AppError {
  const context = { providerCode: error.code, providerStatus: error.status };

  switch (error.code) {
    case "invalid_credentials":
      return new AppError(ERROR_CODES.UNAUTHENTICATED, "Incorrect email or password.", {
        context,
        cause: error,
      });

    case "email_not_confirmed":
      return new AppError(
        ERROR_CODES.UNAUTHENTICATED,
        "Confirm your email address before signing in.",
        { context, cause: error },
      );

    case "weak_password":
      return new AppError(ERROR_CODES.VALIDATION_FAILED, "Choose a stronger password.", {
        context,
        cause: error,
      });

    case "user_already_exists":
    case "email_exists":
      // NOTE: this confirms an account exists, which is the enumeration
      // trade-off we accept for registration usability. Revisit when admin
      // approval lands and registration stops being open.
      return new AppError(
        ERROR_CODES.CONFLICT,
        "An account with this email already exists. Try signing in instead.",
        { context, cause: error },
      );

    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return new AppError(
        ERROR_CODES.RATE_LIMITED,
        "Too many attempts. Please wait a moment and try again.",
        { context, cause: error },
      );

    case "validation_failed":
      return new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        "The submitted details are not valid.",
        { context, cause: error },
      );

    default:
      // An unmapped code means Supabase itself failed or returned something
      // new. Treated as a provider fault, and the real code reaches the logs
      // through `context` so the gap can be closed.
      return new AppError(ERROR_CODES.PROVIDER_ERROR, undefined, {
        context,
        cause: error,
      });
  }
}
