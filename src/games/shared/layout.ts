import { el } from "@shared/dom";
import { resetGameProgress } from "@games/shared/progress";

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
    cellSize: "44px",
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

export type BoardGridOptions = {
  columns: number;
  rows?: number;
  cellSize?: string;
};

export function setBoardGrid(
  board: HTMLElement,
  columnsOrOptions: number | BoardGridOptions,
  rows?: number,
): void {
  const options =
    typeof columnsOrOptions === "number" ? { columns: columnsOrOptions, rows } : columnsOrOptions;
  board.style.setProperty("--board-columns", String(options.columns));
  if (options.rows === undefined) board.style.removeProperty("--board-rows");
  else board.style.setProperty("--board-rows", String(options.rows));
  if (options.cellSize === undefined) board.style.removeProperty("--board-cell-size");
  else board.style.setProperty("--board-cell-size", options.cellSize);
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
  const board = el("div", {
    className: `board ${options.boardClass}`,
    ariaLabel: options.boardLabel,
  });
  board.setAttribute("role", "grid");

  top.append(status, actions);
  viewport.append(board);
  shell.append(top, viewport);
  target.append(shell);
  const stopLayoutSizing = createGameLayoutObserver(shell);

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

function createGameLayoutObserver(shell: HTMLElement): () => void {
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
  const availableBlock = Math.max(
    0,
    host.getBoundingClientRect().height - top.getBoundingClientRect().height - gap,
  );
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
