import { expect, test } from "@playwright/test";

test("root page renders without a runtime error", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: /doctor whatsapp platform/i }),
  ).toBeVisible();
  expect(consoleErrors).toEqual([]);
});
