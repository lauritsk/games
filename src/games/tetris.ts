import { createArcadeModeController, createPauseButton, createPauseOverlay } from "../arcade";
import {
  createGameShell,
  createMountScope,
  durationSince,
  el,
  gameLayouts,
  handleStandardGameKey,
  isConfirmOpen,
  isNonNegativeInteger,
  isPositiveInteger,
  isRecord,
  markGameFinished,
  markGameStarted,
  onDocumentKeyDown,
  parseStartedAt,
  pauseOnFocusLoss,
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
  moveTetrisPiece,
  newTetrisState,
  rotateTetrisPiece,
  tetrisColumns,
  tetrisDrop,
  tetrisGhostPiece,
  tetrisHardDrop,
  tetrisPieceCells,
  tetrisRows,
  tetrominoes,
  type Tetromino,
  type TetrisBoard,
  type TetrisCell,
  type TetrisPiece,
  type TetrisPoint,
  type TetrisState,
} from "./tetris.logic";

type Mode = "ready" | "playing" | "paused" | "over";
type Config = { speed: number };

type SaveTetris = {
  difficulty: Difficulty;
  mode: Mode;
  state: TetrisState;
  startedAt: number | null;
};

const configs: Record<Difficulty, Config> = {
  Easy: { speed: 720 },
  Medium: { speed: 520 },
  Hard: { speed: 340 },
};
const savePayloadVersion = 1;

export const tetris: GameDefinition = {
  id: "tetris",
  name: "Tetris",
  tagline: "Stack, rotate, clear lines.",
  players: "Solo",
  theme: "outer-space",
  mount: mountTetris,
};

export function mountTetris(target: HTMLElement): () => void {
  const preferences = loadGamePreferences(tetris.id);
  let difficulty: Difficulty = parseDifficulty(preferences.difficulty) ?? "Medium";
  let state = newTetrisState();
  let mode: Mode = "ready";
  let timer: ReturnType<typeof setInterval> | null = null;
  let runId = createRunId();
  let startedAt: number | null = null;

  const saved = loadGameSave(tetris.id, savePayloadVersion, parseSaveTetris);
  if (saved) {
    runId = saved.runId;
    difficulty = saved.payload.difficulty;
    state = saved.payload.state;
    mode = saved.payload.mode === "playing" ? "paused" : saved.payload.mode;
    startedAt = saved.payload.startedAt;
  }

  const { shell, status, actions, viewport, board, remove } = createGameShell(target, {
    gameClass: "tetris-game",
    boardClass: "board--tetris",
    boardLabel: "Tetris board",
    layout: gameLayouts.tallFit,
  });
  shell.tabIndex = 0;

  const scope = createMountScope();
  const invalidMove = createInvalidMoveFeedback(shell);
  const autosave = createAutosave({ gameId: tetris.id, scope, save: saveCurrentGame });
  const modeController = createArcadeModeController<Mode>({
    getMode: () => mode,
    setMode: (next) => {
      mode = next;
    },
    blockedStart: ["over"],
    blockedPause: ["over"],
    ready: "ready",
    playing: "playing",
    paused: "paused",
    onBlockedStart: () => invalidMove.trigger(),
    onFirstStart: () => {
      ensureStarted();
      playSound("gameMajor");
    },
    onPlaying: restartTimer,
    onPause: () => {
      stopTimer();
      saveCurrentGame();
      playSound("uiToggle");
    },
    afterChange: render,
  });
  const difficultyControl = {
    get: () => difficulty,
    set: (next: Difficulty) => {
      difficulty = next;
      savePreferences();
    },
    reset: resetGame,
  };
  const difficultyButton = createDifficultyControl(actions, difficultyControl);
  const pauseButton = createPauseButton(actions, togglePause);
  const overlay = createPauseOverlay(viewport, togglePause);
  const requestReset = createResetControl(actions, shell, resetGame);
  onDocumentKeyDown(onKeyDown, scope);
  pauseOnFocusLoss(scope, { isActive: () => mode === "playing", pause: togglePause });

  function resetGame(): void {
    stopTimer();
    clearGameSave(tetris.id);
    resetGameProgress(shell);
    runId = createRunId();
    startedAt = null;
    state = newTetrisState();
    mode = "ready";
    savePreferences();
    render();
  }

  function start(): void {
    modeController.start();
  }

  function togglePause(): void {
    modeController.togglePause();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (isConfirmOpen()) return;
    if (event.key.toLowerCase() === "p") {
      event.preventDefault();
      togglePause();
      return;
    }
    handleStandardGameKey(event, {
      onDirection: (direction) => handleDirection(direction),
      onActivate: () => hardDrop(),
      onNextDifficulty: () => changeDifficulty(difficultyControl, "next"),
      onPreviousDifficulty: () => changeDifficulty(difficultyControl, "previous"),
      onReset: requestReset,
    });
  }

  function handleDirection(direction: Direction): void {
    if (mode === "paused" || mode === "over") {
      invalidMove.trigger();
      return;
    }
    start();
    const before = state.piece;
    if (direction === "up")
      state = { ...state, piece: rotateTetrisPiece(state.board, state.piece) };
    else state = { ...state, piece: moveTetrisPiece(state.board, state.piece, direction) };
    if (state.piece === before) invalidMove.trigger();
    else {
      saveCurrentGame();
      playSound("gameMove");
    }
    render();
  }

  function hardDrop(): void {
    if (mode === "paused" || mode === "over") {
      invalidMove.trigger();
      return;
    }
    start();
    state = tetrisHardDrop(state);
    afterDrop(true);
  }

  function tick(): void {
    state = tetrisDrop(state);
    afterDrop(false);
  }

  function afterDrop(hard: boolean): void {
    if (state.over) {
      mode = "over";
      markGameFinished(shell);
      recordGameResult({
        runId,
        gameId: tetris.id,
        difficulty,
        outcome: "lost",
        score: state.score,
        level: state.level,
        durationMs: durationMs(),
        metadata: { lines: state.lines },
      });
      clearGameSave(tetris.id);
      stopTimer();
      playSound("gameLose");
    } else {
      autosave.request();
      restartTimer();
      playSound(hard ? "gameGood" : "gameMove");
    }
    render();
  }

  function render(): void {
    setBoardGrid(board, tetrisColumns, tetrisRows);
    difficultyButton.textContent = difficulty;
    pauseButton.textContent = mode === "paused" ? "Resume" : "Pause";
    overlay.setVisible(mode === "paused");
    status.textContent = statusText();

    const active = new Map(
      tetrisPieceCells(state.piece).map((cell) => [pointKey(cell), state.piece.type]),
    );
    const ghost = new Set(
      tetrisPieceCells(tetrisGhostPiece(state.board, state.piece)).map(pointKey),
    );
    const cells = syncChildren(board, tetrisRows * tetrisColumns, () =>
      el("div", { className: "tetris-cell" }),
    );
    cells.forEach((cell, index) => {
      const point = { row: Math.floor(index / tetrisColumns), column: index % tetrisColumns };
      const key = pointKey(point);
      const ghostOnly = ghost.has(key) && !active.has(key);
      const value = active.get(key) ?? state.board[point.row]?.[point.column] ?? "";
      cell.dataset.value = value;
      cell.dataset.active = String(active.has(key));
      cell.dataset.ghost = String(ghostOnly);
      cell.setAttribute("aria-label", labelFor(point, value, ghostOnly));
    });
  }

  function statusText(): string {
    if (mode === "ready") return `Ready · ${state.next} next`;
    if (mode === "paused") return `Paused · ${state.score}`;
    if (mode === "over") return `Over · ${state.score}`;
    return `${state.score} · L${state.level} · ${state.next}`;
  }

  function labelFor(point: TetrisPoint, value: TetrisCell, ghost: boolean): string {
    const content = ghost ? "landing preview" : value === "" ? "empty" : `${value} block`;
    return `Row ${point.row + 1}, column ${point.column + 1}, ${content}`;
  }

  function restartTimer(): void {
    if (mode !== "playing") return;
    stopTimer();
    const levelSpeed = Math.max(90, configs[difficulty].speed - (state.level - 1) * 35);
    timer = setInterval(tick, levelSpeed);
  }

  function stopTimer(): void {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  function pointKey(point: TetrisPoint): string {
    return `${point.row}:${point.column}`;
  }

  function ensureStarted(): void {
    if (startedAt === null) startedAt = Date.now();
    markGameStarted(shell);
  }

  function saveCurrentGame(): void {
    if (startedAt === null || mode === "over") return;
    saveGameSave(tetris.id, savePayloadVersion, {
      runId,
      status: mode === "paused" ? "paused" : mode === "playing" ? "playing" : "ready",
      payload: { difficulty, mode, state, startedAt },
    });
  }

  function durationMs(): number | undefined {
    return durationSince(startedAt);
  }

  function savePreferences(): void {
    saveGamePreferences(tetris.id, { difficulty });
  }

  if (startedAt !== null) markGameStarted(shell);
  if (mode === "over") markGameFinished(shell);
  render();
  return () => {
    autosave.flush();
    stopTimer();
    invalidMove.cleanup();
    scope.cleanup();
    remove();
  };
}

function parseSaveTetris(value: unknown): SaveTetris | null {
  if (!isRecord(value)) return null;
  const difficulty = parseDifficulty(value.difficulty);
  const mode = parseMode(value.mode);
  const state = parseTetrisState(value.state);
  const startedAt = parseStartedAt(value.startedAt);
  if (!difficulty || !mode || !state || startedAt === undefined) return null;
  return { difficulty, mode, state, startedAt };
}

function parseTetrisState(value: unknown): TetrisState | null {
  if (!isRecord(value)) return null;
  const board = parseBoard(value.board);
  const piece = parsePiece(value.piece);
  const next = parseTetromino(value.next);
  const bag = parseBag(value.bag);
  if (!board || !piece || !next || !bag) return null;
  if (!isNonNegativeInteger(value.score)) return null;
  if (!isNonNegativeInteger(value.lines)) return null;
  if (!isPositiveInteger(value.level)) return null;
  if (typeof value.over !== "boolean") return null;
  return {
    board,
    piece,
    next,
    bag,
    score: value.score,
    lines: value.lines,
    level: value.level,
    over: value.over,
  };
}

function parseBoard(value: unknown): TetrisBoard | null {
  if (!Array.isArray(value) || value.length !== tetrisRows) return null;
  const board = value.map((row) => {
    if (!Array.isArray(row) || row.length !== tetrisColumns) return null;
    const cells = row.map(parseCell);
    return cells.every((cell): cell is TetrisCell => cell !== null) ? cells : null;
  });
  return board.every((row): row is TetrisCell[] => row !== null) ? board : null;
}

function parseCell(value: unknown): TetrisCell | null {
  if (value === "") return "";
  return parseTetromino(value);
}

function parsePiece(value: unknown): TetrisPiece | null {
  if (!isRecord(value)) return null;
  const type = parseTetromino(value.type);
  const origin = parsePoint(value.origin);
  if (!type || !origin || !isNonNegativeInteger(value.rotation)) return null;
  return { type, origin, rotation: value.rotation };
}

function parsePoint(value: unknown): TetrisPoint | null {
  if (!isRecord(value)) return null;
  if (typeof value.row !== "number" || !Number.isInteger(value.row)) return null;
  if (typeof value.column !== "number" || !Number.isInteger(value.column)) return null;
  return { row: value.row, column: value.column };
}

function parseTetromino(value: unknown): Tetromino | null {
  return tetrominoes.includes(value as Tetromino) ? (value as Tetromino) : null;
}

function parseBag(value: unknown): Tetromino[] | null {
  if (!Array.isArray(value)) return null;
  const bag = value.map(parseTetromino);
  return bag.every((item): item is Tetromino => item !== null) ? bag : null;
}

function parseMode(value: unknown): Mode | null {
  return value === "ready" || value === "playing" || value === "paused" || value === "over"
    ? value
    : null;
}
