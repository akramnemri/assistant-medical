import { expect, test } from "@playwright/test";

/**
 * Routing behaviour for a signed-out visitor.
 *
 * A route-group folder that is misnamed still compiles but 404s at runtime, and
 * a proxy matcher mistake silently stops protecting a route. Only a real
 * request against a production build catches either.
 */

const PUBLIC_ROUTES = [
  { path: "/", heading: /centralize patient conversations/i },
  { path: "/sign-in", heading: /sign in/i },
  { path: "/sign-up", heading: /create account/i },
] as const;

/** Every route the proxy must keep a signed-out visitor away from. */
const PROTECTED_ROUTES = [
  "/dashboard",
  "/conversations",
  "/conversations/test-id-123",
  "/whatsapp",
  "/settings",
  "/admin",
] as const;

for (const route of PUBLIC_ROUTES) {
  test(`${route.path} is publicly reachable`, async ({ page }) => {
    const response = await page.goto(route.path);

    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: route.heading })).toBeVisible();
  });
}

for (const path of PROTECTED_ROUTES) {
  test(`${path} redirects a signed-out visitor to sign in`, async ({ page }) => {
    await page.goto(path);

    await expect(page).toHaveURL(/\/sign-in/);
    // The originally requested path is preserved so sign-in can return there.
    expect(new URL(page.url()).searchParams.get("next")).toBe(path);
    await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
  });
}

test("an unknown route renders the 404 page", async ({ page }) => {
  const response = await page.goto("/this-route-does-not-exist");

  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: /page not found/i })).toBeVisible();
});

/**
 * An open redirect on the sign-in page is a credible phishing primitive: the
 * URL looks like ours right up to the moment credentials are submitted.
 */
test("an external next parameter is not reflected into the form", async ({ page }) => {
  await page.goto("/sign-in?next=https://evil.example/login");

  const hidden = page.locator('input[name="next"]');
  await expect(hidden).toHaveValue("/dashboard");
});

/**
 * The E2E suite runs against a production build, which is exactly where the
 * development-only routes must not be reachable.
 */
test.describe("development-only routes are inert in a production build", () => {
  test("the dev error endpoint returns 404", async ({ request }) => {
    const response = await request.get("/api/dev/error?kind=app");

    expect(response.status()).toBe(404);
  });

  test("the dev throw page returns 404", async ({ page }) => {
    const response = await page.goto("/dev/throw");

    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: /page not found/i })).toBeVisible();
  });
});
