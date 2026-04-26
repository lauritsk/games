import * as v from "valibot";
import {
  createArcadeModeController,
  createPauseButton,
  createPauseOverlay,
  createTouchControls,
  startFixedStepLoop,
  type FixedStepLoop,
} from "@games/shared/arcade";
import { createGameDifficultyControl, createResetControl } from "@games/shared/controls";
import {
  addTouchGestureControls,
  createGameShell,
  createMountScope,
  durationSince,
  el,
  gameLayouts,
  handleStandardGameKey,
  isConfirmOpen,
  integerSchema,
  markGameFinished,
  markGameStarted,
  onDocumentKeyDown,
  parseArray,
  parseStartedAt,
  parseWithSchema,
  pauseGameOnRequest,
  pauseOnFocusLoss,
  picklistSchema,
  resetGameProgress,
  setBoardGrid,
  setIconLabel,
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
  mazeChaseCellAt,
  mazeChaseColumns,
  mazeChaseRows,
  newMazeChaseState,
  queueMazeChaseDirection,
  stepMazeChase,
  type MazeChaseCell,
  type MazeChaseConfig,
  type MazeChaseGhost,
  type MazeChasePoint,
  type MazeChaseState,
} from "@games/maze-chase/logic";

type Mode = "ready" | "playing" | "paused" | "won" | "lost";

type SaveMazeChase = {
  difficulty: Difficulty;
  mode: Mode;
  state: MazeChaseState;
  startedAt: number | null;
};

const ticksPerSecond = 8;
const savePayloadVersion = 1;
const configs: Record<Difficulty, MazeChaseConfig> = {
  Easy: {
    lives: 4,
    powerTicks: 64,
    ghostMoveInterval: 3,
    dotScore: 10,
    powerScore: 50,
    ghostScore: 200,
    levelScore: 1_000,
    maxLevel: 2,
  },
  Medium: {
    lives: 3,
    powerTicks: 52,
    ghostMoveInterval: 2,
    dotScore: 10,
    powerScore: 50,
    ghostScore: 200,
    levelScore: 1_500,
    maxLevel: 3,
  },
  Hard: {
    lives: 3,
    powerTicks: 42,
    ghostMoveInterval: 1,
    dotScore: 10,
    powerScore: 50,
    ghostScore: 200,
    levelScore: 2_000,
    maxLevel: 4,
  },
};

const mazeChaseModeSchema = picklistSchema(["ready", "playing", "paused", "won", "lost"] as const);
const mazeChaseCellSchema = picklistSchema(["wall", "empty", "dot", "power"] as const);
const directionSchema = picklistSchema(["up", "right", "down", "left"] as const);
const saveMazeChaseBaseSchema = v.looseObject({
  difficulty: v.unknown(),
  mode: v.unknown(),
  state: v.unknown(),
  startedAt: v.unknown(),
});
const pointSchema = v.looseObject({ row: integerSchema, column: integerSchema });
const ghostBaseSchema = v.looseObject({
  id: integerSchema,
  start: v.unknown(),
  position: v.unknown(),
  direction: v.unknown(),
});
const stateBaseSchema = v.looseObject({
  columns: integerSchema,
  rows: integerSchema,
  cells: v.unknown(),
  player: v.unknown(),
  direction: v.unknown(),
  queuedDirection: v.unknown(),
  ghosts: v.unknown(),
  score: integerSchema,
  lives: integerSchema,
  level: integerSchema,
  tick: integerSchema,
  powerTicks: integerSchema,
  dotsRemaining: integerSchema,
  won: v.boolean(),
  lost: v.boolean(),
});

export const mazeChase: GameDefinition = {
  id: "maze-chase",
  name: "Maze Chase",
  tagline: "Dots, ghosts, power turns.",
  players: "Solo",
  theme: "deep-ocean",
  mount: mountMazeChase,
};

export function mountMazeChase(target: HTMLElement): () => void {
  const preferences = loadGamePreferences(mazeChase.id);
  let difficulty: Difficulty = parseDifficulty(preferences.difficulty) ?? "Medium";
  let state = newMazeChaseState(configs[difficulty]);
  let mode: Mode = "ready";
  let loop: FixedStepLoop | null = null;
  let runId = createRunId();
  let startedAt: number | null = null;

  const saved = loadGameSave(mazeChase.id, savePayloadVersion, parseSaveMazeChase);
  if (saved) {
    runId = saved.runId;
    difficulty = saved.payload.difficulty;
    state = saved.payload.state;
    mode = saved.payload.mode === "playing" ? "paused" : saved.payload.mode;
    startedAt = saved.payload.startedAt;
  }

  const { shell, status, actions, board, remove } = createGameShell(target, {
    gameClass: "maze-chase-game",
    boardClass: "board--maze-chase",
    boardLabel: "Maze Chase board",
    layout: gameLayouts.squareFit,
  });
  shell.tabIndex = 0;

  const scope = createMountScope();
  const invalidMove = createInvalidMoveFeedback(shell);
  const autosave = createAutosave({ gameId: mazeChase.id, scope, save: saveCurrentGame });
  const cellsLayer = el("div", { className: "maze-chase-cells" });
  const actorsLayer = el("div", { className: "maze-chase-actors" });
  const player = el("div", {
    className: "arcade-entity arcade-glow maze-chase-player",
    ariaLabel: "Maze runner",
  });
  const ghostsLayer = el("div", { className: "maze-chase-ghosts" });
  actorsLayer.append(ghostsLayer, player);
  board.append(cellsLayer, actorsLayer);

  const modeController = createArcadeModeController<Mode>({
    getMode: () => mode,
    setMode: (next) => {
      mode = next;
    },
    blockedStart: ["won", "lost"],
    blockedPause: ["won", "lost"],
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
  const overlay = createPauseOverlay(board, togglePause);
  createTouchControls(shell, {
    left: () => handleDirection("left"),
    up: () => handleDirection("up"),
    right: () => handleDirection("right"),
    down: () => handleDirection("down"),
  });

  const difficultyControl = createGameDifficultyControl(actions, {
    get: () => difficulty,
    set: (next: Difficulty) => {
      difficulty = next;
      savePreferences();
    },
    reset: resetGame,
  });
  const pauseButton = createPauseButton(actions, togglePause);
  const requestReset = createResetControl(actions, shell, resetGame);

  onDocumentKeyDown(onKeyDown, scope);
  pauseGameOnRequest(shell, scope, {
    canPause: () => mode === "playing",
    isPaused: () => mode === "paused",
    pause: togglePause,
  });
  pauseOnFocusLoss(scope, { isActive: () => mode === "playing", pause: togglePause });
  board.addEventListener("pointerdown", onPointerDown, { signal: scope.signal });
  addTouchGestureControls(
    board,
    {
      onTap: () => start(),
      onSwipe: (direction) => handleDirection(direction),
    },
    { signal: scope.signal, touchAction: "none" },
  );

  function resetGame(): void {
    stopTimer();
    clearGameSave(mazeChase.id);
    resetGameProgress(shell);
    runId = createRunId();
    startedAt = null;
    state = newMazeChaseState(configs[difficulty]);
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
      onActivate: start,
      onNextDifficulty: difficultyControl.next,
      onPreviousDifficulty: difficultyControl.previous,
      onReset: requestReset,
    });
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    const direction = directionTowardPointer(event);
    if (!direction) return;
    handleDirection(direction);
  }

  function handleDirection(direction: Direction): void {
    if (mode === "paused" || mode === "won" || mode === "lost" || isConfirmOpen()) {
      invalidMove.trigger();
      return;
    }
    start();
    state = queueMazeChaseDirection(state, direction);
    autosave.request();
    playSound("gameMove");
    render();
  }

  function tick(): void {
    const before = state;
    state = stepMazeChase(state, configs[difficulty]);
    afterStateChange(before);
  }

  function afterStateChange(before: MazeChaseState): void {
    if (state.won) {
      mode = "won";
      finishGame("won");
      playSound("gameWin");
    } else if (state.lost) {
      mode = "lost";
      finishGame("lost");
      playSound("gameLose");
    } else if (state.lives < before.lives) {
      mode = "ready";
      stopTimer();
      saveCurrentGame();
      playSound("gameLose");
    } else {
      autosave.request();
      playProgressSound(before);
    }
    render();
  }

  function playProgressSound(before: MazeChaseState): void {
    if (state.level > before.level || state.powerTicks > before.powerTicks) playSound("gameGood");
  }

  function render(): void {
    setBoardGrid(board, state.columns, state.rows);
    difficultyControl.sync();
    setIconLabel(
      pauseButton,
      mode === "paused" ? "▶" : "⏸",
      mode === "paused" ? "Resume" : "Pause",
    );
    overlay.setVisible(mode === "paused");
    board.dataset.mode = mode;
    board.dataset.power = state.powerTicks > 0 ? "true" : "false";
    status.textContent = statusText();
    renderCells();
    renderActors();
  }

  function renderCells(): void {
    const cells = syncChildren(cellsLayer, state.rows * state.columns, () =>
      el("div", { className: "maze-chase-cell" }),
    );
    cells.forEach((cell, index) => {
      const point = { row: Math.floor(index / state.columns), column: index % state.columns };
      const value = mazeChaseCellAt(state, point);
      cell.dataset.cell = value;
      cell.setAttribute("aria-label", cellLabel(point, value));
    });
  }

  function renderActors(): void {
    positionGridEntity(player, state.player.column, state.player.row, 1, 1);
    player.dataset.power = String(state.powerTicks > 0);

    const ghosts = syncChildren(ghostsLayer, state.ghosts.length, () =>
      el("div", { className: "arcade-entity maze-chase-ghost" }),
    );
    ghosts.forEach((ghostElement, index) => {
      const ghost = state.ghosts[index];
      if (!ghost) return;
      positionGridEntity(ghostElement, ghost.position.column, ghost.position.row, 1, 1);
      ghostElement.dataset.ghost = String(ghost.id);
      ghostElement.dataset.frightened = String(state.powerTicks > 0);
      ghostElement.setAttribute("aria-label", `Ghost ${ghost.id}`);
    });
  }

  function positionGridEntity(
    element: HTMLElement,
    column: number,
    row: number,
    width: number,
    height: number,
  ): void {
    element.style.left = `${(column / state.columns) * 100}%`;
    element.style.top = `${(row / state.rows) * 100}%`;
    element.style.width = `${(width / state.columns) * 100}%`;
    element.style.height = `${(height / state.rows) * 100}%`;
  }

  function directionTowardPointer(event: PointerEvent): Direction | null {
    const rect = board.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const column = Math.floor(((event.clientX - rect.left) / rect.width) * state.columns);
    const row = Math.floor(((event.clientY - rect.top) / rect.height) * state.rows);
    const deltaColumn = column - state.player.column;
    const deltaRow = row - state.player.row;
    if (Math.abs(deltaRow) >= Math.abs(deltaColumn)) {
      if (deltaRow < 0) return "up";
      if (deltaRow > 0) return "down";
    }
    if (deltaColumn < 0) return "left";
    if (deltaColumn > 0) return "right";
    return null;
  }

  function cellLabel(point: MazeChasePoint, cell: MazeChaseCell): string {
    return `Row ${point.row + 1}, column ${point.column + 1}, ${cell}`;
  }

  function statusText(): string {
    if (mode === "ready") return `Ready · ${state.score} · L${state.level}`;
    if (mode === "paused") return `Paused · ${state.score}`;
    if (mode === "won") return `Cleared · ${state.score}`;
    if (mode === "lost") return `Caught · ${state.score}`;
    const power =
      state.powerTicks > 0 ? ` · ⚡${Math.ceil(state.powerTicks / ticksPerSecond)}s` : "";
    return `${state.score} · L${state.level} · ${"♥".repeat(state.lives)} · ${state.dotsRemaining}${power}`;
  }

  function restartTimer(): void {
    if (mode !== "playing" || loop?.running) return;
    loop = startFixedStepLoop(tick, render, ticksPerSecond);
  }

  function stopTimer(): void {
    loop?.stop();
    loop = null;
  }

  function ensureStarted(): void {
    if (startedAt === null) startedAt = Date.now();
    markGameStarted(shell);
  }

  function finishGame(outcome: "won" | "lost"): void {
    markGameFinished(shell);
    stopTimer();
    recordGameResult({
      runId,
      gameId: mazeChase.id,
      difficulty,
      outcome,
      score: state.score,
      level: state.level,
      durationMs: durationMs(),
      metadata: { lives: state.lives, dotsRemaining: state.dotsRemaining },
    });
    clearGameSave(mazeChase.id);
  }

  function saveCurrentGame(): void {
    if (startedAt === null) return;
    if (mode === "won" || mode === "lost") {
      clearGameSave(mazeChase.id);
      return;
    }
    saveGameSave(mazeChase.id, savePayloadVersion, {
      runId,
      status: mode === "paused" ? "paused" : mode === "playing" ? "playing" : "ready",
      payload: { difficulty, mode, state, startedAt },
    });
  }

  function durationMs(): number | undefined {
    return durationSince(startedAt);
  }

  function savePreferences(): void {
    saveGamePreferences(mazeChase.id, { difficulty });
  }

  if (startedAt !== null) markGameStarted(shell);
  if (mode === "won" || mode === "lost") markGameFinished(shell);
  render();
  return () => {
    autosave.flush();
    stopTimer();
    invalidMove.cleanup();
    scope.cleanup();
    remove();
  };
}

function parseSaveMazeChase(value: unknown): SaveMazeChase | null {
  const parsed = parseWithSchema(saveMazeChaseBaseSchema, value);
  if (!parsed) return null;
  const difficulty = parseDifficulty(parsed.difficulty);
  const mode = parseMode(parsed.mode);
  const state = parseMazeChaseState(parsed.state);
  const startedAt = parseStartedAt(parsed.startedAt);
  if (!difficulty || !mode || !state || startedAt === undefined) return null;
  return { difficulty, mode, state, startedAt };
}

function parseMazeChaseState(value: unknown): MazeChaseState | null {
  const parsed = parseWithSchema(stateBaseSchema, value);
  if (!parsed || parsed.columns !== mazeChaseColumns || parsed.rows !== mazeChaseRows) return null;
  const cells = parseArray(parsed.cells, parseCell);
  const player = parsePoint(parsed.player);
  const direction = parseNullableDirection(parsed.direction);
  const queuedDirection = parseNullableDirection(parsed.queuedDirection);
  const ghosts = parseArray(parsed.ghosts, parseGhost);
  if (!cells || cells.length !== mazeChaseColumns * mazeChaseRows || !player || !ghosts)
    return null;
  return {
    columns: parsed.columns,
    rows: parsed.rows,
    cells,
    player,
    direction,
    queuedDirection,
    ghosts,
    score: parsed.score,
    lives: parsed.lives,
    level: parsed.level,
    tick: parsed.tick,
    powerTicks: parsed.powerTicks,
    dotsRemaining: parsed.dotsRemaining,
    won: parsed.won,
    lost: parsed.lost,
  };
}

function parsePoint(value: unknown): MazeChasePoint | null {
  return parseWithSchema(pointSchema, value);
}

function parseGhost(value: unknown): MazeChaseGhost | null {
  const parsed = parseWithSchema(ghostBaseSchema, value);
  if (!parsed) return null;
  const start = parsePoint(parsed.start);
  const position = parsePoint(parsed.position);
  const direction = parseDirection(parsed.direction);
  if (!start || !position || !direction) return null;
  return { id: parsed.id, start, position, direction };
}

function parseCell(value: unknown): MazeChaseCell | null {
  return parseWithSchema(mazeChaseCellSchema, value);
}

function parseMode(value: unknown): Mode | null {
  return parseWithSchema(mazeChaseModeSchema, value);
}

function parseDirection(value: unknown): Direction | null {
  return parseWithSchema(directionSchema, value);
}

function parseNullableDirection(value: unknown): Direction | null {
  return value === null ? null : parseDirection(value);
}
