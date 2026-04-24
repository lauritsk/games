import { button, clearNode, createGameShell, directionFromKey, el, isConfirmOpen, Keys, markGameFinished, markGameStarted, matchesKey, nextDifficulty, previousDifficulty, requestGameReset, resetGameProgress, setBoardGrid, type Difficulty, type Direction, type GameDefinition } from "../core";
import { playSound } from "../sound";

type Board = number[][];

const sizes: Record<Difficulty, number> = { Easy: 3, Medium: 4, Hard: 5 };

export const game2048: GameDefinition = {
  id: "2048",
  name: "2048",
  tagline: "Slide tiles. Merge numbers.",
  players: "Solo",
  theme: "outer-space",
  mount: mount2048,
};

export function mount2048(target: HTMLElement): () => void {
  let difficulty: Difficulty = "Medium";
  let size = sizes[difficulty];
  let board = startBoard(size);
  let score = 0;
  let over = false;

  const { shell, status, actions, board: grid, remove } = createGameShell(target, {
    gameClass: "game-2048",
    boardClass: "board--2048",
    boardLabel: "2048 board",
  });
  shell.tabIndex = 0;

  const difficultyButton = button("", "button pill surface interactive");
  const reset = button("New", "button pill surface interactive");
  actions.append(difficultyButton, reset);

  difficultyButton.addEventListener("click", () => {
    difficulty = nextDifficulty(difficulty);
    playSound("uiToggle");
    resetGame();
  });
  reset.addEventListener("click", requestReset);
  document.addEventListener("keydown", onKeyDown);

  function requestReset(): void {
    playSound("uiReset");
    requestGameReset(shell, resetGame);
  }

  function resetGame(): void {
    resetGameProgress(shell);
    size = sizes[difficulty];
    board = startBoard(size);
    score = 0;
    over = false;
    render();
  }

  function render(): void {
    clearNode(grid);
    setBoardGrid(grid, size);
    status.textContent = over ? `Done · ${score}` : String(score);
    difficultyButton.textContent = difficulty;

    for (const value of board.flat()) {
      const tile = el("div", { className: "tile tile-2048", text: value ? String(value) : "" });
      tile.dataset.value = String(value);
      grid.append(tile);
    }
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (isConfirmOpen()) return;
    const key = event.key.toLowerCase();
    const direction = directionFromKey(event);
    if (direction && !over) {
      event.preventDefault();
      move(direction);
    } else if (matchesKey(event, Keys.nextDifficulty)) {
      event.preventDefault();
      difficulty = nextDifficulty(difficulty);
      playSound("uiToggle");
      resetGame();
    } else if (matchesKey(event, Keys.previousDifficulty)) {
      event.preventDefault();
      difficulty = previousDifficulty(difficulty);
      playSound("uiToggle");
      resetGame();
    } else if (key === "n") {
      event.preventDefault();
      requestReset();
    } else if (matchesKey(event, Keys.activate)) {
      event.preventDefault();
      requestReset();
    }
  }

  function move(direction: Direction): void {
    const result = slide(board, direction);
    if (!result.changed) return;
    markGameStarted(shell);
    board = addRandomTile(result.board);
    score += result.score;
    over = !canMove(board);
    if (over) markGameFinished(shell);
    playSound(over ? "gameLose" : result.score > 0 ? "gameGood" : "gameMove");
    render();
  }

  render();
  return () => {
    document.removeEventListener("keydown", onKeyDown);
    remove();
  };
}

function startBoard(size: number): Board {
  return addRandomTile(addRandomTile(emptyBoard(size)));
}

function emptyBoard(size: number): Board {
  return Array.from({ length: size }, () => Array<number>(size).fill(0));
}

function addRandomTile(board: Board): Board {
  const next = clone(board);
  const empty = next.flatMap((row, r) => row.map((value, c) => ({ value, r, c }))).filter((cell) => cell.value === 0);
  const cell = empty[Math.floor(Math.random() * empty.length)];
  if (cell) next[cell.r]![cell.c] = Math.random() < 0.9 ? 2 : 4;
  return next;
}

function slide(board: Board, direction: Direction): { board: Board; score: number; changed: boolean } {
  const size = board.length;
  const next = emptyBoard(size);
  let score = 0;

  for (let index = 0; index < size; index += 1) {
    const line = readLine(board, direction, index);
    const merged = mergeLine(line);
    score += merged.score;
    writeLine(next, direction, index, merged.line);
  }

  return { board: next, score, changed: !boardsEqual(board, next) };
}

function readLine(board: Board, direction: Direction, index: number): number[] {
  const size = board.length;
  return Array.from({ length: size }, (_, step) => {
    if (direction === "left") return board[index]![step]!;
    if (direction === "right") return board[index]![size - 1 - step]!;
    if (direction === "up") return board[step]![index]!;
    return board[size - 1 - step]![index]!;
  });
}

function writeLine(board: Board, direction: Direction, index: number, line: number[]): void {
  const size = board.length;
  for (let step = 0; step < size; step += 1) {
    if (direction === "left") board[index]![step] = line[step]!;
    else if (direction === "right") board[index]![size - 1 - step] = line[step]!;
    else if (direction === "up") board[step]![index] = line[step]!;
    else board[size - 1 - step]![index] = line[step]!;
  }
}

function mergeLine(line: number[]): { line: number[]; score: number } {
  const compact = line.filter(Boolean);
  const merged: number[] = [];
  let score = 0;

  for (let index = 0; index < compact.length; index += 1) {
    if (compact[index] === compact[index + 1]) {
      const value = compact[index]! * 2;
      merged.push(value);
      score += value;
      index += 1;
    } else {
      merged.push(compact[index]!);
    }
  }

  return { line: merged.concat(Array(line.length - merged.length).fill(0)), score };
}

function boardsEqual(a: Board, b: Board): boolean {
  return a.every((row, rowIndex) => row.every((value, columnIndex) => value === b[rowIndex]?.[columnIndex]));
}

function canMove(board: Board): boolean {
  if (board.flat().includes(0)) return true;
  return (["up", "right", "down", "left"] as const).some((direction) => slide(board, direction).changed);
}

function clone(board: Board): Board {
  return board.map((row) => [...row]);
}
