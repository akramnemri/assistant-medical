import { expect, test } from "@playwright/test";

/**
 * Full email/password journey against the local Supabase stack.
 *
 * **Requires `npx supabase start`.** These tests create real auth users in the
 * local database, so they are skipped rather than failed when the stack is not
 * reachable — a developer running the suite without Docker should not see a
 * false failure.
 *
 * All data is synthetic. Each run uses a unique address so repeated runs do not
 * collide on "email already registered".
 */

function syntheticEmail(): string {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // .test is reserved by RFC 2606 and can never route to a real mailbox.
  return `doctor-${unique}@example.test`;
}

const SYNTHETIC_PASSWORD = "synthetic-test-password";

/**
 * Probed directly rather than through the app's own dev endpoint, which 404s in
 * a production build — exactly the build this suite runs against. GoTrue's
 * health endpoint needs no API key.
 */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";

test.beforeAll(async ({ request }) => {
  const response = await request.get(`${SUPABASE_URL}/auth/v1/health`).catch(() => null);

  test.skip(
    response === null || !response.ok(),
    "local Supabase stack is not reachable; run `npx supabase start`",
  );
});

test("a doctor can register, stay signed in across a reload, and sign out", async ({
  page,
}) => {
  const email = syntheticEmail();

  await page.goto("/sign-up");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(SYNTHETIC_PASSWORD);
  await page.getByRole("button", { name: /create account/i }).click();

  // Registration signs the user in and lands them on the dashboard.
  // Scoped to <main>: the email also appears in the sidebar account block.
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("main").getByText(email)).toBeVisible();

  // Sign-up provisions a workspace in the same transaction as the user, so a
  // brand new account must already have one and own it.
  await expect(page.getByRole("main")).toContainText("workspace");
  // The role is stored lowercase and only capitalised by CSS, so the DOM text
  // is "owner" regardless of how it looks on screen.
  await expect(page.getByRole("main")).toContainText(/owner/i);

  // Session persistence: the cookie survives a full reload, not just client
  // state held in memory.
  await page.reload();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("main").getByText(email)).toBeVisible();

  // A signed-in user has no reason to see the sign-in page.
  await page.goto("/sign-in");
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.getByRole("button", { name: /sign out/i }).click();
  await expect(page).toHaveURL(/\/sign-in/);

  // The session is genuinely gone, not just navigated away from.
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("signing in with the wrong password is rejected without revealing the account", async ({
  page,
}) => {
  const email = syntheticEmail();

  await page.goto("/sign-up");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(SYNTHETIC_PASSWORD);
  await page.getByRole("button", { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.getByRole("button", { name: /sign out/i }).click();
  await expect(page).toHaveURL(/\/sign-in/);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("definitely-the-wrong-password");
  await page.getByRole("button", { name: /^sign in$/i }).click();

  // Scoped to the form: Next.js injects its own empty role="alert" route
  // announcer into every page, which an unscoped query matches first.
  const alert = page.locator("form").getByRole("alert");
  await expect(alert).toBeVisible();
  await expect(alert).toHaveText(/incorrect email or password/i);
  // Must not distinguish "wrong password" from "no such account".
  await expect(alert).not.toHaveText(/not found|no account/i);

  await expect(page).toHaveURL(/\/sign-in/);
});

test("an unknown account gives the same message as a wrong password", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(syntheticEmail());
  await page.getByLabel("Password").fill(SYNTHETIC_PASSWORD);
  await page.getByRole("button", { name: /^sign in$/i }).click();

  await expect(page.locator("form").getByRole("alert")).toHaveText(
    /incorrect email or password/i,
  );
});

test("signing in returns the doctor to the page they originally requested", async ({
  page,
}) => {
  const email = syntheticEmail();

  await page.goto("/sign-up");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(SYNTHETIC_PASSWORD);
  await page.getByRole("button", { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole("button", { name: /sign out/i }).click();
  await expect(page).toHaveURL(/\/sign-in/);

  // Land on a protected page while signed out, then sign in.
  await page.goto("/conversations");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fconversations/);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(SYNTHETIC_PASSWORD);
  await page.getByRole("button", { name: /^sign in$/i }).click();

  await expect(page).toHaveURL(/\/conversations$/);
});

test("invalid input is reported per field without contacting the provider", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("not-an-email");
  await page.getByLabel("Password").fill("x");
  await page.getByRole("button", { name: /^sign in$/i }).click();

  await expect(page.getByText(/enter a valid email address/i)).toBeVisible();
  await expect(page.getByText(/at least 6 characters/i)).toBeVisible();
});
