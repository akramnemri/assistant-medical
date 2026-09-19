import { expect, test } from "@playwright/test";

/**
 * Tenant isolation of WhatsApp connections, exercised through the UI.
 *
 * The pgTAP suite proves the policies in the database. This proves the
 * application actually renders one workspace's connection and not another's —
 * a service that passed the wrong workspace id would slip past a database-only
 * test, because both rows are legitimately owned by *someone*.
 *
 * Uses the accounts from supabase/seed.sql, so it needs a seeded local stack.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";

const DOCTOR_A = { email: "doctor-a@example.test", password: "devpassword123" };
const DOCTOR_B = { email: "doctor-b@example.test", password: "devpassword123" };

/** Identifiers seeded for doctor A only; doctor B must never see them. */
const DOCTOR_A_PHONE_NUMBER_ID = "SYNTHETIC_PHONE_ID_A";
const DOCTOR_A_DISPLAY_NUMBER = "+1 555 0100";

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

test("a connected workspace shows its number and provider identifiers", async ({
  page,
}) => {
  await signIn(page, DOCTOR_A);
  await page.goto("/whatsapp");

  const main = page.getByRole("main");
  await expect(main).toContainText("Connected");
  await expect(main).toContainText(DOCTOR_A_DISPLAY_NUMBER);
  await expect(main).toContainText(DOCTOR_A_PHONE_NUMBER_ID);
});

test("a workspace mid-onboarding is shown as pending, not as connected", async ({
  page,
}) => {
  await signIn(page, DOCTOR_B);
  await page.goto("/whatsapp");

  const main = page.getByRole("main");
  await expect(main).toContainText("Setup in progress");
  await expect(main).not.toContainText("Connected");
  // A pending connection has no number yet, and must not borrow one.
  await expect(main).toContainText("Not assigned yet");
});

test("one workspace never sees another workspace's connection", async ({ page }) => {
  await signIn(page, DOCTOR_B);
  await page.goto("/whatsapp");

  const body = page.locator("body");
  await expect(body).not.toContainText(DOCTOR_A_PHONE_NUMBER_ID);
  await expect(body).not.toContainText(DOCTOR_A_DISPLAY_NUMBER);
  await expect(body).not.toContainText("Doctor A Clinic");
});

/**
 * The access token lives in a table no RLS policy can reach. This checks the
 * property that actually matters to a doctor: it is not in the page.
 */
test("no provider credential is rendered to the browser", async ({ page }) => {
  await signIn(page, DOCTOR_A);
  await page.goto("/whatsapp");

  const html = await page.content();

  expect(html).not.toContain("SYNTHETIC_TOKEN_NOT_A_REAL_CREDENTIAL");
  expect(html).not.toContain("access_token");
});
