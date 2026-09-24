import { z } from "zod";

/**
 * Public configuration, safe to read from browser code.
 *
 * Everything here is inlined into the client bundle at build time, so only
 * non-secret values belong in this file. The Supabase publishable key is safe
 * to expose *only* because Row Level Security is enforced on every table — it
 * is an identifier for the project, not an authorization grant.
 *
 * Server-only secrets live in `server-env.ts`, which browser code cannot import.
 */

const clientEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url("must be a valid URL, e.g. http://127.0.0.1:54321"),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .min(1, "is required (the project's publishable key)"),
  NEXT_PUBLIC_SITE_URL: z.url("must be a valid URL, e.g. http://localhost:3000"),

  /**
   * Meta app id and the Facebook Login for Business configuration id that
   * Embedded Signup launches from.
   *
   * Public by nature — both appear in the browser during Meta's own flow, and
   * neither authorizes anything on its own. The app *secret* stays server-only;
   * these two cannot be used without it.
   *
   * Optional so the product still builds and runs where onboarding is not
   * configured. The connection screen then explains that rather than offering a
   * button that cannot work.
   */
  NEXT_PUBLIC_META_APP_ID: z.string().min(1).optional(),
  NEXT_PUBLIC_META_CONFIG_ID: z.string().min(1).optional(),
});

export type ClientEnv = z.infer<typeof clientEnvSchema>;

/**
 * Next.js replaces `process.env.NEXT_PUBLIC_*` at build time only when it is
 * written out literally. Reading `process.env[name]` dynamically yields
 * `undefined` in the browser, so these accesses must stay spelled out.
 */
const rawClientEnv = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  // `|| undefined` because `.env.example` ships these as empty strings, and an
  // empty string is "not configured", not a value.
  NEXT_PUBLIC_META_APP_ID: process.env.NEXT_PUBLIC_META_APP_ID || undefined,
  NEXT_PUBLIC_META_CONFIG_ID: process.env.NEXT_PUBLIC_META_CONFIG_ID || undefined,
};

/**
 * Formats a validation failure as something actionable.
 *
 * A misconfigured environment is the single most common way a developer loses
 * an hour on this project, so the message names the variables and points at the
 * template rather than printing a schema dump.
 */
export function formatEnvIssues(issues: readonly z.core.$ZodIssue[]): string {
  const details = issues
    .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");

  return `Invalid environment configuration:\n${details}\n\nCopy .env.example to .env.local and fill in the missing values.`;
}

let cached: ClientEnv | undefined;

/**
 * Validated public configuration.
 *
 * Deliberately a function rather than a module-level constant: a top-level
 * throw during import produces a stack trace pointing at the import chain
 * rather than at the code that actually needed the value.
 */
export function clientEnv(): ClientEnv {
  if (cached) return cached;

  const parsed = clientEnvSchema.safeParse(rawClientEnv);

  if (!parsed.success) {
    throw new Error(formatEnvIssues(parsed.error.issues));
  }

  cached = parsed.data;
  return cached;
}

/**
 * Whether the browser has what Embedded Signup needs to start.
 *
 * The server has its own check (`isMetaOnboardingConfigured`) covering the app
 * secret, which the browser must never see. Both have to be true for the flow
 * to work end to end: this one to open Meta's dialog, the server's to exchange
 * the code it returns.
 */
export function isEmbeddedSignupConfigured(): boolean {
  const env = clientEnv();
  return (
    env.NEXT_PUBLIC_META_APP_ID !== undefined &&
    env.NEXT_PUBLIC_META_CONFIG_ID !== undefined
  );
}
