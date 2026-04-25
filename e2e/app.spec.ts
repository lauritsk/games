import { expect, test, type Locator, type Page } from "@playwright/test";

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

async function expectElementsNotToOverlap(a: Locator, b: Locator): Promise<void> {
  const aBox = await a.boundingBox();
  const bBox = await b.boundingBox();
  expect(aBox).not.toBeNull();
  expect(bBox).not.toBeNull();

  const overlaps =
    aBox!.x < bBox!.x + bBox!.width &&
    aBox!.x + aBox!.width > bBox!.x &&
    aBox!.y < bBox!.y + bBox!.height &&
    aBox!.y + aBox!.height > bBox!.y;
  expect(overlaps).toBe(false);
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

test("game header controls do not overlap the appearance toggle", async ({ page }) => {
  await openGame(page, "Tic-Tac-Toe");

  const history = page.getByRole("button", { name: "History" });
  const appearance = page.getByRole("radiogroup", { name: "Color theme" });
  await expect(history).toBeVisible();
  await expect(appearance).toBeVisible();

  await expectElementsNotToOverlap(history, appearance);
  await page.evaluate(() => window.assertNoClientErrors());
});

test("mobile game navigation remains tappable below the appearance toggle", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await openGame(page, "Tic-Tac-Toe");

  const appearance = page.getByRole("radiogroup", { name: "Color theme" });
  const history = page.getByRole("button", { name: "History" });
  const leaderboard = page.getByRole("button", { name: "Leaderboard" });
  await expect(appearance).toBeVisible();
  await expect(history).toBeVisible();
  await expect(leaderboard).toBeVisible();

  await expectElementsNotToOverlap(history, appearance);
  await expectElementsNotToOverlap(leaderboard, appearance);
  await leaderboard.click();
  await expect(page.getByRole("dialog", { name: "Tic-Tac-Toe leaderboard" })).toBeVisible();
  await page.evaluate(() => window.assertNoClientErrors());
});

test("minesweeper keeps mobile cells touch sized", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await openGame(page, "Minesweeper");

  const firstCell = page.locator(".mine-cell").first();
  await expect(firstCell).toBeVisible();
  const box = await firstCell.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await page.evaluate(() => window.assertNoClientErrors());
});

test("leaderboard navigation opens public leaderboard games", async ({ page }) => {
  await openGame(page, "Minesweeper");
  await page.getByRole("button", { name: "Leaderboard" }).click();
  const dialog = page.getByRole("dialog", { name: "Minesweeper leaderboard" });
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toContainText("Loading leaderboard…");
  await expect(dialog).not.toContainText("Invalid leaderboard query");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();

  await openGame(page, "Memory");
  await page.getByRole("button", { name: "Leaderboard" }).click();
  const memoryDialog = page.getByRole("dialog", { name: "Memory leaderboard" });
  await expect(memoryDialog).toBeVisible();
  await expect(memoryDialog).not.toContainText("Invalid leaderboard query");
  await memoryDialog.getByRole("button", { name: "Close", exact: true }).click();

  await openGame(page, "Tic-Tac-Toe");
  await page.getByRole("button", { name: "Leaderboard" }).click();
  const ticTacToeDialog = page.getByRole("dialog", { name: "Tic-Tac-Toe leaderboard" });
  await expect(ticTacToeDialog).toBeVisible();
  await expect(ticTacToeDialog).not.toContainText("Invalid leaderboard query");
  await ticTacToeDialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.evaluate(() => window.assertNoClientErrors());
});

test("plays a live Tic-Tac-Toe room across two browsers", async ({ page, browser }) => {
  await openGame(page, "Tic-Tac-Toe");
  await page.getByRole("button", { name: "Play online" }).click();
  await page.getByRole("button", { name: "Create room" }).click();
  const code = (await page.locator(".multiplayer-dialog__code").textContent())?.trim();
  expect(code).toMatch(/^[2-9A-HJKMNP-Z]{6}$/);

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await watchForClientErrors(guest);
  await openGame(guest, "Tic-Tac-Toe");
  await guest.getByRole("button", { name: "Play online" }).click();
  await guest.getByLabel("Room code").fill(code!);
  await guest.getByRole("button", { name: "Join room" }).click();
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Start", exact: true }).click();

  await expect(page.getByText("Your turn")).toBeVisible({ timeout: 7000 });
  await page.getByRole("button", { name: "Row 2, column 2, empty" }).click();
  await expect(guest.getByRole("button", { name: "Row 2, column 2, X" })).toHaveText("X");
  await guest.getByRole("button", { name: "Row 1, column 1, empty" }).click();
  await expect(page.getByRole("button", { name: "Row 1, column 1, O" })).toHaveText("O");

  await page.getByRole("button", { name: "Row 2, column 1, empty" }).click();
  await guest.getByRole("button", { name: "Row 1, column 2, empty" }).click();
  await page.getByRole("button", { name: "Row 2, column 3, empty" }).click();
  await expect(page.getByText("You win")).toBeVisible();
  await expect(guest.getByText("Opponent wins")).toBeVisible();

  await guest.evaluate(() => window.assertNoClientErrors());
  await guestContext.close();
  await page.evaluate(() => window.assertNoClientErrors());
});

test("syncs a live Connect 4 room across two browsers", async ({ page, browser }) => {
  await openGame(page, "Connect 4");
  await page.getByRole("button", { name: "Play online" }).click();
  await page.getByRole("button", { name: "Create room" }).click();
  const code = (await page.locator(".multiplayer-dialog__code").textContent())?.trim();
  expect(code).toMatch(/^[2-9A-HJKMNP-Z]{6}$/);

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await watchForClientErrors(guest);
  await openGame(guest, "Connect 4");
  await guest.getByRole("button", { name: "Play online" }).click();
  await guest.getByLabel("Room code").fill(code!);
  await guest.getByRole("button", { name: "Join room" }).click();
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Start", exact: true }).click();

  await expect(page.getByText("Your turn")).toBeVisible({ timeout: 7000 });
  await page.getByRole("button", { name: "Row 1, column 4, empty" }).click();
  await expect(guest.getByRole("button", { name: "Row 6, column 4, Red disc" })).toBeVisible();
  await guest.getByRole("button", { name: "Row 1, column 5, empty" }).click();
  await expect(page.getByRole("button", { name: "Row 6, column 5, Gold disc" })).toBeVisible();

  await guest.evaluate(() => window.assertNoClientErrors());
  await guestContext.close();
  await page.evaluate(() => window.assertNoClientErrors());
});

test("submits one eligible leaderboard result flow", async ({ page }) => {
  let submittedEntry: unknown;
  await page.route("**/api/leaderboard**", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      expect(body.gameId).toBe("tictactoe");
      expect(body.streak).toBe(2);
      expect(body.metadata).toEqual({ mode: "bot", winner: "X" });
      submittedEntry = {
        id: "leaderboard-e2e",
        gameId: "tictactoe",
        username: body.username,
        difficulty: body.difficulty,
        outcome: body.outcome,
        metric: "streak",
        metricValue: body.streak,
        streak: body.streak,
        metadata: body.metadata,
        createdAt: new Date().toISOString(),
        rank: 1,
      };
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ok: true, rank: 1, entry: submittedEntry }),
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, entries: submittedEntry ? [submittedEntry] : [] }),
    });
  });

  await openGame(page, "Tic-Tac-Toe");
  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent("games:result-recorded", {
        detail: {
          id: "result-submit-e2e",
          runId: "run-submit-e2e",
          gameId: "tictactoe",
          outcome: "won",
          difficulty: "Hard",
          moves: 5,
          streak: 2,
          metadata: { mode: "bot", winner: "X" },
          finishedAt: new Date().toISOString(),
        },
      }),
    );
  });

  await page.getByRole("button", { name: "Submit to leaderboard" }).click();
  const dialog = page.getByRole("dialog", { name: "Tic-Tac-Toe leaderboard" });
  await expect(dialog).toBeVisible();
  await dialog.getByPlaceholder("Display name").fill("ACE");
  await dialog.getByRole("button", { name: "Submit Streak 2 wins" }).click();

  await expect(dialog).toContainText("Rank #1");
  await expect(dialog).toContainText("ACE");
  await expect(dialog).toContainText("2 wins");
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

test("result history dismisses when clicking outside the popup", async ({ page }) => {
  await openGame(page, "Tic-Tac-Toe");
  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent("games:result-recorded", {
        detail: {
          id: "result-e2e",
          runId: "run-e2e",
          gameId: "tictactoe",
          outcome: "won",
          difficulty: "Medium",
          moves: 5,
          finishedAt: new Date().toISOString(),
        },
      }),
    );
  });

  const dialog = page.getByRole("dialog", { name: "Tic-Tac-Toe result history" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("heading", { name: "Result saved" }).click();
  await expect(dialog).toBeVisible();

  await page.mouse.click(8, 8);
  await expect(dialog).toBeHidden();
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

test("arcade games pause when the page loses focus", async ({ page }) => {
  await openGame(page, "Tetris");
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByLabel("Game status")).toContainText(/L1/);

  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.getByLabel("Game status")).toContainText("Paused");
  await expect(page.getByRole("button", { name: /Paused.*press P to resume/i })).toBeVisible();

  await page.getByRole("button", { name: /Paused.*press P to resume/i }).click();
  await expect(page.getByLabel("Game status")).toContainText(/L1/);
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
