import { button, clearNode, createGameShell, directionFromKey, el, isConfirmOpen, Keys, markGameFinished, markGameStarted, matchesKey, moveGridPoint, nextDifficulty, previousDifficulty, requestGameReset, resetGameProgress, setBoardGrid, type Difficulty, type GameDefinition } from "../core";
import { playSound } from "../sound";
import { flagMinesweeperCount, floodOpenMinesweeper, minesweeperNeighbors, newMinesweeperBoard, openSafeMinesweeperCount, seededMinesweeperBoard, type MinesweeperCell, type MinesweeperConfig } from "./minesweeper.logic";

type State = "playing" | "won" | "lost";

const configs: Record<Difficulty, MinesweeperConfig> = {
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
  let board = newMinesweeperBoard(config);
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
    playSound("uiToggle");
    resetGame();
  });
  reset.addEventListener("click", requestReset);

  function requestReset(): void {
    playSound("uiReset");
    requestGameReset(shell, resetGame);
  }

  function resetGame(): void {
    resetGameProgress(shell);
    config = configs[difficulty];
    board = newMinesweeperBoard(config);
    state = "playing";
    firstMove = true;
    selectedRow = 0;
    selectedColumn = 0;
    render();
  }

  function render(): void {
    clearNode(grid);
    setBoardGrid(grid, config.size);
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
    if (isConfirmOpen()) return;
    const key = event.key.toLowerCase();
    const direction = directionFromKey(event);
    if (direction) {
      event.preventDefault();
      const next = moveGridPoint({ row: selectedRow, column: selectedColumn }, direction, config.size, config.size);
      selectedRow = next.row;
      selectedColumn = next.column;
      render();
    } else if (matchesKey(event, Keys.activate)) {
      event.preventDefault();
      openCell(selectedRow, selectedColumn);
    } else if (key === "f") {
      event.preventDefault();
      toggleFlag(selectedRow, selectedColumn);
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
    }
  }

  function statusText(): string {
    if (state === "won") return "Cleared";
    if (state === "lost") return "Boom";
    return `${config.mines - flagMinesweeperCount(board)} mines`;
  }

  function openCell(row: number, column: number): void {
    if (state !== "playing") return;
    const cell = board[row]?.[column];
    if (!cell || cell.flag) return;
    if (cell.open) {
      chordCell(row, column);
      return;
    }

    markGameStarted(shell);

    if (firstMove) {
      board = seededMinesweeperBoard(config, row, column);
      firstMove = false;
    }

    const current = board[row]![column]!;
    if (current.mine) {
      current.open = true;
      state = "lost";
    } else {
      floodOpenMinesweeper(board, config, row, column);
      if (openSafeMinesweeperCount(board) === config.size * config.size - config.mines) state = "won";
    }
    if (state !== "playing") markGameFinished(shell);
    if (state === "won") playSound("gameWin");
    else if (state === "lost") playSound("gameLose");
    else playSound("gameMove");
    render();
  }

  function chordCell(row: number, column: number): void {
    if (state !== "playing") return;
    const cell = board[row]?.[column];
    if (!cell?.open || cell.nearby === 0) return;

    const around = minesweeperNeighbors(config, row, column);
    const flagged = around.filter(([r, c]) => board[r]?.[c]?.flag).length;
    if (flagged !== cell.nearby) return;

    markGameStarted(shell);
    for (const [r, c] of around) {
      const next = board[r]?.[c];
      if (!next || next.open || next.flag) continue;
      if (next.mine) {
        next.open = true;
        state = "lost";
      } else {
        floodOpenMinesweeper(board, config, r, c);
      }
    }
    if (state !== "lost" && openSafeMinesweeperCount(board) === config.size * config.size - config.mines) state = "won";
    if (state !== "playing") markGameFinished(shell);
    if (state === "won") playSound("gameWin");
    else if (state === "lost") playSound("gameLose");
    else playSound("gameMove");
    render();
  }

  function toggleFlag(row: number, column: number): void {
    if (state !== "playing") return;
    const cell = board[row]?.[column];
    if (!cell || cell.open) return;
    markGameStarted(shell);
    cell.flag = !cell.flag;
    playSound("gameMove");
    render();
  }

  render();
  return () => {
    document.removeEventListener("keydown", onKeyDown);
    remove();
  };
}

function cellText(cell: MinesweeperCell): string {
  if (cell.flag) return "⚑";
  if (!cell.open) return "";
  if (cell.mine) return "✹";
  return cell.nearby > 0 ? String(cell.nearby) : "";
}

function labelFor(row: number, column: number, cell: MinesweeperCell): string {
  const value = cell.flag ? "flagged" : cell.open ? cell.mine ? "mine" : `${cell.nearby} nearby mines` : "closed";
  return `Row ${row + 1}, column ${column + 1}, ${value}`;
}

