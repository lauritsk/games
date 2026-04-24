import { clearNode, confirmChoice, el, isGameInProgress, Keys, matchesKey, type GameDefinition } from "./core";
import { games } from "./games";
import { playSound, unlockSound } from "./sound";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing app root");

let unmountGame: (() => void) | null = null;
let dashboardKeyCleanup: (() => void) | null = null;
let gameKeyCleanup: (() => void) | null = null;
let confirmCleanup: (() => void) | null = null;

const page = el("main", { className: "app-shell center-screen" });
const workspace = el("section", { className: "workspace center-screen" });

page.append(workspace);
app.append(page);

window.addEventListener("hashchange", renderRoute);
window.addEventListener("pointerdown", unlockSound, { capture: true });
window.addEventListener("keydown", unlockSound, { capture: true });
renderRoute();

function renderRoute(): void {
  const game = getRouteGame();
  document.body.dataset.theme = game?.theme ?? "deep-cave";
  dashboardKeyCleanup?.();
  dashboardKeyCleanup = null;
  game ? renderGame(game) : renderDashboard();
}

function getRouteGame(): GameDefinition | null {
  const id = window.location.hash.replace(/^#\/?/, "");
  return id ? games.find((game) => game.id === id) ?? null : null;
}

function renderDashboard(): void {
  cleanupGame();
  clearNode(workspace);

  const dashboard = el("section", { className: "dashboard stack center-screen" });
  let selectedIndex = 0;
  const list = el("div", { className: "game-list" });

  games.forEach((game, index) => list.append(gameCard(game, index === selectedIndex)));
  document.addEventListener("keydown", onDashboardKeyDown);
  dashboard.append(list);
  workspace.append(dashboard);
  dashboardKeyCleanup = () => document.removeEventListener("keydown", onDashboardKeyDown);

  function onDashboardKeyDown(event: KeyboardEvent): void {
    const columns = getDashboardColumns(list);
    let nextIndex = selectedIndex;

    if (matchesKey(event, Keys.left)) nextIndex = selectedIndex - 1;
    else if (matchesKey(event, Keys.right)) nextIndex = selectedIndex + 1;
    else if (matchesKey(event, Keys.up)) nextIndex = selectedIndex - columns;
    else if (matchesKey(event, Keys.down)) nextIndex = selectedIndex + columns;
    else if (matchesKey(event, Keys.activate)) {
      event.preventDefault();
      playSound("dashboardSelect");
      window.location.hash = `#/${games[selectedIndex]!.id}`;
      return;
    } else return;

    event.preventDefault();
    selectedIndex = wrapIndex(nextIndex, games.length);
    playSound("dashboardMove");
    renderSelection();
  }

  function renderSelection(): void {
    clearNode(list);
    games.forEach((game, index) => list.append(gameCard(game, index === selectedIndex)));
  }
}

function getDashboardColumns(list: HTMLElement): number {
  const columns = getComputedStyle(list).gridTemplateColumns.split(" ").filter(Boolean).length;
  return Math.max(1, columns);
}

function wrapIndex(index: number, length: number): number {
  return (index + length) % length;
}

function gameCard(game: GameDefinition, selected = false): HTMLAnchorElement {
  const link = el("a", { className: `game-card surface interactive theme-${game.theme}` });
  link.href = `#/${game.id}`;
  link.textContent = game.name;
  link.dataset.selected = String(selected);
  link.addEventListener("click", () => playSound("dashboardSelect"));
  return link;
}

function renderGame(game: GameDefinition): void {
  cleanupGame();
  clearNode(workspace);

  const screen = el("section", { className: "game-screen" });
  const back = el("a", { className: "back-button pill surface interactive", text: "← Selection" });
  back.href = "#/";
  const gameHost = el("div", { className: "game-host center-screen" });
  screen.append(back, gameHost);
  workspace.append(screen);
  unmountGame = game.mount(gameHost);
  document.addEventListener("keydown", onGameKeyDown);
  gameKeyCleanup = () => document.removeEventListener("keydown", onGameKeyDown);

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

function cleanupGame(): void {
  confirmCleanup?.();
  confirmCleanup = null;
  gameKeyCleanup?.();
  gameKeyCleanup = null;
  dashboardKeyCleanup?.();
  dashboardKeyCleanup = null;
  unmountGame?.();
  unmountGame = null;
}
