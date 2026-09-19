import { z } from "zod";

/**
 * Credential validation, shared by the sign-in and sign-up actions.
 *
 * This is a usability check, not a security boundary — Supabase enforces the
 * real password policy. Validating here means a typo produces an inline field
 * error instead of a round trip and a generic provider failure.
 */

/** Matches `minimum_password_length` in supabase/config.toml. */
const MINIMUM_PASSWORD_LENGTH = 6;

export const credentialsSchema = z.object({
  email: z.email("Enter a valid email address."),
  password: z
    .string()
    .min(
      MINIMUM_PASSWORD_LENGTH,
      `Password must be at least ${MINIMUM_PASSWORD_LENGTH} characters.`,
    ),
});

export type Credentials = z.infer<typeof credentialsSchema>;

/** Per-field messages, keyed by field name, for rendering next to each input. */
export type FieldErrors = Partial<Record<keyof Credentials, string>>;

/**
 * Parses a submitted `FormData`.
 *
 * Returns field errors rather than throwing: invalid input is an expected
 * outcome of a form submission, not an exceptional one.
 */
export function parseCredentials(
  formData: FormData,
): { ok: true; data: Credentials } | { ok: false; fieldErrors: FieldErrors } {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (parsed.success) return { ok: true, data: parsed.data };

  const fieldErrors: FieldErrors = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if (field === "email" || field === "password") {
      fieldErrors[field] ??= issue.message;
    }
  }

  return { ok: false, fieldErrors };
}
