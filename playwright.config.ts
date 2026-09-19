import { defineConfig, devices } from "@playwright/test";

// A dedicated port so the suite never collides with — or silently reuses — a
// `next dev` server the developer has running on 3000.
const E2E_PORT = process.env.E2E_PORT ?? "3100";
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${E2E_PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  // A flaky-by-default suite is worse than no suite, so retries only exist in CI
  // where the cost of a spurious re-run is lower than a blocked pipeline.
  retries: process.env.CI ? 2 : 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // E2E runs against a production build, not `next dev`. The dev server adds
    // an HMR WebSocket and other development-only behaviour that is not what
    // ships, and whose console noise would otherwise mask real page errors.
    command: `npm run build && npx next start --port ${E2E_PORT}`,
    url: baseURL,
    // Never reuse: an already-running server could be a dev server, which is
    // exactly what this suite is configured to avoid testing against.
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
