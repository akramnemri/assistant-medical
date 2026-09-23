import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig as defineVitestConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Integration tests talk to the local Supabase stack, so they need the same
// configuration the app uses. Vitest does not read .env.local on its own.
const localEnv = loadEnv("development", process.cwd(), "");

export default defineVitestConfig({
  plugins: [react()],
  resolve: {
    // Resolves the "@/*" alias from tsconfig.json so tests import modules the
    // same way application code does.
    tsconfigPaths: true,
    alias: {
      // See tests/stubs/server-only.ts for why this is aliased.
      "server-only": fileURLToPath(
        new URL("./tests/stubs/server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "jsdom",
    // Several config tests use `vi.resetModules()` plus a dynamic import, and
    // the first cold transform of the module graph (zod, supabase-js) can take
    // several seconds on Windows. The default 5s fails those spuriously.
    testTimeout: 20_000,
    setupFiles: ["./tests/setup.ts"],
    // Playwright owns tests/e2e; Vitest must not try to collect those specs.
    include: ["tests/unit/**/*.test.{ts,tsx}", "tests/integration/**/*.test.{ts,tsx}"],
    css: false,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: localEnv.NEXT_PUBLIC_SUPABASE_URL ?? "",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
        localEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
      // The realtime test writes the way the webhook will: with the secret key,
      // because members have no insert policy on messages.
      NEXT_PUBLIC_SITE_URL: localEnv.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
      SUPABASE_SECRET_KEY: localEnv.SUPABASE_SECRET_KEY ?? "",
    },
  },
});
