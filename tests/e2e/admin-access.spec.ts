import { expect, test } from "@playwright/test";

/**
 * Who may reach `/admin`.
 *
 * Until this task the route was open to anyone with a session — the largest
 * authorization gap in the project. These tests exist so it cannot quietly
 * reopen: a layout guard is one `export default` away from being edited out,
 * and nothing else in the suite would notice.
 *
 * The denial is a **404, not a 403**, on purpose. A 403 confirms the route
 * exists and that something worth attacking sits behind it.
 *
 * Uses the accounts from supabase/seed.sql, neither of which is a platform
 * admin. That is the point: the default is closed, and a seeded admin would
 * make this suite pass for the wrong reason.
 *
 * **If these fail, check `platform_admins` before suspecting the guard.**
 * Granting yourself admin locally to look at the page — which the migration's
 * footer explains how to do — makes the account legitimately an administrator,
 * and these tests then correctly observe that it can reach `/admin`.
 * `npm run db:reset` clears it.
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

for (const account of [DOCTOR_A, DOCTOR_B]) {
  test(`${account.email} cannot reach /admin`, async ({ page }) => {
    await signIn(page, account);

    await page.goto("/admin");

    const hint = `${account.email} reached /admin — is there a leftover platform_admins row? run \`npm run db:reset\``;

    await expect(
      page.getByRole("heading", { name: /page not found/i }),
      hint,
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /administration/i }),
      hint,
    ).toHaveCount(0);
  });

  test(`${account.email} is not shown the admin navigation`, async ({ page }) => {
    await signIn(page, account);

    // The workspace links are present, so this asserts the admin one is absent
    // rather than that the sidebar failed to render at all.
    //
    // `exact` matters: the sidebar's brand link reads "Doctor WhatsApp Patient
    // conversations", which matches a substring search for "Conversations" and
    // makes the locator ambiguous.
    await expect(
      page.getByRole("link", { name: "Conversations", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Admin", exact: true }),
      `${account.email} was shown the admin link — leftover platform_admins row? run \`npm run db:reset\``,
    ).toHaveCount(0);
  });
}

// A signed-out visitor must be redirected by the proxy before the layout's
// role check is ever reached — two independent gates, not one.
test("a signed-out visitor is redirected away from /admin", async ({ page }) => {
  await page.goto("/admin");

  await expect(page).toHaveURL(/\/sign-in/);
  expect(new URL(page.url()).searchParams.get("next")).toBe("/admin");
});
