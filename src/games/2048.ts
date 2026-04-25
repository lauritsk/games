import {
  createGameShell,
  createMountScope,
  el,
  gameLayouts,
  handleStandardGameKey,
  markGameFinished,
  markGameStarted,
  onDocumentKeyDown,
  resetGameProgress,
  setBoardGrid,
  syncChildren,
  type Difficulty,
  type Direction,
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
  addRandom2048Tile,
  canMove2048,
  slide2048,
  start2048Board,
  type Board2048,
} from "./2048.logic";

const sizes: Record<Difficulty, number> = { Easy: 3, Medium: 4, Hard: 5 };
const gameId = "2048";
const savePayloadVersion = 1;

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
    difficultyButton.textContent = difficulty;

    const values = board.flat();
    const tiles = syncChildren(grid, values.length, () =>
      el("div", { className: "tile tile-2048" }),
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
  if (!isRecord(value)) return null;
  const difficulty = parseDifficulty(value.difficulty);
  if (!difficulty) return null;
  const size = value.size;
  if (typeof size !== "number" || sizes[difficulty] !== size) return null;
  const board = parseBoard2048(value.board, size);
  if (!board) return null;
  if (typeof value.score !== "number" || !Number.isFinite(value.score)) return null;
  if (typeof value.started !== "boolean" || typeof value.finished !== "boolean") return null;
  return {
    board,
    score: value.score,
    difficulty,
    size,
    started: value.started,
    finished: value.finished,
  };
}

function parseBoard2048(value: unknown, size: number): Board2048 | null {
  if (!Array.isArray(value) || value.length !== size) return null;
  const board = value.map((row) => {
    if (!Array.isArray(row) || row.length !== size) return null;
    if (row.some((cell) => typeof cell !== "number" || !Number.isFinite(cell) || cell < 0))
      return null;
    return [...row] as number[];
  });
  return board.every((row): row is number[] => row !== null) ? board : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
