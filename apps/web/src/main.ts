import { clearNode, el, type GameDefinition } from "@classic-games/core";
import { games } from "./games";

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
    const key = event.key.toLowerCase();
    if (["arrowleft", "arrowup", "h", "k"].includes(key)) {
      event.preventDefault();
      selectedIndex = (selectedIndex - 1 + games.length) % games.length;
      renderSelection();
    } else if (["arrowright", "arrowdown", "l", "j"].includes(key)) {
      event.preventDefault();
      selectedIndex = (selectedIndex + 1) % games.length;
      renderSelection();
    } else if ([" ", "enter"].includes(key)) {
      event.preventDefault();
      window.location.hash = `#/${games[selectedIndex]!.id}`;
    }
  }

  function renderSelection(): void {
    clearNode(list);
    games.forEach((game, index) => list.append(gameCard(game, index === selectedIndex)));
  }
}

function gameCard(game: GameDefinition, selected = false): HTMLAnchorElement {
  const link = el("a", { className: `game-card surface interactive theme-${game.theme}` });
  link.href = `#/${game.id}`;
  link.textContent = game.name;
  link.dataset.selected = String(selected);
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
    const started = gameElement?.dataset.started === "true";
    const finished = gameElement?.dataset.finished === "true";
    if (started && !finished) showConfirm(screen);
    else window.location.hash = "#/";
  }
}

function showConfirm(screen: HTMLElement): void {
  let selected = 1;
  const dialog = el("div", { className: "confirm", ariaLabel: "Leave current game?" });
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");

  const panel = el("div", { className: "confirm__panel surface" });
  const message = el("p", { text: "Leave this game?" });
  const actions = el("div", { className: "confirm__actions cluster" });
  const yes = el("button", { className: "pill surface interactive", text: "Yes", type: "button" });
  const no = el("button", { className: "pill surface interactive", text: "No", type: "button" });
  actions.append(yes, no);
  panel.append(message, actions);
  dialog.append(panel);
  screen.append(dialog);

  yes.addEventListener("click", leave);
  no.addEventListener("click", close);
  document.addEventListener("keydown", onConfirmKeyDown);
  renderConfirm();

  confirmCleanup = close;

  function onConfirmKeyDown(event: KeyboardEvent): void {
    event.stopImmediatePropagation();
    const key = event.key.toLowerCase();
    if (["arrowleft", "arrowup", "h", "k"].includes(key)) {
      event.preventDefault();
      selected = 0;
      renderConfirm();
    } else if (["arrowright", "arrowdown", "l", "j"].includes(key)) {
      event.preventDefault();
      selected = 1;
      renderConfirm();
    } else if (key === "y") {
      event.preventDefault();
      leave();
    } else if (key === "n" || key === "escape") {
      event.preventDefault();
      close();
    } else if (key === "enter" || key === " ") {
      event.preventDefault();
      selected === 0 ? leave() : close();
    }
  }

  function renderConfirm(): void {
    yes.dataset.selected = String(selected === 0);
    no.dataset.selected = String(selected === 1);
  }

  function leave(): void {
    close();
    window.location.hash = "#/";
  }

  function close(): void {
    document.removeEventListener("keydown", onConfirmKeyDown);
    dialog.remove();
    confirmCleanup = null;
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
