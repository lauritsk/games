export type GameTheme = "deep-cave" | "deep-ocean" | "outer-space" | "deep-forest";
export type Difficulty = "Easy" | "Medium" | "Hard";
export type Direction = "up" | "right" | "down" | "left";
export type GridPoint = { row: number; column: number };

export const Keys = {
  previous: ["arrowleft", "arrowup", "h", "k"],
  next: ["arrowright", "arrowdown", "l", "j"],
  left: ["arrowleft", "h"],
  right: ["arrowright", "l"],
  up: ["arrowup", "k"],
  down: ["arrowdown", "j"],
  activate: [" ", "enter"],
  nextDifficulty: ["+", "=", ">"],
  previousDifficulty: ["-", "_", "<"],
} as const;

const difficultyOrder: Difficulty[] = ["Easy", "Medium", "Hard"];

export type GameDefinition = {
  id: string;
  name: string;
  tagline: string;
  players: string;
  theme: GameTheme;
  mount(target: HTMLElement): () => void;
};

type ElementOptions = {
  className?: string;
  text?: string;
  ariaLabel?: string;
  type?: "button" | "submit" | "reset";
};

export type GameBoardMode = "fit" | "scroll";

export type GameLayout = {
  mode: GameBoardMode;
  aspectRatio?: string;
  maxInline?: string;
  minInline?: string;
  maxBlock?: string;
  cellSize?: string;
};

export const gameLayouts = {
  squareFit: {
    mode: "fit",
    aspectRatio: "1 / 1",
    maxInline: "720px",
  },
  wideFit: {
    mode: "fit",
    aspectRatio: "7 / 6",
    maxInline: "760px",
  },
  tallFit: {
    mode: "fit",
    aspectRatio: "10 / 20",
    maxInline: "380px",
    minInline: "300px",
  },
  portraitFit: {
    mode: "fit",
    aspectRatio: "4 / 5",
    maxInline: "520px",
  },
  scrollGrid: {
    mode: "scroll",
    maxInline: "900px",
    cellSize: "30px",
  },
} satisfies Record<string, GameLayout>;

export type GameShellOptions = {
  gameClass: string;
  boardClass: string;
  boardLabel: string;
  statusLabel?: string;
  layout?: GameLayout;
};

export type GameShell = {
  shell: HTMLElement;
  top: HTMLDivElement;
  actions: HTMLDivElement;
  status: HTMLParagraphElement;
  viewport: HTMLDivElement;
  board: HTMLDivElement;
  remove(): void;
};

export function clearNode(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (options.className) element.className = options.className;
  if (options.text !== undefined) element.textContent = options.text;
  if (options.ariaLabel) element.setAttribute("aria-label", options.ariaLabel);
  if (options.type && element instanceof HTMLButtonElement) element.type = options.type;
  return element;
}

export function button(text: string, className = "button"): HTMLButtonElement {
  return el("button", { className, text, type: "button" });
}

export function nextDifficulty(difficulty: Difficulty): Difficulty {
  return cycleDifficulty(difficulty, 1);
}

export function previousDifficulty(difficulty: Difficulty): Difficulty {
  return cycleDifficulty(difficulty, -1);
}

export function isConfirmOpen(): boolean {
  return Boolean(document.querySelector(".confirm"));
}

export function isGameInProgress(shell: HTMLElement): boolean {
  return shell.dataset.started === "true" && shell.dataset.finished !== "true";
}

export function resetGameProgress(shell: HTMLElement): void {
  shell.dataset.started = "false";
  shell.dataset.finished = "false";
}

export function markGameStarted(shell: HTMLElement): void {
  shell.dataset.started = "true";
}

export function markGameFinished(shell: HTMLElement): void {
  shell.dataset.finished = "true";
}

export function requestGameReset(shell: HTMLElement, resetGame: () => void): void {
  if (isGameInProgress(shell)) confirmChoice("Start a new game?", resetGame);
  else resetGame();
}

export function matchesKey(event: KeyboardEvent, keys: readonly string[]): boolean {
  const key = event.key.toLowerCase();
  return keys.some((candidate) => candidate.toLowerCase() === key);
}

export function directionFromKey(event: KeyboardEvent): Direction | null {
  if (matchesKey(event, [...Keys.up, "w"])) return "up";
  if (matchesKey(event, [...Keys.right, "d"])) return "right";
  if (matchesKey(event, [...Keys.down, "s"])) return "down";
  if (matchesKey(event, [...Keys.left, "a"])) return "left";
  return null;
}

export type BoardGridOptions = {
  columns: number;
  rows?: number;
  cellSize?: string;
};

export function setBoardGrid(board: HTMLElement, columnsOrOptions: number | BoardGridOptions, rows?: number): void {
  const options = typeof columnsOrOptions === "number" ? { columns: columnsOrOptions, rows } : columnsOrOptions;
  board.style.setProperty("--board-columns", String(options.columns));
  if (options.rows === undefined) board.style.removeProperty("--board-rows");
  else board.style.setProperty("--board-rows", String(options.rows));
  if (options.cellSize === undefined) board.style.removeProperty("--board-cell-size");
  else board.style.setProperty("--board-cell-size", options.cellSize);
}

export function moveGridIndex(index: number, direction: Direction, columns: number, length: number): number {
  if (direction === "up") return Math.max(0, index - columns);
  if (direction === "right") return Math.min(length - 1, index + 1);
  if (direction === "down") return Math.min(length - 1, index + columns);
  return Math.max(0, index - 1);
}

export function moveGridPoint(point: GridPoint, direction: Direction, rows: number, columns: number): GridPoint {
  if (direction === "up") return { ...point, row: Math.max(0, point.row - 1) };
  if (direction === "right") return { ...point, column: Math.min(columns - 1, point.column + 1) };
  if (direction === "down") return { ...point, row: Math.min(rows - 1, point.row + 1) };
  return { ...point, column: Math.max(0, point.column - 1) };
}

export function required<T>(value: T | null | undefined, message = "Missing required value"): T {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}

export function gridCell<T>(grid: T[][], row: number, column: number, message = "Missing grid cell"): T {
  return required(grid[row]?.[column], message);
}

export type RandomSource = () => number;

export type MountScope = {
  readonly signal: AbortSignal;
  cleanup(): void;
};

export type StandardGameKeyHandlers = {
  onDirection?: (direction: Direction, event: KeyboardEvent) => void;
  onActivate?: (event: KeyboardEvent) => void;
  onNextDifficulty?: (event: KeyboardEvent) => void;
  onPreviousDifficulty?: (event: KeyboardEvent) => void;
  onReset?: (event: KeyboardEvent) => void;
};

export function createMountScope(): MountScope {
  const controller = new AbortController();
  return {
    signal: controller.signal,
    cleanup: () => controller.abort(),
  };
}

export function onDocumentKeyDown(handler: (event: KeyboardEvent) => void, scope: MountScope): void {
  document.addEventListener("keydown", handler, { signal: scope.signal });
}

export function handleStandardGameKey(event: KeyboardEvent, handlers: StandardGameKeyHandlers): boolean {
  if (isConfirmOpen()) return true;
  const direction = directionFromKey(event);
  if (direction && handlers.onDirection) {
    event.preventDefault();
    handlers.onDirection(direction, event);
    return true;
  }
  if (matchesKey(event, Keys.activate) && handlers.onActivate) {
    event.preventDefault();
    handlers.onActivate(event);
    return true;
  }
  if (matchesKey(event, Keys.nextDifficulty) && handlers.onNextDifficulty) {
    event.preventDefault();
    handlers.onNextDifficulty(event);
    return true;
  }
  if (matchesKey(event, Keys.previousDifficulty) && handlers.onPreviousDifficulty) {
    event.preventDefault();
    handlers.onPreviousDifficulty(event);
    return true;
  }
  if (event.key.toLowerCase() === "n" && handlers.onReset) {
    event.preventDefault();
    handlers.onReset(event);
    return true;
  }
  return false;
}

export function createDifficultyButton(actions: HTMLElement, onClick: () => void): HTMLButtonElement {
  const difficultyButton = button("", "button pill surface interactive");
  difficultyButton.addEventListener("click", onClick);
  actions.append(difficultyButton);
  return difficultyButton;
}

export function createResetButton(actions: HTMLElement, onClick: () => void): HTMLButtonElement {
  const resetButton = button("New", "button pill surface interactive");
  resetButton.addEventListener("click", onClick);
  actions.append(resetButton);
  return resetButton;
}

export function syncChildren<T extends HTMLElement>(container: HTMLElement, count: number, create: (index: number) => T): T[] {
  while (container.children.length > count) container.lastElementChild?.remove();
  while (container.children.length < count) container.append(create(container.children.length));
  return Array.from(container.children) as T[];
}

export function shuffleInPlace<T>(items: T[], rng: RandomSource = Math.random): T[] {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    [items[index], items[swap]] = [required(items[swap]), required(items[index])];
  }
  return items;
}

function cycleDifficulty(difficulty: Difficulty, step: 1 | -1): Difficulty {
  const index = difficultyOrder.indexOf(difficulty);
  return difficultyOrder[(index + step + difficultyOrder.length) % difficultyOrder.length] ?? "Easy";
}

export function confirmChoice(message: string, onYes: () => void, onClose?: () => void): () => void {
  if (isConfirmOpen()) return () => undefined;

  let selected = 1;
  const dialog = el("dialog", { className: "confirm", ariaLabel: message });
  dialog.setAttribute("aria-modal", "true");

  const panel = el("div", { className: "confirm__panel surface" });
  const text = el("p", { text: message });
  const actions = el("div", { className: "confirm__actions cluster" });
  const yes = button("Yes", "pill surface interactive");
  const no = button("No", "pill surface interactive");
  actions.append(yes, no);
  panel.append(text, actions);
  dialog.append(panel);
  document.body.append(dialog);

  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  yes.addEventListener("click", yesAction);
  no.addEventListener("click", close);
  yes.addEventListener("pointerenter", () => select(0));
  no.addEventListener("pointerenter", () => select(1));
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  document.addEventListener("keydown", onKeyDown);
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  render();

  function onKeyDown(event: KeyboardEvent): void {
    const key = event.key.toLowerCase();
    if (key === "tab") {
      event.preventDefault();
      select(selected === 0 ? 1 : 0);
    } else if (matchesKey(event, Keys.previous)) {
      event.preventDefault();
      select(0);
    } else if (matchesKey(event, Keys.next)) {
      event.preventDefault();
      select(1);
    } else if (key === "y") {
      event.preventDefault();
      yesAction();
    } else if (key === "n" || key === "escape") {
      event.preventDefault();
      close();
    } else if (matchesKey(event, Keys.activate)) {
      event.preventDefault();
      selected === 0 ? yesAction() : close();
    }
  }

  function select(next: number): void {
    if (selected === next) return;
    selected = next;
    render();
  }

  function render(): void {
    yes.dataset.selected = String(selected === 0);
    no.dataset.selected = String(selected === 1);
    (selected === 0 ? yes : no).focus();
  }

  function yesAction(): void {
    close();
    onYes();
  }

  function close(): void {
    document.removeEventListener("keydown", onKeyDown);
    if (dialog.open) dialog.close();
    dialog.remove();
    previousFocus?.focus();
    onClose?.();
  }

  return close;
}

export function createGameShell(target: HTMLElement, options: GameShellOptions): GameShell {
  const layout = options.layout ?? gameLayouts.squareFit;
  const shell = el("section", { className: `game ${options.gameClass}` });
  shell.dataset.boardMode = layout.mode;
  applyGameLayout(shell, layout);
  resetGameProgress(shell);

  const top = el("div", { className: "game__top cluster" });
  const status = el("p", {
    className: "status pill surface",
    ariaLabel: options.statusLabel ?? "Game status",
  });
  const actions = el("div", { className: "game__actions cluster" });
  const viewport = el("div", { className: "board-viewport" });
  const board = el("div", { className: `board ${options.boardClass}`, ariaLabel: options.boardLabel });
  board.setAttribute("role", "grid");

  top.append(status, actions);
  viewport.append(board);
  shell.append(top, viewport);
  target.append(shell);
  const stopLayoutSizing = createGameLayoutObserver(shell, target);

  return {
    shell,
    top,
    actions,
    status,
    viewport,
    board,
    remove: () => {
      stopLayoutSizing();
      shell.remove();
    },
  };
}

export function applyGameLayout(shell: HTMLElement, layout: GameLayout): void {
  shell.dataset.boardMode = layout.mode;
  setOptionalStyle(shell, "--game-max-inline", layout.maxInline);
  setOptionalStyle(shell, "--game-min-inline", layout.minInline);
  setOptionalStyle(shell, "--board-max-inline", layout.maxInline);
  setOptionalStyle(shell, "--board-max-block", layout.maxBlock);
  setOptionalStyle(shell, "--board-aspect", layout.aspectRatio);
  setOptionalStyle(shell, "--board-cell-size", layout.cellSize);
  shell.style.setProperty("--board-aspect-factor", String(aspectFactor(layout.aspectRatio)));
  syncGameFitInline(shell);
}

function createGameLayoutObserver(shell: HTMLElement, _target: HTMLElement): () => void {
  let frame = 0;
  const sync = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = 0;
      syncGameFitInline(shell);
    });
  };

  sync();
  window.addEventListener("resize", sync);
  window.visualViewport?.addEventListener("resize", sync);
  return () => {
    if (frame) cancelAnimationFrame(frame);
    window.removeEventListener("resize", sync);
    window.visualViewport?.removeEventListener("resize", sync);
  };
}

function syncGameFitInline(shell: HTMLElement): void {
  if (shell.dataset.boardMode === "scroll") {
    shell.style.removeProperty("--game-fit-inline");
    return;
  }
  const host = shell.parentElement;
  const top = shell.querySelector<HTMLElement>(".game__top");
  if (!host || !top) return;
  const gap = Number.parseFloat(getComputedStyle(shell).rowGap || getComputedStyle(shell).gap) || 0;
  const availableBlock = Math.max(0, host.getBoundingClientRect().height - top.getBoundingClientRect().height - gap);
  const aspect = Number.parseFloat(shell.style.getPropertyValue("--board-aspect-factor")) || 1;
  shell.style.setProperty("--board-fit-block", `${availableBlock}px`);
  shell.style.setProperty("--game-fit-inline", `${availableBlock * aspect}px`);
}

function setOptionalStyle(element: HTMLElement, name: string, value: string | undefined): void {
  if (value === undefined) element.style.removeProperty(name);
  else element.style.setProperty(name, value);
}

function aspectFactor(aspectRatio: string | undefined): number {
  if (!aspectRatio) return 1;
  const match = aspectRatio.match(/^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/);
  if (!match) return 1;
  const inline = Number(match[1]);
  const block = Number(match[2]);
  return Number.isFinite(inline) && Number.isFinite(block) && block > 0 ? inline / block : 1;
}
