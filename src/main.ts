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
import { bestGameResult, clearGameResults, listGameResults, type GameResult } from "./game-results";
import { hasGameSave } from "./game-state";
import { initializePwa } from "./pwa";
import { playSound, unlockSound } from "./sound";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing app root");

let unmountGame: (() => void) | null = null;
let dashboardScope: MountScope | null = null;
let gameScope: MountScope | null = null;
let confirmCleanup: (() => void) | null = null;
let historyCleanup: (() => void) | null = null;

const page = el("main", { className: "app-shell center-screen" });
const appearanceControl = createAppearanceControl();
const workspace = el("section", { className: "workspace center-screen" });

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
  history.addEventListener("click", () => showGameHistory(game));
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
  showGameHistory(game, result);
}

function showGameHistory(game: GameDefinition, highlight?: GameResult): void {
  historyCleanup?.();
  let clearArmed = false;
  const results = listGameResults(game.id);
  const dialog = el("dialog", {
    className: "history-dialog",
    ariaLabel: `${game.name} result history`,
  });
  const panel = el("div", { className: "history-dialog__panel surface theme-" + game.theme });
  panel.tabIndex = -1;
  const title = el("h2", {
    className: "history-dialog__title",
    text: highlight ? "Result saved" : `${game.name} history`,
  });
  const details = el("div", { className: "history-dialog__details" });
  const historyScroll = el("div", { className: "history-dialog__scroll" });
  const actions = el("div", { className: "history-dialog__actions cluster" });
  const clear = button("Clear", "pill surface interactive");
  const close = button("Close", "pill surface interactive");
  const previousFocus =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;

  if (highlight) details.append(resultSummary(highlight));
  const best = bestSummaryText(game.id);
  if (best) details.append(el("p", { className: "history-dialog__best", text: best }));
  historyScroll.append(resultList(results));
  clear.disabled = results.length === 0;
  clear.addEventListener("click", () => {
    if (!clearArmed) {
      clearArmed = true;
      clear.textContent = "Confirm clear";
      clear.dataset.danger = "true";
      return;
    }
    clearGameResults(game.id);
    playSound("uiToggle");
    closeDialog();
  });
  close.addEventListener("click", closeDialog);
  document.addEventListener("keydown", onModalDocumentKeyDown, { capture: true });
  dialog.addEventListener("click", onModalBackdropClick);
  dialog.addEventListener("keydown", onModalKeyDown);
  dialog.addEventListener("cancel", (dialogEvent) => {
    dialogEvent.preventDefault();
    closeDialog();
  });
  actions.append(clear, close);
  panel.append(title, details, historyScroll, actions);
  dialog.append(panel);
  document.body.append(dialog);
  historyCleanup = closeDialog;
  dialog.setAttribute("aria-modal", "true");
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  focusHistoryTop();
  requestAnimationFrame(focusHistoryTop);

  function onModalDocumentKeyDown(event: KeyboardEvent): void {
    const key = event.key.toLowerCase();
    if (key !== "escape" && key !== "n") return;
    event.preventDefault();
    event.stopPropagation();
    closeDialog();
  }

  function onModalBackdropClick(event: MouseEvent): void {
    if (event.target === dialog) closeDialog();
  }

  function onModalKeyDown(event: KeyboardEvent): void {
    event.stopPropagation();
  }

  function focusHistoryTop(): void {
    if (!dialog.isConnected) return;
    panel.scrollTop = 0;
    historyScroll.scrollTop = 0;
    panel.focus({ preventScroll: true });
  }

  function closeDialog(): void {
    if (historyCleanup !== closeDialog) return;
    historyCleanup = null;
    document.removeEventListener("keydown", onModalDocumentKeyDown, { capture: true });
    if (dialog.open) dialog.close();
    dialog.remove();
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  }
}

function resultSummary(result: GameResult): HTMLElement {
  const summary = el("div", { className: "history-dialog__summary" });
  summary.append(
    el("strong", { text: formatOutcome(result.outcome) }),
    el("span", { text: resultDetails(result).join(" · ") || "Result recorded" }),
  );
  return summary;
}

function resultList(results: GameResult[]): HTMLElement {
  if (results.length === 0) return el("p", { className: "muted", text: "No results yet." });
  const list = el("ol", { className: "history-list" });
  results.slice(0, 10).forEach((result) => {
    const item = el("li", { className: "history-list__item" });
    item.append(
      el("span", { className: "history-list__main", text: formatOutcome(result.outcome) }),
      el("span", { className: "history-list__detail", text: resultDetails(result).join(" · ") }),
      el("time", { className: "history-list__time", text: formatDate(result.finishedAt) }),
    );
    list.append(item);
  });
  return list;
}

function bestSummaryText(gameId: string): string | null {
  const config = bestConfig(gameId);
  const result = bestGameResult(gameId, config.metric, config.direction);
  const value = result?.[config.metric];
  return typeof value === "number"
    ? `Best ${config.label}: ${formatMetric(config.metric, value)}`
    : null;
}

function bestConfig(gameId: string): {
  metric: "score" | "moves" | "durationMs" | "level";
  direction: "max" | "min";
  label: string;
} {
  if (gameId === "memory") return { metric: "moves", direction: "min", label: "moves" };
  if (gameId === "minesweeper") return { metric: "durationMs", direction: "min", label: "time" };
  if (gameId === "connect4" || gameId === "tic-tac-toe")
    return { metric: "moves", direction: "min", label: "moves" };
  return { metric: "score", direction: "max", label: "score" };
}

function resultDetails(result: GameResult): string[] {
  const details: string[] = [];
  if (typeof result.score === "number")
    details.push(`Score ${formatMetric("score", result.score)}`);
  if (typeof result.moves === "number")
    details.push(`${formatMetric("moves", result.moves)} moves`);
  if (typeof result.level === "number")
    details.push(`Level ${formatMetric("level", result.level)}`);
  if (typeof result.durationMs === "number")
    details.push(formatMetric("durationMs", result.durationMs));
  if (result.difficulty) details.push(result.difficulty);
  return details;
}

function formatMetric(metric: "score" | "moves" | "durationMs" | "level", value: number): string {
  if (metric === "durationMs") return formatDuration(value);
  return new Intl.NumberFormat().format(value);
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function formatOutcome(outcome: GameResult["outcome"]): string {
  if (outcome === "won") return "Won";
  if (outcome === "lost") return "Lost";
  if (outcome === "draw") return "Draw";
  return "Completed";
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(
    date,
  );
}

function cleanupGame(): void {
  confirmCleanup?.();
  confirmCleanup = null;
  historyCleanup?.();
  historyCleanup = null;
  gameScope?.cleanup();
  gameScope = null;
  dashboardScope?.cleanup();
  dashboardScope = null;
  unmountGame?.();
  unmountGame = null;
}
