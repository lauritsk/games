import { button, clearNode, confirmChoice, createGameShell, el, type GameDefinition } from "@classic-games/core";

type Cell = { mine: boolean; open: boolean; flag: boolean; nearby: number };
type State = "playing" | "won" | "lost";
type Difficulty = "Easy" | "Medium" | "Hard";
type Config = { size: number; mines: number };

const configs: Record<Difficulty, Config> = {
  Easy: { size: 8, mines: 8 },
  Medium: { size: 12, mines: 24 },
  Hard: { size: 16, mines: 56 },
};

export const minesweeper: GameDefinition = {
  id: "minesweeper",
  name: "Minesweeper",
  tagline: "Clear the field. Mark the danger.",
  players: "Solo",
  theme: "deep-cave",
  mount: mountMinesweeper,
};

export function mountMinesweeper(target: HTMLElement): () => void {
  let difficulty: Difficulty = "Medium";
  let config = configs[difficulty];
  let board = newBoard(config);
  let state: State = "playing";
  let firstMove = true;
  let selectedRow = 0;
  let selectedColumn = 0;

  const { shell, status, actions, board: grid, remove } = createGameShell(target, {
    gameClass: "minesweeper",
    boardClass: "board--minesweeper",
    boardLabel: "Minesweeper board",
  });
  shell.tabIndex = 0;
  document.addEventListener("keydown", onKeyDown);

  const difficultyButton = button("", "button pill surface interactive");
  const reset = button("New", "button pill surface interactive");
  actions.append(difficultyButton, reset);

  difficultyButton.addEventListener("click", () => {
    difficulty = nextDifficulty(difficulty);
    resetGame();
  });
  reset.addEventListener("click", requestReset);

  function requestReset(): void {
    if (shell.dataset.started === "true" && shell.dataset.finished !== "true") confirmChoice("Start a new game?", resetGame);
    else resetGame();
  }

  function resetGame(): void {
    shell.dataset.started = "false";
    shell.dataset.finished = "false";
    config = configs[difficulty];
    board = newBoard(config);
    state = "playing";
    firstMove = true;
    selectedRow = 0;
    selectedColumn = 0;
    render();
  }

  function render(): void {
    clearNode(grid);
    grid.style.setProperty("--mine-size", String(config.size));
    status.textContent = statusText();
    difficultyButton.textContent = difficulty;

    for (let row = 0; row < config.size; row += 1) {
      for (let column = 0; column < config.size; column += 1) {
        const cell = board[row]![column]!;
        const tile = el("button", { className: "mine-cell", ariaLabel: labelFor(row, column, cell), type: "button" });
        tile.dataset.open = String(cell.open);
        tile.dataset.flag = String(cell.flag);
        tile.dataset.mine = String(cell.mine && (cell.open || state === "lost"));
        tile.dataset.selected = String(row === selectedRow && column === selectedColumn);
        tile.textContent = cellText(cell);
        tile.disabled = state !== "playing" || cell.open;
        tile.addEventListener("click", () => openCell(row, column));
        tile.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          toggleFlag(row, column);
        });
        grid.append(tile);
      }
    }
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (document.querySelector(".confirm")) return;
    const key = event.key.toLowerCase();
    if (["arrowup", "k"].includes(key)) {
      event.preventDefault();
      selectedRow = Math.max(0, selectedRow - 1);
      render();
    } else if (["arrowright", "l"].includes(key)) {
      event.preventDefault();
      selectedColumn = Math.min(config.size - 1, selectedColumn + 1);
      render();
    } else if (["arrowdown", "j"].includes(key)) {
      event.preventDefault();
      selectedRow = Math.min(config.size - 1, selectedRow + 1);
      render();
    } else if (["arrowleft", "h"].includes(key)) {
      event.preventDefault();
      selectedColumn = Math.max(0, selectedColumn - 1);
      render();
    } else if ([" ", "enter"].includes(key)) {
      event.preventDefault();
      openCell(selectedRow, selectedColumn);
    } else if (key === "f") {
      event.preventDefault();
      toggleFlag(selectedRow, selectedColumn);
    } else if (["+", "=", ">"].includes(event.key)) {
      event.preventDefault();
      difficulty = nextDifficulty(difficulty);
      resetGame();
    } else if (["-", "_", "<"].includes(event.key)) {
      event.preventDefault();
      difficulty = previousDifficulty(difficulty);
      resetGame();
    } else if (key === "n") {
      event.preventDefault();
      requestReset();
    }
  }

  function statusText(): string {
    if (state === "won") return "Cleared";
    if (state === "lost") return "Boom";
    return `${config.mines - flagCount(board)} mines`;
  }

  function openCell(row: number, column: number): void {
    if (state !== "playing") return;
    const cell = board[row]?.[column];
    if (!cell || cell.flag) return;
    if (cell.open) {
      chordCell(row, column);
      return;
    }

    shell.dataset.started = "true";

    if (firstMove) {
      board = seededBoard(config, row, column);
      firstMove = false;
    }

    const current = board[row]![column]!;
    if (current.mine) {
      current.open = true;
      state = "lost";
    } else {
      floodOpen(board, config, row, column);
      if (openSafeCount(board) === config.size * config.size - config.mines) state = "won";
    }
    if (state !== "playing") shell.dataset.finished = "true";
    render();
  }

  function chordCell(row: number, column: number): void {
    if (state !== "playing") return;
    const cell = board[row]?.[column];
    if (!cell?.open || cell.nearby === 0) return;

    const around = neighbors(config, row, column);
    const flagged = around.filter(([r, c]) => board[r]?.[c]?.flag).length;
    if (flagged !== cell.nearby) return;

    shell.dataset.started = "true";
    for (const [r, c] of around) {
      const next = board[r]?.[c];
      if (!next || next.open || next.flag) continue;
      if (next.mine) {
        next.open = true;
        state = "lost";
      } else {
        floodOpen(board, config, r, c);
      }
    }
    if (state !== "lost" && openSafeCount(board) === config.size * config.size - config.mines) state = "won";
    if (state !== "playing") shell.dataset.finished = "true";
    render();
  }

  function toggleFlag(row: number, column: number): void {
    if (state !== "playing") return;
    const cell = board[row]?.[column];
    if (!cell || cell.open) return;
    shell.dataset.started = "true";
    cell.flag = !cell.flag;
    render();
  }

  render();
  return () => {
    document.removeEventListener("keydown", onKeyDown);
    remove();
  };
}

function nextDifficulty(difficulty: Difficulty): Difficulty {
  if (difficulty === "Easy") return "Medium";
  if (difficulty === "Medium") return "Hard";
  return "Easy";
}

function previousDifficulty(difficulty: Difficulty): Difficulty {
  if (difficulty === "Hard") return "Medium";
  if (difficulty === "Medium") return "Easy";
  return "Hard";
}

function newBoard(config: Config): Cell[][] {
  return Array.from({ length: config.size }, () => Array.from({ length: config.size }, () => ({ mine: false, open: false, flag: false, nearby: 0 })));
}

function seededBoard(config: Config, safeRow: number, safeColumn: number): Cell[][] {
  const board = newBoard(config);
  const blocked = new Set(neighbors(config, safeRow, safeColumn).concat([[safeRow, safeColumn]]).map(([r, c]) => key(r, c)));
  const spots = Array.from({ length: config.size * config.size }, (_, index) => [Math.floor(index / config.size), index % config.size] as const).filter(([r, c]) => !blocked.has(key(r, c)));

  shuffle(spots).slice(0, config.mines).forEach(([r, c]) => { board[r]![c]!.mine = true; });

  for (let row = 0; row < config.size; row += 1) {
    for (let column = 0; column < config.size; column += 1) {
      board[row]![column]!.nearby = neighbors(config, row, column).filter(([r, c]) => board[r]?.[c]?.mine).length;
    }
  }
  return board;
}

function floodOpen(board: Cell[][], config: Config, row: number, column: number): void {
  const queue: [number, number][] = [[row, column]];
  while (queue.length) {
    const [r, c] = queue.shift()!;
    const cell = board[r]?.[c];
    if (!cell || cell.open || cell.flag) continue;
    cell.open = true;
    if (cell.nearby === 0) queue.push(...neighbors(config, r, c));
  }
}

function neighbors(config: Config, row: number, column: number): [number, number][] {
  const found: [number, number][] = [];
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      const r = row + dr;
      const c = column + dc;
      if ((dr !== 0 || dc !== 0) && r >= 0 && r < config.size && c >= 0 && c < config.size) found.push([r, c]);
    }
  }
  return found;
}

function key(row: number, column: number): string { return `${row}:${column}`; }

function shuffle<T>(items: T[]): T[] {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [items[index], items[swap]] = [items[swap]!, items[index]!];
  }
  return items;
}

function cellText(cell: Cell): string {
  if (cell.flag) return "⚑";
  if (!cell.open) return "";
  if (cell.mine) return "✹";
  return cell.nearby > 0 ? String(cell.nearby) : "";
}

function labelFor(row: number, column: number, cell: Cell): string {
  const value = cell.flag ? "flagged" : cell.open ? cell.mine ? "mine" : `${cell.nearby} nearby mines` : "closed";
  return `Row ${row + 1}, column ${column + 1}, ${value}`;
}

function flagCount(board: Cell[][]): number { return board.flat().filter((cell) => cell.flag).length; }
function openSafeCount(board: Cell[][]): number { return board.flat().filter((cell) => cell.open && !cell.mine).length; }
