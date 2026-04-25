import {
  button,
  clearNode,
  confirmChoice,
  createMountScope,
  el,
  isGameInProgress,
  Keys,
  matchesKey,
  onDocumentKeyDown,
  pillButton,
  required,
  setIconLabel,
  syncChildren,
  setSelected,
  type GameDefinition,
  type MountScope,
} from "@shared/core";
import { getResolvedAppearance, initializeAppearance, onAppearanceChange } from "@ui/appearance";
import { createAppearanceControl, updateAppearanceControl } from "@ui/appearance-control";
import { games } from "@games";
import { bestSummaryText } from "@features/results/game-result-format";
import { type GameResult } from "@features/results/game-results";
import { hasGameSave } from "@games/shared/game-state";
import { createGameHistoryDialog } from "@features/results/history-dialog";
import { createLeaderboardDialog } from "@features/leaderboard/leaderboard-dialog";
import { hasLeaderboard, isLeaderboardEligible } from "@features/leaderboard/leaderboard";
import { initializePwa } from "@ui/pwa";
import { playSound, unlockSound } from "@ui/sound";
import { initializeSync } from "@features/sync/sync";

const defaultTheme = "deep-cave" satisfies GameDefinition["theme"];
const themeColors = {
  dark: {
    "deep-cave": "#120d0a",
    "deep-ocean": "#061521",
    "outer-space": "#090716",
    "deep-forest": "#07120d",
  },
  light: {
    "deep-cave": "#fff4e6",
    "deep-ocean": "#e7f7ff",
    "outer-space": "#f1efff",
    "deep-forest": "#edfbe8",
  },
} satisfies Record<"light" | "dark", Record<GameDefinition["theme"], string>>;

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing app root");

let unmountGame: (() => void) | null = null;
let dashboardScope: MountScope | null = null;
let gameScope: MountScope | null = null;
let confirmCleanup: (() => void) | null = null;

const page = el("main", { className: "app-shell center-screen" });
const appearanceControl = createAppearanceControl();
const workspace = el("section", { className: "workspace center-screen" });
const leaderboardDialog = createLeaderboardDialog();
const historyDialog = createGameHistoryDialog({
  resultActions: (game, result, closeCurrent) => {
    if (!isLeaderboardEligible(result)) return [];
    const submit = pillButton("Submit to leaderboard");
    submit.addEventListener("click", () => {
      closeCurrent();
      leaderboardDialog.show(game, result);
    });
    return [submit];
  },
});

page.append(appearanceControl, workspace);
app.append(page);

window.addEventListener("hashchange", renderRoute);
window.addEventListener("games:result-recorded", onResultRecorded);
window.addEventListener("games:sync-merged", onSyncMerged);
window.addEventListener("pointerdown", unlockSound, { capture: true });
window.addEventListener("keydown", unlockSound, { capture: true });
initializeAppearance();
initializePwa();
initializeSync();
onAppearanceChange(() => {
  updateAppearanceControl(appearanceControl);
  updateThemeColor();
});
renderRoute();

function updateThemeColor(): void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) return;
  const theme = (document.body.dataset.theme ?? defaultTheme) as GameDefinition["theme"];
  meta.content = themeColor(theme, getResolvedAppearance());
}

function themeColor(theme: GameDefinition["theme"], appearance: "light" | "dark"): string {
  return themeColors[appearance][theme];
}

function renderRoute(): void {
  const game = getRouteGame();
  document.body.dataset.theme = game?.theme ?? defaultTheme;
  updateThemeColor();
  dashboardScope?.cleanup();
  dashboardScope = null;
  if (game) renderGame(game);
  else renderDashboard();
}

function getRouteGame(): GameDefinition | null {
  const id = window.location.hash.replace(/^#\/?/, "");
  return id ? (games.find((game) => game.id === id) ?? null) : null;
}

function renderDashboard(): void {
  cleanupGame();
  clearNode(workspace);

  const dashboard = el("section", { className: "dashboard stack center-screen" });
  let selectedIndex = 0;
  const list = el("div", { className: "game-list" });

  renderSelection();
  dashboardScope = createMountScope();
  onDocumentKeyDown(onDashboardKeyDown, dashboardScope);
  dashboard.append(list);
  workspace.append(dashboard);

  function onDashboardKeyDown(event: KeyboardEvent): void {
    const columns = getDashboardColumns(list);
    let nextIndex = selectedIndex;

    if (matchesKey(event, Keys.left)) nextIndex = selectedIndex - 1;
    else if (matchesKey(event, Keys.right)) nextIndex = selectedIndex + 1;
    else if (matchesKey(event, Keys.up))
      nextIndex = moveDashboardVertical(selectedIndex, -1, columns, games.length);
    else if (matchesKey(event, Keys.down))
      nextIndex = moveDashboardVertical(selectedIndex, 1, columns, games.length);
    else if (matchesKey(event, Keys.activate)) {
      event.preventDefault();
      playSound("dashboardSelect");
      window.location.hash = `#/${required(games[selectedIndex]).id}`;
      return;
    } else return;

    event.preventDefault();
    selectedIndex = wrapIndex(nextIndex, games.length);
    playSound("dashboardMove");
    renderSelection();
  }

  function selectDashboardIndex(index: number): boolean {
    if (selectedIndex === index) return false;
    selectedIndex = index;
    return true;
  }

  function renderSelection(): void {
    const cards = syncChildren(list, games.length, (index) => {
      const card = gameCard(required(games[index]));
      card.addEventListener("pointerenter", () => {
        if (!selectDashboardIndex(index)) return;
        playSound("dashboardMove");
        renderSelection();
      });
      card.addEventListener("focus", () => {
        if (!selectDashboardIndex(index)) return;
        playSound("dashboardMove");
        renderSelection();
      });
      return card;
    });
    games.forEach((game, index) => {
      const card = required(cards[index]);
      card.href = `#/${game.id}`;
      updateGameCard(card, game);
      card.className = `game-card surface interactive theme-${game.theme}`;
      setSelected(card, index === selectedIndex);
    });
  }
}

function getDashboardColumns(list: HTMLElement): number {
  const columns = getComputedStyle(list).gridTemplateColumns.split(" ").filter(Boolean).length;
  return Math.max(1, columns);
}

function wrapIndex(index: number, length: number): number {
  return (index + length) % length;
}

function moveDashboardVertical(
  index: number,
  step: 1 | -1,
  columns: number,
  length: number,
): number {
  const verticalOrder = Array.from({ length }, (_, itemIndex) => itemIndex).sort((a, b) => {
    const columnDiff = (a % columns) - (b % columns);
    return columnDiff || Math.floor(a / columns) - Math.floor(b / columns);
  });
  const orderIndex = verticalOrder.indexOf(index);
  return required(verticalOrder[wrapIndex(orderIndex + step, length)]);
}

function gameCard(game: GameDefinition): HTMLAnchorElement {
  const link = el("a", { className: `game-card surface interactive theme-${game.theme}` });
  link.href = `#/${game.id}`;
  updateGameCard(link, game);
  setSelected(link, false);
  link.addEventListener("click", () => playSound("dashboardSelect"));
  return link;
}

function updateGameCard(card: HTMLAnchorElement, game: GameDefinition): void {
  clearNode(card);
  const title = el("span", { className: "game-card__title", text: game.name });
  const meta = el("span", { className: "game-card__meta" });
  if (hasGameSave(game.id))
    meta.append(el("span", { className: "game-card__badge", text: "Saved" }));
  const best = bestSummaryText(game.id);
  if (best) meta.append(el("span", { className: "game-card__stat", text: best }));
  card.append(title);
  if (meta.children.length) card.append(meta);
}

function renderGame(game: GameDefinition): void {
  cleanupGame();
  clearNode(workspace);

  const screen = el("section", { className: "game-screen" });
  const nav = el("header", { className: "game-screen__nav" });
  const back = el("a", { className: "back-button", ariaLabel: "← Selection" });
  back.href = "#/";
  setIconLabel(back, "←", "← Selection");
  const title = el("strong", { className: "game-screen__title", text: game.name });
  const navActions = el("div", { className: "game-screen__nav-actions" });
  const history = button("", "nav-action");
  setIconLabel(history, "⏱", "History");
  history.addEventListener("click", () => historyDialog.show(game));
  navActions.append(history);
  if (hasLeaderboard(game.id)) {
    const leaderboard = button("", "nav-action");
    setIconLabel(leaderboard, "🏆", "Leaderboard");
    leaderboard.addEventListener("click", () => leaderboardDialog.show(game));
    navActions.append(leaderboard);
  }
  nav.append(back, title, navActions);
  const gameHost = el("div", { className: "game-host center-screen" });
  screen.append(nav, gameHost);
  workspace.append(screen);
  unmountGame = game.mount(gameHost);
  gameScope = createMountScope();
  onDocumentKeyDown(onGameKeyDown, gameScope);

  function onGameKeyDown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || confirmCleanup) return;
    event.preventDefault();
    const gameElement = gameHost.querySelector<HTMLElement>(".game");
    if (gameElement && isGameInProgress(gameElement)) {
      confirmCleanup = confirmChoice(
        "Leave this game?",
        () => {
          window.location.hash = "#/";
        },
        () => {
          confirmCleanup = null;
        },
      );
    } else window.location.hash = "#/";
  }
}

function onResultRecorded(event: Event): void {
  const result = (event as CustomEvent<GameResult>).detail;
  const game = getRouteGame();
  if (!game || !result || result.gameId !== game.id) return;
  historyDialog.show(game, result);
}

function onSyncMerged(): void {
  if (!getRouteGame()) renderRoute();
}

function cleanupGame(): void {
  confirmCleanup?.();
  confirmCleanup = null;
  historyDialog.close();
  leaderboardDialog.close();
  gameScope?.cleanup();
  gameScope = null;
  dashboardScope?.cleanup();
  dashboardScope = null;
  unmountGame?.();
  unmountGame = null;
}
