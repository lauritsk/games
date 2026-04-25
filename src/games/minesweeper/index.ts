import * as v from "valibot";
import {
  addTouchGestureControls,
  applyGameLayout,
  createGameShell,
  createMountScope,
  durationSince,
  el,
  gameLayouts,
  handleStandardGameKey,
  isConfirmOpen,
  integerBetweenSchema,
  integerRangeSchema,
  parseWithSchema,
  picklistSchema,
  markGameFinished,
  markGameStarted,
  moveGridPoint,
  onDocumentKeyDown,
  parseFixedGrid,
  parseStartedAt,
  resetGameProgress,
  setBoardGrid,
  setSelected,
  syncChildren,
  type Difficulty,
  type GameDefinition,
} from "@shared/core";
import { createInvalidMoveFeedback } from "@ui/feedback";
import {
  loadGamePreferences,
  parseDifficulty,
  saveGamePreferences,
} from "@games/shared/game-preferences";
import { recordGameResult } from "@features/results/game-results";
import {
  clearGameSave,
  createAutosave,
  createRunId,
  loadGameSave,
  saveGameSave,
} from "@games/shared/game-state";
import { playSound } from "@ui/sound";
import { createGameDifficultyControl, createResetControl } from "@games/shared/controls";
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
} from "@games/minesweeper/logic";

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

const minesweeperStateSchema = picklistSchema(["playing", "won", "lost"] as const);
const minesweeperCellSchema = v.object({
  mine: v.boolean(),
  open: v.boolean(),
  flag: v.boolean(),
  nearby: integerBetweenSchema(0, 8),
});
const saveMinesweeperBaseSchema = v.looseObject({
  difficulty: v.unknown(),
  config: v.unknown(),
  board: v.unknown(),
  state: v.unknown(),
  firstMove: v.boolean(),
  selectedRow: v.unknown(),
  selectedColumn: v.unknown(),
  startedAt: v.unknown(),
});
const minesweeperConfigBaseSchema = v.looseObject({
  rows: v.unknown(),
  columns: v.unknown(),
  mines: v.unknown(),
  layout: v.unknown(),
});

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

  const difficultyControl = createGameDifficultyControl(actions, {
    get: () => difficulty,
    set: (next: Difficulty) => {
      difficulty = next;
      savePreferences();
    },
    reset: resetGame,
  });
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
    difficultyControl.sync();

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
      addTouchGestureControls(
        tile,
        {
          onLongPress: () => toggleFlag(Number(tile.dataset.row), Number(tile.dataset.column)),
        },
        { signal: scope.signal, touchAction: "manipulation" },
      );
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
      onNextDifficulty: difficultyControl.next,
      onPreviousDifficulty: difficultyControl.previous,
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
  const parsed = parseWithSchema(saveMinesweeperBaseSchema, value);
  if (!parsed) return null;
  const difficulty = parseDifficulty(parsed.difficulty);
  if (!difficulty) return null;
  const config = parseConfig(parsed.config, configs[difficulty]);
  if (!config) return null;
  const shape = minesweeperShape(config);
  const board = parseBoard(parsed.board, shape.rows, shape.columns);
  if (!board) return null;
  const state = parseState(parsed.state);
  if (!state) return null;
  const selectedRow = parseWithSchema(integerRangeSchema(0, shape.rows), parsed.selectedRow);
  const selectedColumn = parseWithSchema(
    integerRangeSchema(0, shape.columns),
    parsed.selectedColumn,
  );
  if (selectedRow === null || selectedColumn === null) return null;
  const startedAt = parseStartedAt(parsed.startedAt);
  if (startedAt === undefined) return null;
  return {
    difficulty,
    config,
    board,
    state,
    firstMove: parsed.firstMove,
    selectedRow,
    selectedColumn,
    startedAt,
  };
}

function parseConfig(value: unknown, expected: MinesweeperConfig): MinesweeperConfig | null {
  const parsed = parseWithSchema(minesweeperConfigBaseSchema, value);
  if (!parsed) return null;
  if (parsed.mines !== expected.mines || parsed.layout !== expected.layout) return null;
  const expectedShape = minesweeperShape(expected);
  if (parsed.rows !== expectedShape.rows || parsed.columns !== expectedShape.columns) return null;
  return expected;
}

function parseBoard(value: unknown, rows: number, columns: number): MinesweeperCell[][] | null {
  return parseFixedGrid(value, rows, columns, parseCell);
}

function parseCell(value: unknown): MinesweeperCell | null {
  return parseWithSchema(minesweeperCellSchema, value);
}

function parseState(value: unknown): State | null {
  return parseWithSchema(minesweeperStateSchema, value);
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
