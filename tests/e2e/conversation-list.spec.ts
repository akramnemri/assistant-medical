import { expect, test } from "@playwright/test";

/**
 * The inbox against the real local stack.
 *
 * The component tests cover each state in isolation; these check that the page
 * wires the service to the UI and that one workspace's inbox never contains
 * another's patients.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";

const DOCTOR_A = { email: "doctor-a@example.test", password: "devpassword123" };
const DOCTOR_B = { email: "doctor-b@example.test", password: "devpassword123" };

test.beforeAll(async ({ request }) => {
  const response = await request.get(`${SUPABASE_URL}/auth/v1/health`).catch(() => null);

  test.skip(
    response === null || !response.ok(),
    "local Supabase stack is not reachable; run `npx supabase start`",
  );
});

async function signIn(
  page: import("@playwright/test").Page,
  account: { email: string; password: string },
) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test("the inbox lists a workspace's conversations with previews and unread counts", async ({
  page,
}) => {
  await signIn(page, DOCTOR_A);
  await page.goto("/conversations");

  const list = page.getByRole("list", { name: "Conversations" });
  await expect(list).toBeVisible();
  await expect(list.getByRole("listitem")).toHaveCount(2);

  await expect(list).toContainText("Sam Patient (synthetic)");
  await expect(list).toContainText("Alex Patient (synthetic)");

  // A seeded thread has unread inbound messages, so a badge must be present.
  await expect(list.getByLabel(/unread messages/).first()).toBeVisible();
});

// A media or unsupported message carries no text; without a label the row
// renders blank and looks broken.
test("a message with no text is described rather than left blank", async ({ page }) => {
  await signIn(page, DOCTOR_A);
  await page.goto("/conversations");

  await expect(page.getByText(/unsupported message/i)).toBeVisible();
});

test("opening a conversation navigates to its thread", async ({ page }) => {
  await signIn(page, DOCTOR_A);
  await page.goto("/conversations");

  await page.getByRole("link", { name: /Sam Patient/ }).click();

  await expect(page).toHaveURL(/\/conversations\/[0-9a-f-]{36}$/);
});

test("a workspace with no conversations sees the empty state", async ({ page }) => {
  await signIn(page, DOCTOR_B);
  await page.goto("/conversations");

  await expect(page.getByText(/no conversations yet/i)).toBeVisible();
  await expect(page.getByRole("listitem")).toHaveCount(0);
});

// The service filters by workspace and RLS enforces it independently; this
// checks the property a doctor would actually notice.
test("one workspace's inbox never shows another workspace's patients", async ({
  page,
}) => {
  await signIn(page, DOCTOR_B);
  await page.goto("/conversations");

  const body = page.locator("body");
  await expect(body).not.toContainText("Sam Patient");
  await expect(body).not.toContainText("Alex Patient");
  await expect(body).not.toContainText("15550000001");
});

test("the inbox has no horizontal overflow on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page, DOCTOR_A);
  await page.goto("/conversations");

  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );

  expect(overflows).toBe(false);
});
