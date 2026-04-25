import { expect, test, type Page } from "@playwright/test";

declare global {
  interface Window {
    assertNoClientErrors(): void;
  }
}

async function watchForClientErrors(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.exposeFunction("assertNoClientErrors", () => {
    expect(errors).toEqual([]);
  });
}

async function openGame(page: Page, name: string): Promise<void> {
  await page.goto("/");
  await page.getByRole("link", { name }).click();
  await expect(page.getByRole("link", { name: "← Selection" })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await watchForClientErrors(page);
});

test("appearance defaults to system and can persist explicit choice", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-appearance", "dark");
  await expect(page.getByRole("radio", { name: "System" })).toHaveAttribute("aria-checked", "true");

  await page.getByRole("radio", { name: "Light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-appearance", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-appearance", "light");

  await page.getByRole("radio", { name: "System" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-appearance", "dark");
  await page.evaluate(() => window.assertNoClientErrors());
});

test("reset confirmation can cancel or accept an active game reset", async ({ page }) => {
  await openGame(page, "Tic-Tac-Toe");

  const center = page.locator(".ttt-cell").nth(4);
  await center.click();
  await expect(center).toHaveText("X");

  await page.getByRole("button", { name: "New" }).click();
  await expect(page.getByRole("dialog", { name: "Start a new game?" })).toBeVisible();
  await page.getByRole("button", { name: "No" }).click();
  await expect(page.getByRole("dialog", { name: "Start a new game?" })).toBeHidden();
  await expect(center).toHaveText("X");

  await page.getByRole("button", { name: "New" }).click();
  await page.getByRole("button", { name: "Yes" }).click();
  await expect(page.getByRole("button", { name: "Row 2, column 2, empty" })).toHaveText("");
  await page.evaluate(() => window.assertNoClientErrors());
});

test("keyboard routing selects games, plays current game, and protects escape navigation", async ({
  page,
}) => {
  await page.goto("/");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/minesweeper$/);

  await page.goto("/#/tictactoe");
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Row 2, column 2, X" })).toHaveText("X");

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Leave this game?" })).toBeVisible();
  await page.keyboard.press("n");
  await expect(page).toHaveURL(/#\/tictactoe$/);
  await page.evaluate(() => window.assertNoClientErrors());
});

test("bot timers are cleaned up when leaving games", async ({ page }) => {
  await openGame(page, "Tic-Tac-Toe");
  await page.getByRole("button", { name: "Row 2, column 2, empty" }).click();
  await page.goto("/");
  await page.waitForTimeout(400);
  await expect(page.getByRole("link", { name: "Tic-Tac-Toe" })).toBeVisible();

  await openGame(page, "Connect 4");
  await page.getByRole("button", { name: /Row 6, column 4, empty/i }).click();
  await page.goto("/");
  await page.waitForTimeout(500);
  await expect(page.getByRole("link", { name: "Connect 4" })).toBeVisible();
  await page.evaluate(() => window.assertNoClientErrors());
});

test("difficulty changes during active games reset to the selected difficulty", async ({
  page,
}) => {
  await openGame(page, "Snake");
  await page.keyboard.press("Space");
  await expect(page.getByLabel("Game status")).toContainText(/Length|Ready/);

  await page.keyboard.press("+");
  await expect(page.getByRole("button", { name: "Hard" })).toBeVisible();
  await expect(page.getByLabel("Game status")).toHaveText("Ready · Fatal walls");
  await expect(page.locator(".snake-cell")).toHaveCount(22 * 22);
  await page.evaluate(() => window.assertNoClientErrors());
});

test("snake interval stops after route cleanup", async ({ page }) => {
  await openGame(page, "Snake");
  await page.keyboard.press("Space");
  await expect(page.getByLabel("Game status")).toContainText(/Length|Ready/);
  await page.goto("/");
  await page.waitForTimeout(350);
  await expect(page.getByRole("link", { name: "Snake" })).toBeVisible();
  await page.evaluate(() => window.assertNoClientErrors());
});

test("memory pending mismatch timeout is cleared on reset and route cleanup", async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0;
  });
  await openGame(page, "Memory");

  const cards = page.locator(".memory-card");
  await cards.nth(0).click();
  await cards.nth(1).click();
  await expect(cards.nth(0)).toHaveText("★");
  await expect(cards.nth(1)).toHaveText("◆");

  await page.getByRole("button", { name: "New" }).click();
  await page.getByRole("button", { name: "Yes" }).click();
  await expect(cards.nth(0)).toHaveText("?");

  await cards.nth(0).click();
  await cards.nth(1).click();
  await page.goto("/");
  await page.waitForTimeout(800);
  await expect(page.getByRole("link", { name: "Memory" })).toBeVisible();
  await page.evaluate(() => window.assertNoClientErrors());
});
