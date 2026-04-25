import {
  applyGameLayout,
  createGameShell,
  createMountScope,
  durationSince,
  el,
  gameLayouts,
  handleStandardGameKey,
  isConfirmOpen,
  isIntegerInRange,
  isRecord,
  markGameFinished,
  markGameStarted,
  moveGridPoint,
  onDocumentKeyDown,
  parseOneOf,
  parseStartedAt,
  resetGameProgress,
  setBoardGrid,
  setSelected,
  syncChildren,
  type Difficulty,
  type GameDefinition,
} from "../core";
import { createInvalidMoveFeedback } from "../feedback";
import { loadGamePreferences, parseDifficulty, saveGamePreferences } from "../game-preferences";
import { recordGameResult } from "../game-results";
import {
  clearGameSave,
  createAutosave,
  createRunId,
  loadGameSave,
  saveGameSave,
} from "../game-state";
import { playSound } from "../sound";
import { changeDifficulty, createDifficultyControl, createResetControl } from "./controls";
import {
  flagMinesweeperCount,
  floodOpenMinesweeperInPlace,
  minesweeperNeighbors,
  minesweeperShape,
  newMinesweeperBoard,
  openSafeMinesweeperCount,
  seededMinesweeperBoard,
  type MinesweeperCell,
  type MinesweeperConfig,
} from "./minesweeper.logic";

type State = "playing" | "won" | "lost";

const configs: Record<Difficulty, MinesweeperConfig> = {
  Easy: { rows: 8, columns: 8, mines: 8, layout: "scroll" },
  Medium: { rows: 12, columns: 12, mines: 24, layout: "scroll" },
  Hard: { rows: 16, columns: 16, mines: 56, layout: "scroll" },
};
const savePayloadVersion = 1;

type SaveMinesweeper = {
  difficulty: Difficulty;
  config: MinesweeperConfig;
  board: MinesweeperCell[][];
  state: State;
  firstMove: boolean;
  selectedRow: number;
  selectedColumn: number;
  startedAt: number | null;
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
  const preferences = loadGamePreferences(minesweeper.id);
  let difficulty: Difficulty = parseDifficulty(preferences.difficulty) ?? "Medium";
  let config = configs[difficulty];
  let board = newMinesweeperBoard(config);
  let state: State = "playing";
  let firstMove = true;
  let selectedRow = 0;
  let selectedColumn = 0;
  let startedAt: number | null = null;
  let runId = createRunId();

  const saved = loadGameSave(minesweeper.id, savePayloadVersion, parseSaveMinesweeper);
  if (saved) {
    runId = saved.runId;
    difficulty = saved.payload.difficulty;
    config = saved.payload.config;
    board = saved.payload.board;
    state = saved.payload.state;
    firstMove = saved.payload.firstMove;
    selectedRow = saved.payload.selectedRow;
    selectedColumn = saved.payload.selectedColumn;
    startedAt = saved.payload.startedAt;
  }

  const {
    shell,
    status,
    actions,
    board: grid,
    remove,
  } = createGameShell(target, {
    gameClass: "minesweeper",
    boardClass: "board--minesweeper",
    boardLabel: "Minesweeper board",
    layout: gameLayouts.squareFit,
  });
  shell.tabIndex = 0;
  const scope = createMountScope();
  const invalidMove = createInvalidMoveFeedback(shell);
  onDocumentKeyDown(onKeyDown, scope);
  const autosave = createAutosave({ gameId: minesweeper.id, scope, save: saveCurrentGame });

  const difficultyControl = {
    get: () => difficulty,
    set: (next: Difficulty) => {
      difficulty = next;
      savePreferences();
    },
    reset: resetGame,
  };
  const difficultyButton = createDifficultyControl(actions, difficultyControl);
  const requestReset = createResetControl(actions, shell, resetGame);

  function resetGame(): void {
    clearGameSave(minesweeper.id);
    resetGameProgress(shell);
    runId = createRunId();
    config = configs[difficulty];
    board = newMinesweeperBoard(config);
    state = "playing";
    firstMove = true;
    selectedRow = 0;
    selectedColumn = 0;
    startedAt = null;
    savePreferences();
    render();
  }

  function render(): void {
    const shape = minesweeperShape(config);
    applyGameLayout(
      shell,
      config.layout === "scroll" ? gameLayouts.scrollGrid : gameLayouts.squareFit,
    );
    setBoardGrid(grid, {
      columns: shape.columns,
      rows: shape.rows,
      cellSize: config.layout === "scroll" ? gameLayouts.scrollGrid.cellSize : undefined,
    });
    status.textContent = statusText();
    difficultyButton.textContent = difficulty;

    const tiles = syncChildren(grid, shape.rows * shape.columns, () => {
      const tile = el("button", { className: "game-cell mine-cell", type: "button" });
      tile.addEventListener("click", () =>
        openCell(Number(tile.dataset.row), Number(tile.dataset.column)),
      );
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
      setSelected(tile, row === selectedRow && column === selectedColumn);
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
        const next = moveGridPoint(
          { row: selectedRow, column: selectedColumn },
          direction,
          shape.rows,
          shape.columns,
        );
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

    ensureStarted();

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
      if (openSafeMinesweeperCount(board) === shape.rows * shape.columns - config.mines)
        state = "won";
    }
    afterMove();
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

    ensureStarted();
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
    if (
      state !== "lost" &&
      openSafeMinesweeperCount(board) === shape.rows * shape.columns - config.mines
    )
      state = "won";
    afterMove();
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
    ensureStarted();
    cell.flag = !cell.flag;
    saveCurrentGame();
    playSound("gameMove");
    render();
  }

  function ensureStarted(): void {
    if (startedAt === null) startedAt = Date.now();
    markGameStarted(shell);
  }

  function afterMove(): void {
    if (state !== "playing") {
      markGameFinished(shell);
      recordGameResult({
        runId,
        gameId: minesweeper.id,
        difficulty,
        outcome: state === "won" ? "won" : "lost",
        durationMs: durationMs(),
        metadata: {
          flags: flagMinesweeperCount(board),
          revealed: openSafeMinesweeperCount(board),
        },
      });
      clearGameSave(minesweeper.id);
    } else saveCurrentGame();
    if (state === "won") playSound("gameWin");
    else if (state === "lost") playSound("gameLose");
    else playSound("gameMove");
  }

  function saveCurrentGame(): void {
    if (startedAt === null) return;
    if (state !== "playing") {
      clearGameSave(minesweeper.id);
      return;
    }
    saveGameSave(minesweeper.id, savePayloadVersion, {
      runId,
      status: "playing",
      payload: {
        difficulty,
        config,
        board,
        state,
        firstMove,
        selectedRow,
        selectedColumn,
        startedAt,
      },
    });
  }

  function durationMs(): number | undefined {
    return durationSince(startedAt);
  }

  function savePreferences(): void {
    saveGamePreferences(minesweeper.id, { difficulty });
  }

  if (startedAt !== null) markGameStarted(shell);
  if (state !== "playing") markGameFinished(shell);
  render();
  return () => {
    autosave.flush();
    scope.cleanup();
    invalidMove.cleanup();
    remove();
  };
}

function parseSaveMinesweeper(value: unknown): SaveMinesweeper | null {
  if (!isRecord(value)) return null;
  const difficulty = parseDifficulty(value.difficulty);
  if (!difficulty) return null;
  const config = parseConfig(value.config, configs[difficulty]);
  if (!config) return null;
  const shape = minesweeperShape(config);
  const board = parseBoard(value.board, shape.rows, shape.columns);
  if (!board) return null;
  const state = parseState(value.state);
  if (!state) return null;
  if (typeof value.firstMove !== "boolean") return null;
  if (
    !isIntegerInRange(value.selectedRow, shape.rows) ||
    !isIntegerInRange(value.selectedColumn, shape.columns)
  )
    return null;
  const startedAt = parseStartedAt(value.startedAt);
  if (startedAt === undefined) return null;
  return {
    difficulty,
    config,
    board,
    state,
    firstMove: value.firstMove,
    selectedRow: value.selectedRow,
    selectedColumn: value.selectedColumn,
    startedAt,
  };
}

function parseConfig(value: unknown, expected: MinesweeperConfig): MinesweeperConfig | null {
  if (!isRecord(value)) return null;
  if (value.mines !== expected.mines || value.layout !== expected.layout) return null;
  const expectedShape = minesweeperShape(expected);
  if (value.rows !== expectedShape.rows || value.columns !== expectedShape.columns) return null;
  return expected;
}

function parseBoard(value: unknown, rows: number, columns: number): MinesweeperCell[][] | null {
  if (!Array.isArray(value) || value.length !== rows) return null;
  const board = value.map((row) => {
    if (!Array.isArray(row) || row.length !== columns) return null;
    const cells = row.map(parseCell);
    return cells.every((cell): cell is MinesweeperCell => cell !== null) ? cells : null;
  });
  return board.every((row): row is MinesweeperCell[] => row !== null) ? board : null;
}

function parseCell(value: unknown): MinesweeperCell | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.mine !== "boolean" ||
    typeof value.open !== "boolean" ||
    typeof value.flag !== "boolean" ||
    typeof value.nearby !== "number" ||
    !Number.isInteger(value.nearby) ||
    value.nearby < 0 ||
    value.nearby > 8
  )
    return null;
  return { mine: value.mine, open: value.open, flag: value.flag, nearby: value.nearby };
}

function parseState(value: unknown): State | null {
  return parseOneOf(value, ["playing", "won", "lost"] as const);
}

function cellText(cell: MinesweeperCell): string {
  if (cell.flag) return "⚑";
  if (!cell.open) return "";
  if (cell.mine) return "✹";
  return cell.nearby > 0 ? String(cell.nearby) : "";
}

function labelFor(row: number, column: number, cell: MinesweeperCell): string {
  const value = cell.flag
    ? "flagged"
    : cell.open
      ? cell.mine
        ? "mine"
        : `${cell.nearby} nearby mines`
      : "closed";
  return `Row ${row + 1}, column ${column + 1}, ${value}`;
}
