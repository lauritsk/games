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
  required,
  syncChildren,
  type GameDefinition,
  type MountScope,
} from "./core";
import {
  getAppearanceMode,
  getResolvedAppearance,
  initializeAppearance,
  onAppearanceChange,
  setAppearanceMode,
  type AppearanceMode,
} from "./appearance";
import { games } from "./games";
import { bestSummaryText } from "./game-result-format";
import { type GameResult } from "./game-results";
import { hasGameSave } from "./game-state";
import { createGameHistoryDialog } from "./history-dialog";
import { initializePwa } from "./pwa";
import { playSound, unlockSound } from "./sound";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing app root");

let unmountGame: (() => void) | null = null;
let dashboardScope: MountScope | null = null;
let gameScope: MountScope | null = null;
let confirmCleanup: (() => void) | null = null;

const page = el("main", { className: "app-shell center-screen" });
const appearanceControl = createAppearanceControl();
const workspace = el("section", { className: "workspace center-screen" });
const historyDialog = createGameHistoryDialog();

page.append(appearanceControl, workspace);
app.append(page);

window.addEventListener("hashchange", renderRoute);
window.addEventListener("games:result-recorded", onResultRecorded);
window.addEventListener("pointerdown", unlockSound, { capture: true });
window.addEventListener("keydown", unlockSound, { capture: true });
initializeAppearance();
initializePwa();
onAppearanceChange(() => {
  updateAppearanceControl(appearanceControl);
  updateThemeColor();
});
renderRoute();

function createAppearanceControl(): HTMLElement {
  const control = el("div", { className: "appearance-toggle surface", ariaLabel: "Color theme" });
  control.setAttribute("role", "radiogroup");
  (["system", "light", "dark"] satisfies AppearanceMode[]).forEach((mode) => {
    const option = el("button", {
      className: "appearance-toggle__option interactive",
      text: labelAppearanceMode(mode),
      type: "button",
    });
    option.dataset.mode = mode;
    option.setAttribute("role", "radio");
    option.addEventListener("click", () => setAppearanceMode(mode));
    control.append(option);
  });
  updateAppearanceControl(control);
  return control;
}

function updateAppearanceControl(control: HTMLElement): void {
  const currentMode = getAppearanceMode();
  control.querySelectorAll<HTMLButtonElement>("button[data-mode]").forEach((option) => {
    const selected = option.dataset.mode === currentMode;
    option.dataset.selected = String(selected);
    option.setAttribute("aria-checked", String(selected));
    option.title = currentMode === "system" ? `System: ${getResolvedAppearance()}` : "";
  });
}

function labelAppearanceMode(mode: AppearanceMode): string {
  if (mode === "system") return "System";
  if (mode === "light") return "Light";
  return "Dark";
}

function updateThemeColor(): void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) return;
  const theme = (document.body.dataset.theme ?? "deep-cave") as GameDefinition["theme"];
  meta.content = themeColor(theme, getResolvedAppearance());
}

function themeColor(theme: GameDefinition["theme"], appearance: "light" | "dark"): string {
  const colors = {
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
  return colors[appearance][theme];
}

function renderRoute(): void {
  const game = getRouteGame();
  document.body.dataset.theme = game?.theme ?? "deep-cave";
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
      card.dataset.selected = String(index === selectedIndex);
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
  link.dataset.selected = "false";
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
  const nav = el("div", { className: "game-screen__nav cluster" });
  const back = el("a", { className: "back-button pill surface interactive", text: "← Selection" });
  back.href = "#/";
  const history = button("History", "pill surface interactive");
  history.addEventListener("click", () => historyDialog.show(game));
  nav.append(back, history);
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

function cleanupGame(): void {
  confirmCleanup?.();
  confirmCleanup = null;
  historyDialog.close();
  gameScope?.cleanup();
  gameScope = null;
  dashboardScope?.cleanup();
  dashboardScope = null;
  unmountGame?.();
  unmountGame = null;
}
