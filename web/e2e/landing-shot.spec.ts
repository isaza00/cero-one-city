import { test } from "@playwright/test";

test("landing shot", async ({ page }) => {
  await page.goto("/");
  await page.waitForTimeout(2500);
  await page.screenshot({ path: "e2e/screenshots/0-landing.png" });
});
