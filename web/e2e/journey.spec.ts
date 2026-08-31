// Full player journey through the real UI against the live backend:
// register -> create agent -> connect (mock model) -> practice match ->
// watch it live on the Pixi map -> results -> replay with fog -> leaderboard.

import { expect, test } from "@playwright/test";
import fs from "fs";

const SHOTS = "e2e/screenshots";
const stamp = Date.now();
const email = `pw-${stamp}@example.com`;
const agentName = `pixelfist-${stamp % 100000}`;

test.beforeAll(() => {
  fs.mkdirSync(SHOTS, { recursive: true });
});

test("full journey with screenshots", async ({ page }) => {
  // ---------------------------------------------------------------- landing
  await page.goto("/");
  await expect(page.getByText("CERO ONE CITY")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("AI agents");

  // --------------------------------------------------------------- register
  await page.goto("/register");
  const inputs = page.locator("form input");
  await inputs.nth(0).fill(email);
  await inputs.nth(1).fill("Playwright Owner");
  await inputs.nth(2).fill("password123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/onboarding/);
  await expect(page.getByText("Welcome, owner")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/1-onboarding.png` });

  // ------------------------------------------------------------ create agent
  await page.getByRole("button", { name: "Create agent" }).click();
  await expect(page).toHaveURL(/agents\/new/);
  await page.getByPlaceholder("rustbucket-9000").fill(agentName);
  await page.locator(".lineage-card", { hasText: "Forge" }).click();
  await page.getByPlaceholder("Be cautious. Prioritize metal over energy...")
    .fill("Boom to firmware v2, then push with launchers and riders. "
          + "Protect the workers. Never trust a truce longer than five turns.");
  await page.screenshot({ path: `${SHOTS}/2-create-agent.png` });
  await page.getByRole("button", { name: "Create agent" }).click();

  // -------------------------------------------------- connect a (mock) model
  await expect(page).toHaveURL(/connect/);
  await page.locator("select").first().selectOption("mock");
  await page.locator("select").nth(1).selectOption("boom");
  await page.getByRole("button", { name: /Test call/ }).click();
  await expect(page.getByText("test OK")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/3-connect-model.png` });

  // ------------------------------------------------------- start a practice
  await page.getByText("Go to the agent panel").click();
  await expect(page.getByText(agentName)).toBeVisible();
  await page.getByRole("button", { name: "Practice" }).click();
  await expect(page).toHaveURL(/matches\//, { timeout: 30_000 });

  // ------------------------------------------------------- watch it live
  await expect(page.locator(".map-host canvas")).toBeVisible({ timeout: 30_000 });
  // Wait until the mid-game (armies on the move), then shoot the board.
  await expect(page.getByRole("heading", { name: /turn (1[5-9]|[2-4][0-9])\// }))
    .toBeVisible({ timeout: 150_000 });
  await expect(page.locator(".feed .line").first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/4-live-match.png` });

  // ---------------------------------------- match ends (Results button shows)
  await page.getByRole("button", { name: "Results" }).click({ timeout: 180_000 });
  await expect(page).toHaveURL(/result/);
  await expect(page.getByText(/Match result/)).toBeVisible();
  await expect(page.locator(".podium .slot").first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/5-results.png` });

  // ------------------------------------------------------------------ replay
  await page.getByRole("button", { name: "Watch replay" }).click();
  await expect(page).toHaveURL(/replay/);
  await expect(page.locator(".map-host canvas")).toBeVisible();
  const slider = page.locator('input[type="range"]');
  await slider.fill("25");
  await expect(page.getByRole("heading", { name: /turn 25\// })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/6-replay-godview.png` });
  // Fog of war: view the board the way player 0 saw it.
  await page.locator("select").last().selectOption("0");
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/7-replay-fog.png` });

  // -------------------------------------------------------------- leaderboard
  await page.goto("/leaderboard");
  await expect(page.getByText(/League · season/)).toBeVisible();
  await expect(page.locator("tbody tr").first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/8-leaderboard.png` });

  // ------------------------------------------------------ landing, signed in
  await page.goto("/");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${SHOTS}/0-landing.png` });
});
