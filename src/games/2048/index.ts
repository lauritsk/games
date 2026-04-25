import * as v from "valibot";
import {
  addTouchGestureControls,
  createGameShell,
  createMountScope,
  el,
  gameLayouts,
  handleStandardGameKey,
  finiteNumberSchema,
  nonNegativeFiniteNumberSchema,
  parseWithSchema,
  markGameFinished,
  markGameStarted,
  onDocumentKeyDown,
  resetGameProgress,
  setBoardGrid,
  setDifficultyIconLabel,
  syncChildren,
  type Difficulty,
  type Direction,
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
import {
  changeDifficulty,
  createDifficultyControl,
  createResetControl,
} from "@games/shared/controls";
import {
  addRandom2048Tile,
  canMove2048,
  slide2048,
  start2048Board,
  type Board2048,
} from "@games/2048/logic";

const sizes: Record<Difficulty, number> = { Easy: 3, Medium: 4, Hard: 5 };
const gameId = "2048";
const savePayloadVersion = 1;
const save2048BaseSchema = v.looseObject({
  difficulty: v.unknown(),
  size: finiteNumberSchema,
  board: v.unknown(),
  score: finiteNumberSchema,
  started: v.boolean(),
  finished: v.boolean(),
});

type Save2048 = {
  board: Board2048;
  score: number;
  difficulty: Difficulty;
  size: number;
  started: boolean;
  finished: boolean;
};

export const game2048: GameDefinition = {
  id: gameId,
  name: "2048",
  tagline: "Slide tiles. Merge numbers.",
  players: "Solo",
  theme: "outer-space",
  mount: mount2048,
};

export function mount2048(target: HTMLElement): () => void {
  const preferences = loadGamePreferences(gameId);
  let difficulty: Difficulty = parseDifficulty(preferences.difficulty) ?? "Medium";
  let size = sizes[difficulty];
  let board = start2048Board(size);
  let score = 0;
  let over = false;
  let started = false;
  let runId = createRunId();

  const saved = loadGameSave(gameId, savePayloadVersion, parseSave2048);
  if (saved) {
    runId = saved.runId;
    difficulty = saved.payload.difficulty;
    size = saved.payload.size;
    board = saved.payload.board;
    score = saved.payload.score;
    over = saved.payload.finished;
    started = saved.payload.started;
  }

  const {
    shell,
    status,
    actions,
    board: grid,
    remove,
  } = createGameShell(target, {
    gameClass: "game-2048",
    boardClass: "board--2048",
    boardLabel: "2048 board",
    layout: gameLayouts.squareFit,
  });
  shell.tabIndex = 0;

  const scope = createMountScope();
  const invalidMove = createInvalidMoveFeedback(shell);
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
  onDocumentKeyDown(onKeyDown, scope);
  addTouchGestureControls(grid, { onSwipe: move }, { signal: scope.signal, touchAction: "none" });
  const autosave = createAutosave({ gameId, scope, save: saveCurrentGame });

  function resetGame(): void {
    clearGameSave(gameId);
    resetGameProgress(shell);
    runId = createRunId();
    size = sizes[difficulty];
    board = start2048Board(size);
    score = 0;
    over = false;
    started = false;
    savePreferences();
    render();
  }

  function render(): void {
    setBoardGrid(grid, size);
    status.textContent = over ? `Done · ${score}` : String(score);
    setDifficultyIconLabel(difficultyButton, difficulty);

    const values = board.flat();
    const tiles = syncChildren(grid, values.length, () =>
      el("div", { className: "game-cell tile tile-2048" }),
    );
    values.forEach((value, index) => {
      const tile = tiles[index];
      if (!tile) return;
      tile.textContent = value ? String(value) : "";
      tile.dataset.value = String(value);
    });
  }

  function onKeyDown(event: KeyboardEvent): void {
    handleStandardGameKey(event, {
      onDirection: (direction) => move(direction),
      onActivate: requestReset,
      onNextDifficulty: () => changeDifficulty(difficultyControl, "next"),
      onPreviousDifficulty: () => changeDifficulty(difficultyControl, "previous"),
      onReset: requestReset,
    });
  }

  function move(direction: Direction): void {
    if (over) {
      invalidMove.trigger();
      return;
    }
    const result = slide2048(board, direction);
    if (!result.changed) {
      invalidMove.trigger();
      return;
    }
    markGameStarted(shell);
    started = true;
    board = addRandom2048Tile(result.board);
    score += result.score;
    over = !canMove2048(board);
    if (over) {
      markGameFinished(shell);
      recordGameResult({
        runId,
        gameId,
        difficulty,
        outcome: "lost",
        score,
        metadata: { maxTile: maxTile() },
      });
      clearGameSave(gameId);
    } else autosave.request();
    playSound(over ? "gameLose" : result.score > 0 ? "gameGood" : "gameMove");
    render();
  }

  function saveCurrentGame(): void {
    if (!started || over) {
      if (over) clearGameSave(gameId);
      return;
    }
    saveGameSave(gameId, savePayloadVersion, {
      runId,
      status: "playing",
      payload: { board, score, difficulty, size, started, finished: over },
    });
  }

  function savePreferences(): void {
    saveGamePreferences(gameId, { difficulty });
  }

  function maxTile(): number {
    return Math.max(...board.flat());
  }

  if (started) markGameStarted(shell);
  if (over) markGameFinished(shell);
  render();
  return () => {
    autosave.flush();
    scope.cleanup();
    invalidMove.cleanup();
    remove();
  };
}

function parseSave2048(value: unknown): Save2048 | null {
  const parsed = parseWithSchema(save2048BaseSchema, value);
  if (!parsed) return null;
  const difficulty = parseDifficulty(parsed.difficulty);
  if (!difficulty || sizes[difficulty] !== parsed.size) return null;
  const board = parseBoard2048(parsed.board, parsed.size);
  if (!board) return null;
  return {
    board,
    score: parsed.score,
    difficulty,
    size: parsed.size,
    started: parsed.started,
    finished: parsed.finished,
  };
}

function parseBoard2048(value: unknown, size: number): Board2048 | null {
  if (!Array.isArray(value) || value.length !== size) return null;
  const board = value.map((row) => {
    if (!Array.isArray(row) || row.length !== size) return null;
    const cells = row.map((cell) => parseWithSchema(nonNegativeFiniteNumberSchema, cell));
    if (cells.some((cell) => cell === null)) return null;
    return cells as number[];
  });
  return board.every((row): row is number[] => row !== null) ? board : null;
}
