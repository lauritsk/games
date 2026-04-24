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

export type GameShellOptions = {
  gameClass: string;
  boardClass: string;
  boardLabel: string;
  statusLabel?: string;
};

export type GameShell = {
  shell: HTMLElement;
  top: HTMLDivElement;
  actions: HTMLDivElement;
  status: HTMLParagraphElement;
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

export function setBoardGrid(board: HTMLElement, columns: number, rows?: number): void {
  board.style.setProperty("--board-columns", String(columns));
  if (rows === undefined) board.style.removeProperty("--board-rows");
  else board.style.setProperty("--board-rows", String(rows));
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
      selected = selected === 0 ? 1 : 0;
      render();
      (selected === 0 ? yes : no).focus();
    } else if (matchesKey(event, Keys.previous)) {
      event.preventDefault();
      selected = 0;
      render();
    } else if (matchesKey(event, Keys.next)) {
      event.preventDefault();
      selected = 1;
      render();
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
  const shell = el("section", { className: `game ${options.gameClass}` });
  resetGameProgress(shell);
  const top = el("div", { className: "game__top cluster" });
  const status = el("p", {
    className: "status pill surface",
    ariaLabel: options.statusLabel ?? "Game status",
  });
  const actions = el("div", { className: "game__actions cluster" });
  const board = el("div", { className: `board ${options.boardClass}`, ariaLabel: options.boardLabel });
  board.setAttribute("role", "grid");

  top.append(status, actions);
  shell.append(top, board);
  target.append(shell);

  return {
    shell,
    top,
    actions,
    status,
    board,
    remove: () => shell.remove(),
  };
}
