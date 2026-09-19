import { expect, test } from "@playwright/test";

/**
 * The thread against the real local stack.
 *
 * The component tests cover merging and rendering with a mocked action. These
 * exercise the real server action, the real cursor and the real database — the
 * path where a pagination bug would actually lose or duplicate a patient's
 * message.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";

const DOCTOR_A = { email: "doctor-a@example.test", password: "devpassword123" };
const DOCTOR_B = { email: "doctor-b@example.test", password: "devpassword123" };

/** Doctor A's seeded thread: 70 messages plus a 3-message same-second burst. */
const CONVERSATION_A = "55555555-5555-5555-5555-555555555555";
const TOTAL_MESSAGES = 73;

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

/** Message bodies as rendered, in document order. */
async function renderedMessages(page: import("@playwright/test").Page) {
  return page
    .locator("li article p")
    .first()
    .isVisible()
    .then(() =>
      page
        .locator("li article")
        .evaluateAll((nodes) =>
          nodes.map((node) =>
            (node.textContent ?? "").replace(/\d{1,2}:\d{2}.*$/, "").trim(),
          ),
        ),
    );
}

test("a thread reads oldest to newest", async ({ page }) => {
  await signIn(page, DOCTOR_A);
  await page.goto(`/conversations/${CONVERSATION_A}`);

  const messages = await renderedMessages(page);

  expect(messages.length).toBeGreaterThan(1);
  // The newest message is at the bottom, as a conversation reads.
  expect(messages.at(-1)).toContain("70");
});

test("incoming and outgoing messages are distinguishable without colour", async ({
  page,
}) => {
  await signIn(page, DOCTOR_A);
  await page.goto(`/conversations/${CONVERSATION_A}`);

  await expect(page.getByLabel("Message from patient").first()).toBeVisible();
  await expect(page.getByLabel("Message you sent").first()).toBeVisible();
});

/**
 * The assertion the whole cursor design exists for.
 *
 * Walking the thread to its start must surface every message exactly once. The
 * seeded burst of three messages sharing one second sits inside the range, so a
 * timestamp-only cursor would drop or repeat rows here.
 */
test("loading the whole history yields every message exactly once", async ({ page }) => {
  await signIn(page, DOCTOR_A);
  await page.goto(`/conversations/${CONVERSATION_A}`);

  const loadOlder = page.getByRole("button", { name: /load older messages/i });
  await expect(loadOlder).toBeVisible();

  // Bounded so a broken cursor fails the test rather than looping forever.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!(await loadOlder.isVisible().catch(() => false))) break;
    await loadOlder.click();
    await expect(loadOlder)
      .toBeEnabled({ timeout: 10_000 })
      .catch(() => undefined);
  }

  await expect(page.getByText(/beginning of the conversation/i)).toBeVisible();
  await expect(loadOlder).toBeHidden();

  const messages = await renderedMessages(page);

  expect(messages).toHaveLength(TOTAL_MESSAGES);
  expect(new Set(messages).size).toBe(messages.length);
  expect(messages[0]).toContain("number 1");
});

/**
 * These assert the rendered outcome rather than the HTTP status.
 *
 * The route streams, because it has a `loading.tsx` skeleton, so the response
 * commits `200` before the server component reaches `notFound()`. The not-found
 * page still renders and no data leaks — which is what a reader experiences —
 * but the status line is already sent by then. Asserting on `.status()` here
 * would test Next's streaming behaviour, not ours.
 */
async function expectNotFoundPage(page: import("@playwright/test").Page) {
  await expect(page.getByRole("heading", { name: /page not found/i })).toBeVisible();
  await expect(page.locator("li article")).toHaveCount(0);
}

test("a conversation belonging to another workspace is not found", async ({ page }) => {
  await signIn(page, DOCTOR_B);
  await page.goto(`/conversations/${CONVERSATION_A}`);

  await expectNotFoundPage(page);
  // Nothing about doctor A's patient may leak, not even the contact name.
  await expect(page.locator("body")).not.toContainText("Sam Patient");
  await expect(page.locator("body")).not.toContainText("15550000001");
});

test("a conversation id that does not exist is not found", async ({ page }) => {
  await signIn(page, DOCTOR_A);
  await page.goto("/conversations/00000000-0000-0000-0000-000000000000");

  await expectNotFoundPage(page);
});

// A non-uuid fails at parse time in Postgres; it must not surface as a crash.
test("a malformed conversation id is not found rather than a server error", async ({
  page,
}) => {
  await signIn(page, DOCTOR_A);
  await page.goto("/conversations/not-a-uuid");

  await expectNotFoundPage(page);
  await expect(page.locator("body")).not.toContainText(/something went wrong/i);
});

test("the thread has no horizontal overflow on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page, DOCTOR_A);
  await page.goto(`/conversations/${CONVERSATION_A}`);

  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );

  expect(overflows).toBe(false);
});
