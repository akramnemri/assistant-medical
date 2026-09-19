import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The env modules capture `process.env` when they are first imported, and cache
 * the parsed result. Each case therefore sets the environment, resets the module
 * registry and imports fresh — otherwise every test after the first would see
 * the first one's configuration.
 */
const VALID_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_key",
  NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
} as const;

const originalEnv = process.env;

beforeEach(() => {
  vi.resetModules();
  process.env = { ...originalEnv };
});

afterEach(() => {
  process.env = originalEnv;
});

function setEnv(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe("clientEnv", () => {
  it("returns the parsed configuration when every variable is present", async () => {
    setEnv(VALID_ENV);
    const { clientEnv } = await import("@/lib/config/client-env");

    expect(clientEnv()).toEqual(VALID_ENV);
  });

  // The manual setup step is "copy .env.example and fill it in", so the failure
  // a developer actually hits must name the variable that is missing.
  it("fails with an actionable message when the publishable key is missing", async () => {
    setEnv({ ...VALID_ENV, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined });
    const { clientEnv } = await import("@/lib/config/client-env");

    expect(() => clientEnv()).toThrow(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
    expect(() => clientEnv()).toThrow(/\.env\.example/);
  });

  it("rejects a malformed URL rather than failing later at request time", async () => {
    setEnv({ ...VALID_ENV, NEXT_PUBLIC_SUPABASE_URL: "not-a-url" });
    const { clientEnv } = await import("@/lib/config/client-env");

    expect(() => clientEnv()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("reports every invalid variable at once, not just the first", async () => {
    setEnv({
      NEXT_PUBLIC_SUPABASE_URL: undefined,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined,
      NEXT_PUBLIC_SITE_URL: undefined,
    });
    const { clientEnv } = await import("@/lib/config/client-env");

    const message = (() => {
      try {
        clientEnv();
        return "";
      } catch (error) {
        return error instanceof Error ? error.message : "";
      }
    })();

    expect(message).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(message).toContain("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
    expect(message).toContain("NEXT_PUBLIC_SITE_URL");
  });
});

describe("serverEnv", () => {
  // .env.example ships optional variables as VAR="". Copying the template is
  // the documented setup step, so "" has to mean "not set".
  it("treats an empty string as unset", async () => {
    setEnv({ ...VALID_ENV, SUPABASE_SECRET_KEY: "", LOG_LEVEL: "" });
    const { serverEnv, hasSupabaseSecretKey } = await import("@/lib/config/server-env");

    expect(serverEnv().SUPABASE_SECRET_KEY).toBeUndefined();
    expect(serverEnv().LOG_LEVEL).toBeUndefined();
    expect(hasSupabaseSecretKey()).toBe(false);
  });

  it("reports the secret key as present when it is set", async () => {
    setEnv({ ...VALID_ENV, SUPABASE_SECRET_KEY: "sb_secret_test_key" });
    const { hasSupabaseSecretKey } = await import("@/lib/config/server-env");

    expect(hasSupabaseSecretKey()).toBe(true);
  });

  it("rejects an unrecognized log level", async () => {
    setEnv({ ...VALID_ENV, LOG_LEVEL: "verbose" });
    const { serverEnv } = await import("@/lib/config/server-env");

    expect(() => serverEnv()).toThrow(/LOG_LEVEL/);
  });
});

describe("supabase clients", () => {
  it("creates a browser client from valid configuration", async () => {
    setEnv(VALID_ENV);
    const { createSupabaseBrowserClient } = await import("@/lib/supabase/client");

    const client = createSupabaseBrowserClient();

    expect(client.auth).toBeDefined();
    expect(typeof client.from).toBe("function");
  });

  it("creates an admin client when the secret key is configured", async () => {
    setEnv({ ...VALID_ENV, SUPABASE_SECRET_KEY: "sb_secret_test_key" });
    const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");

    expect(() => createSupabaseAdminClient()).not.toThrow();
  });

  // The RLS-bypassing client must fail loudly rather than quietly falling back
  // to the publishable key, which would look like it worked while silently
  // being subject to policies.
  it("refuses to build an admin client without the secret key", async () => {
    setEnv({ ...VALID_ENV, SUPABASE_SECRET_KEY: undefined });
    const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
    const { isAppError } = await import("@/lib/errors/app-error");

    try {
      createSupabaseAdminClient();
      expect.unreachable("expected a CONFIGURATION_ERROR");
    } catch (error) {
      expect(isAppError(error)).toBe(true);
      if (isAppError(error)) {
        expect(error.code).toBe("CONFIGURATION_ERROR");
        // The user-facing message must not name an environment variable.
        expect(error.message).not.toContain("SUPABASE_SECRET_KEY");
        expect(error.context.reason).toContain("SUPABASE_SECRET_KEY");
      }
    }
  });
});
