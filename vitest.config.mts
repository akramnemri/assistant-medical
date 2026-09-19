import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
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
  },
});
