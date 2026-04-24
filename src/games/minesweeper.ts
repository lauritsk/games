import { applyGameLayout, createGameShell, createMountScope, el, gameLayouts, handleStandardGameKey, isConfirmOpen, markGameFinished, markGameStarted, moveGridPoint, onDocumentKeyDown, resetGameProgress, setBoardGrid, syncChildren, type Difficulty, type GameDefinition } from "../core";
import { createInvalidMoveFeedback } from "../feedback";
import { playSound } from "../sound";
import { changeDifficulty, createDifficultyControl, createResetControl } from "./controls";
import { flagMinesweeperCount, floodOpenMinesweeperInPlace, minesweeperNeighbors, minesweeperShape, newMinesweeperBoard, openSafeMinesweeperCount, seededMinesweeperBoard, type MinesweeperCell, type MinesweeperConfig } from "./minesweeper.logic";

type State = "playing" | "won" | "lost";

const configs: Record<Difficulty, MinesweeperConfig> = {
  Easy: { rows: 8, columns: 8, mines: 8, layout: "fit" },
  Medium: { rows: 12, columns: 12, mines: 24, layout: "fit" },
  Hard: { rows: 16, columns: 16, mines: 56, layout: "fit" },
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
    layout: gameLayouts.squareFit,
  });
  shell.tabIndex = 0;
  const scope = createMountScope();
  const invalidMove = createInvalidMoveFeedback(shell);
  onDocumentKeyDown(onKeyDown, scope);

  const difficultyControl = {
    get: () => difficulty,
    set: (next: Difficulty) => { difficulty = next; },
    reset: resetGame,
  };
  const difficultyButton = createDifficultyControl(actions, difficultyControl);
  const requestReset = createResetControl(actions, shell, resetGame);

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
    const shape = minesweeperShape(config);
    applyGameLayout(shell, config.layout === "scroll" ? gameLayouts.scrollGrid : gameLayouts.squareFit);
    setBoardGrid(grid, { columns: shape.columns, rows: shape.rows, cellSize: config.layout === "scroll" ? gameLayouts.scrollGrid.cellSize : undefined });
    status.textContent = statusText();
    difficultyButton.textContent = difficulty;

    const tiles = syncChildren(grid, shape.rows * shape.columns, () => {
      const tile = el("button", { className: "mine-cell", type: "button" });
      tile.addEventListener("click", () => openCell(Number(tile.dataset.row), Number(tile.dataset.column)));
      tile.addEventListener("pointerenter", () => {
        const row = Number(tile.dataset.row);
        const column = Number(tile.dataset.column);
        if (selectedRow === row && selectedColumn === column) return;
        selectedRow = row;
        selectedColumn = column;
        render();
      });
      tile.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        toggleFlag(Number(tile.dataset.row), Number(tile.dataset.column));
      });
      return tile;
    });
    tiles.forEach((tile, index) => {
      const row = Math.floor(index / shape.columns);
      const column = index % shape.columns;
      const cell = board[row]?.[column];
      if (!cell) return;
      tile.dataset.row = String(row);
      tile.dataset.column = String(column);
      tile.setAttribute("aria-label", labelFor(row, column, cell));
      tile.dataset.open = String(cell.open);
      tile.dataset.flag = String(cell.flag);
      tile.dataset.mine = String(cell.mine && (cell.open || state === "lost"));
      tile.dataset.selected = String(row === selectedRow && column === selectedColumn);
      tile.textContent = cellText(cell);
      tile.disabled = false;
      tile.setAttribute("aria-disabled", String(state !== "playing"));
      if (row === selectedRow && column === selectedColumn && config.layout === "scroll") {
        tile.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    });
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (isConfirmOpen()) return;
    if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      toggleFlag(selectedRow, selectedColumn);
      return;
    }
    handleStandardGameKey(event, {
      onDirection: (direction) => {
        const shape = minesweeperShape(config);
        const next = moveGridPoint({ row: selectedRow, column: selectedColumn }, direction, shape.rows, shape.columns);
        selectedRow = next.row;
        selectedColumn = next.column;
        render();
      },
      onActivate: () => openCell(selectedRow, selectedColumn),
      onNextDifficulty: () => changeDifficulty(difficultyControl, "next"),
      onPreviousDifficulty: () => changeDifficulty(difficultyControl, "previous"),
      onReset: requestReset,
    });
  }

  function statusText(): string {
    if (state === "won") return "Cleared";
    if (state === "lost") return "Boom";
    return `${config.mines - flagMinesweeperCount(board)} mines`;
  }

  function openCell(row: number, column: number): void {
    if (state !== "playing") {
      invalidMove.trigger();
      return;
    }
    const cell = board[row]?.[column];
    if (!cell || cell.flag) {
      invalidMove.trigger();
      return;
    }
    if (cell.open) {
      chordCell(row, column);
      return;
    }

    markGameStarted(shell);

    if (firstMove) {
      board = seededMinesweeperBoard(config, row, column);
      firstMove = false;
    }

    const current = board[row]?.[column];
    if (!current) return;
    if (current.mine) {
      current.open = true;
      state = "lost";
    } else {
      floodOpenMinesweeperInPlace(board, config, row, column);
      const shape = minesweeperShape(config);
      if (openSafeMinesweeperCount(board) === shape.rows * shape.columns - config.mines) state = "won";
    }
    if (state !== "playing") markGameFinished(shell);
    if (state === "won") playSound("gameWin");
    else if (state === "lost") playSound("gameLose");
    else playSound("gameMove");
    render();
  }

  function chordCell(row: number, column: number): void {
    if (state !== "playing") {
      invalidMove.trigger();
      return;
    }
    const cell = board[row]?.[column];
    if (!cell?.open || cell.nearby === 0) {
      invalidMove.trigger();
      return;
    }

    const around = minesweeperNeighbors(config, row, column);
    const flagged = around.filter(([r, c]) => board[r]?.[c]?.flag).length;
    if (flagged !== cell.nearby) {
      invalidMove.trigger();
      return;
    }

    markGameStarted(shell);
    for (const [r, c] of around) {
      const next = board[r]?.[c];
      if (!next || next.open || next.flag) continue;
      if (next.mine) {
        next.open = true;
        state = "lost";
      } else {
        floodOpenMinesweeperInPlace(board, config, r, c);
      }
    }
    const shape = minesweeperShape(config);
    if (state !== "lost" && openSafeMinesweeperCount(board) === shape.rows * shape.columns - config.mines) state = "won";
    if (state !== "playing") markGameFinished(shell);
    if (state === "won") playSound("gameWin");
    else if (state === "lost") playSound("gameLose");
    else playSound("gameMove");
    render();
  }

  function toggleFlag(row: number, column: number): void {
    if (state !== "playing") {
      invalidMove.trigger();
      return;
    }
    const cell = board[row]?.[column];
    if (!cell || cell.open) {
      invalidMove.trigger();
      return;
    }
    markGameStarted(shell);
    cell.flag = !cell.flag;
    playSound("gameMove");
    render();
  }

  render();
  return () => {
    scope.cleanup();
    invalidMove.cleanup();
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

