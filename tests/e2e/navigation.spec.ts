import { expect, test } from "@playwright/test";

/**
 * Proves every skeleton route actually resolves. A route group folder that is
 * misnamed still compiles but 404s at runtime, which only a real request shows.
 */
const ROUTES = [
  { path: "/", heading: /centralize patient conversations/i },
  { path: "/sign-in", heading: /sign in/i },
  { path: "/sign-up", heading: /create account/i },
  { path: "/dashboard", heading: /dashboard/i },
  { path: "/conversations", heading: /conversations/i },
  { path: "/conversations/test-id-123", heading: /^conversation$/i },
  { path: "/whatsapp", heading: /whatsapp connection/i },
  { path: "/settings", heading: /settings/i },
  { path: "/admin", heading: /administration/i },
] as const;

for (const route of ROUTES) {
  test(`${route.path} renders`, async ({ page }) => {
    const response = await page.goto(route.path);

    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: route.heading })).toBeVisible();
  });
}

test("an unknown route renders the 404 page", async ({ page }) => {
  const response = await page.goto("/this-route-does-not-exist");

  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: /page not found/i })).toBeVisible();
});

test("sidebar navigation moves between workspace routes", async ({ page }) => {
  await page.goto("/dashboard");

  // Scoped to the nav landmark: the sidebar's brand link also mentions
  // "conversations", so a page-wide role query matches two elements.
  const nav = page.getByRole("navigation", { name: "Main" });

  await nav.getByRole("link", { name: "Conversations" }).click();
  await expect(page).toHaveURL(/\/conversations$/);
  await expect(nav.getByRole("link", { name: "Conversations" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await nav.getByRole("link", { name: "WhatsApp" }).click();
  await expect(page).toHaveURL(/\/whatsapp$/);
});

/**
 * The E2E suite runs against a production build, which is exactly where the
 * development-only routes must not be reachable. A gate that is only asserted
 * in unit tests would not catch a build that ships them.
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
