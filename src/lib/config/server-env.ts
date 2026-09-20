import "server-only";
import { z } from "zod";
import { formatEnvIssues } from "@/lib/config/client-env";

/**
 * Server-only configuration.
 *
 * The `server-only` import above is the enforcement: importing this module from
 * a client component fails the build rather than shipping a secret to the
 * browser. That is a build-time guarantee, not a convention someone has to
 * remember during review.
 */

const serverEnvSchema = z.object({
  /**
   * Optional on purpose. This key bypasses Row Level Security entirely, so the
   * application must run without it and only the few places that genuinely
   * need it may require it — see `supabase/admin.ts`.
   */
  SUPABASE_SECRET_KEY: z.string().min(1).optional(),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).optional(),

  /**
   * Meta app credentials. Optional because the product runs without them —
   * every screen except WhatsApp onboarding works — and the connection UI
   * reports "not configured" rather than failing when they are absent.
   */
  META_APP_ID: z.string().min(1).optional(),
  META_APP_SECRET: z.string().min(1).optional(),
  META_WEBHOOK_VERIFY_TOKEN: z.string().min(1).optional(),

  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

/**
 * `.env.example` declares optional variables as `VAR=""`, and copying the
 * template is the documented setup step. An empty string is "not set", not the
 * value "" — without this, a freshly copied .env.local fails validation.
 */
function optional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}

export function serverEnv(): ServerEnv {
  if (cached) return cached;

  const parsed = serverEnvSchema.safeParse({
    SUPABASE_SECRET_KEY: optional(process.env.SUPABASE_SECRET_KEY),
    LOG_LEVEL: optional(process.env.LOG_LEVEL),
    META_APP_ID: optional(process.env.META_APP_ID),
    META_APP_SECRET: optional(process.env.META_APP_SECRET),
    META_WEBHOOK_VERIFY_TOKEN: optional(process.env.META_WEBHOOK_VERIFY_TOKEN),
    NODE_ENV: optional(process.env.NODE_ENV),
  });

  if (!parsed.success) {
    throw new Error(formatEnvIssues(parsed.error.issues));
  }

  cached = parsed.data;
  return cached;
}

/**
 * Whether Meta onboarding can be offered at all.
 *
 * Only the app id is required to *start* Embedded Signup; the secret is needed
 * to complete the exchange server-side (Task 5.3). Both are checked so the UI
 * cannot invite a doctor into a flow that will fail at the last step.
 *
 * Returns a boolean, never the values: this is called from a server component
 * that renders into the browser.
 */
export function isMetaOnboardingConfigured(): boolean {
  const env = serverEnv();
  return env.META_APP_ID !== undefined && env.META_APP_SECRET !== undefined;
}

/**
 * Whether privileged, RLS-bypassing database access is configured at all.
 *
 * Lets a caller degrade gracefully instead of throwing, for features that are
 * simply unavailable without the secret key.
 */
export function hasSupabaseSecretKey(): boolean {
  const value = serverEnv().SUPABASE_SECRET_KEY;
  return value !== undefined && value.length > 0;
}
