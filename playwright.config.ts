import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";

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
    command: "npm run build && npm start",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
