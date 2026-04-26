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
  createDelayedAction,
  createGameShell,
  createMountScope,
  durationSince,
  el,
  gameLayouts,
  handleStandardGameKey,
  isConfirmOpen,
  finiteNumberSchema,
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
  baseFroggerLaneProfiles,
  froggerColumns,
  froggerHomeColumns,
  froggerHomeIndexForColumn,
  froggerLaneAt,
  froggerRideAt,
  froggerRows,
  moveFrogger,
  newFroggerState,
  stepFrogger,
  type FroggerConfig,
  type FroggerLane,
  type FroggerLaneKind,
  type FroggerLaneObject,
  type FroggerObjectKind,
  type FroggerPoint,
  type FroggerState,
} from "@games/frogger/logic";

type Mode = "ready" | "playing" | "paused" | "won" | "lost";

type SaveFrogger = {
  difficulty: Difficulty;
  mode: Mode;
  state: FroggerState;
  startedAt: number | null;
};

const ticksPerSecond = 8;
const savePayloadVersion = 1;
const configs: Record<Difficulty, FroggerConfig> = {
  Easy: {
    lives: 5,
    timeLimitTicks: 72 * ticksPerSecond,
    speedMultiplier: 0.78,
    levelSpeedGrowth: 0.06,
    maxLevel: 3,
    laneProfiles: baseFroggerLaneProfiles,
  },
  Medium: {
    lives: 4,
    timeLimitTicks: 60 * ticksPerSecond,
    speedMultiplier: 1,
    levelSpeedGrowth: 0.08,
    maxLevel: 4,
    laneProfiles: baseFroggerLaneProfiles,
  },
  Hard: {
    lives: 3,
    timeLimitTicks: 50 * ticksPerSecond,
    speedMultiplier: 1.22,
    levelSpeedGrowth: 0.1,
    maxLevel: 5,
    laneProfiles: baseFroggerLaneProfiles,
  },
};

const froggerModeSchema = picklistSchema(["ready", "playing", "paused", "won", "lost"] as const);
const froggerLaneKindSchema = picklistSchema(["goal", "safe", "road", "water"] as const);
const froggerObjectKindSchema = picklistSchema(["car", "truck", "log", "turtle"] as const);
const saveFroggerBaseSchema = v.looseObject({
  difficulty: v.unknown(),
  mode: v.unknown(),
  state: v.unknown(),
  startedAt: v.unknown(),
});
const froggerPointSchema = v.looseObject({ row: finiteNumberSchema, column: finiteNumberSchema });
const froggerObjectBaseSchema = v.looseObject({
  id: integerSchema,
  kind: v.unknown(),
  x: finiteNumberSchema,
  length: finiteNumberSchema,
  speed: finiteNumberSchema,
});
const froggerLaneBaseSchema = v.looseObject({
  row: integerSchema,
  kind: v.unknown(),
  objects: v.unknown(),
});
const froggerStateBaseSchema = v.looseObject({
  columns: integerSchema,
  rows: integerSchema,
  frog: v.unknown(),
  lanes: v.unknown(),
  homes: v.unknown(),
  score: finiteNumberSchema,
  lives: finiteNumberSchema,
  level: finiteNumberSchema,
  ticksRemaining: finiteNumberSchema,
  reachedRow: finiteNumberSchema,
  tick: finiteNumberSchema,
  won: v.boolean(),
  lost: v.boolean(),
});

export const frogger: GameDefinition = {
  id: "frogger",
  name: "Frogger",
  tagline: "Hop lanes. Ride logs. Reach home.",
  players: "Solo",
  theme: "deep-forest",
  mount: mountFrogger,
};

export function mountFrogger(target: HTMLElement): () => void {
  const preferences = loadGamePreferences(frogger.id);
  let difficulty: Difficulty = parseDifficulty(preferences.difficulty) ?? "Medium";
  let state = newFroggerState(configs[difficulty]);
  let mode: Mode = "ready";
  let loop: FixedStepLoop | null = null;
  let runId = createRunId();
  let startedAt: number | null = null;

  const saved = loadGameSave(frogger.id, savePayloadVersion, parseSaveFrogger);
  if (saved) {
    runId = saved.runId;
    difficulty = saved.payload.difficulty;
    state = saved.payload.state;
    mode = saved.payload.mode === "playing" ? "paused" : saved.payload.mode;
    startedAt = saved.payload.startedAt;
  }

  const { shell, status, actions, board, remove } = createGameShell(target, {
    gameClass: "frogger-game",
    boardClass: "board--frogger",
    boardLabel: "Frogger crossing board",
    layout: gameLayouts.squareFit,
  });
  shell.tabIndex = 0;

  const scope = createMountScope();
  const invalidMove = createInvalidMoveFeedback(shell);
  const lifeLostReset = createDelayedAction();
  const autosave = createAutosave({ gameId: frogger.id, scope, save: saveCurrentGame });
  const cellsLayer = el("div", { className: "frogger-cells" });
  const objectsLayer = el("div", { className: "frogger-objects" });
  const frog = el("div", {
    className: "arcade-entity arcade-glow frogger-frog",
    ariaLabel: "Frog",
  });
  board.append(cellsLayer, objectsLayer, frog);

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
    clearGameSave(frogger.id);
    lifeLostReset.clear();
    shell.dataset.lifeLost = "false";
    resetGameProgress(shell);
    runId = createRunId();
    startedAt = null;
    state = newFroggerState(configs[difficulty]);
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
    const before = state;
    state = moveFrogger(state, direction, configs[difficulty]);
    if (state === before) {
      invalidMove.trigger();
      return;
    }
    afterStateChange(before, "move");
  }

  function tick(): void {
    const before = state;
    state = stepFrogger(state, configs[difficulty]);
    afterStateChange(before, "tick");
  }

  function afterStateChange(before: FroggerState, source: "move" | "tick"): void {
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
      showLifeLost();
      saveCurrentGame();
      playSound("gameLose");
    } else {
      autosave.request();
      playProgressSound(before, source);
    }
    render();
  }

  function playProgressSound(before: FroggerState, source: "move" | "tick"): void {
    if (
      state.level > before.level ||
      state.homes.some((home, index) => home && !before.homes[index])
    ) {
      playSound("gameGood");
    } else if (source === "move") playSound("gameMove");
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
    board.dataset.timer = state.ticksRemaining <= ticksPerSecond * 10 ? "low" : "ok";
    status.textContent = statusText();
    renderCells();
    renderObjects();
    renderFrog();
  }

  function renderCells(): void {
    const cells = syncChildren(cellsLayer, state.rows * state.columns, () =>
      el("div", { className: "frogger-cell" }),
    );
    cells.forEach((cell, index) => {
      const point = { row: Math.floor(index / state.columns), column: index % state.columns };
      const lane = froggerLaneAt(state, point.row);
      const homeIndex = point.row === 0 ? froggerHomeIndexForColumn(point.column, 0.1) : -1;
      cell.dataset.lane = lane?.kind ?? "safe";
      cell.dataset.home = homeIndex < 0 ? "none" : state.homes[homeIndex] ? "filled" : "open";
      cell.textContent = homeIndex >= 0 && state.homes[homeIndex] ? "●" : "";
      cell.setAttribute("aria-label", cellLabel(point, lane?.kind ?? "safe", homeIndex));
    });
  }

  function renderObjects(): void {
    const objects = state.lanes.flatMap((lane) => lane.objects.map((object) => ({ lane, object })));
    const children = syncChildren(objectsLayer, objects.length, () =>
      el("div", { className: "arcade-entity frogger-object" }),
    );
    children.forEach((child, index) => {
      const entry = objects[index];
      if (!entry) return;
      const { lane, object } = entry;
      positionGridEntity(child, object.x, lane.row, object.length, 1);
      child.dataset.kind = object.kind;
      child.dataset.direction = object.speed >= 0 ? "right" : "left";
      child.setAttribute("aria-label", objectLabel(object, lane.row));
    });
  }

  function renderFrog(): void {
    positionGridEntity(frog, state.frog.column, state.frog.row, 1, 1);
    frog.dataset.riding = String(froggerRideAt(state, state.frog) !== null);
    frog.dataset.lifeLost = String(shell.dataset.lifeLost === "true");
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
    const deltaColumn = column - state.frog.column;
    const deltaRow = row - state.frog.row;
    if (Math.abs(deltaRow) >= Math.abs(deltaColumn)) {
      if (deltaRow < 0) return "up";
      if (deltaRow > 0) return "down";
    }
    if (deltaColumn < 0) return "left";
    if (deltaColumn > 0) return "right";
    return null;
  }

  function cellLabel(point: FroggerPoint, lane: FroggerLaneKind, homeIndex: number): string {
    if (homeIndex >= 0) {
      return `Row ${point.row + 1}, column ${point.column + 1}, ${state.homes[homeIndex] ? "filled home" : "open home"}`;
    }
    return `Row ${point.row + 1}, column ${point.column + 1}, ${lane} lane`;
  }

  function objectLabel(object: FroggerLaneObject, row: number): string {
    const direction = object.speed >= 0 ? "right" : "left";
    return `${object.kind} on row ${row + 1}, moving ${direction}`;
  }

  function statusText(): string {
    if (mode === "ready") return `Ready · ${state.score} · L${state.level}`;
    if (mode === "paused") return `Paused · ${state.score}`;
    if (mode === "won") return `Home · ${state.score}`;
    if (mode === "lost") return `Out · ${state.score}`;
    return `${state.score} · L${state.level} · ${"♥".repeat(state.lives)} · ${secondsRemaining()}s`;
  }

  function secondsRemaining(): number {
    return Math.max(0, Math.ceil(state.ticksRemaining / ticksPerSecond));
  }

  function showLifeLost(): void {
    shell.dataset.lifeLost = "true";
    lifeLostReset.start(() => {
      shell.dataset.lifeLost = "false";
      renderFrog();
    }, 820);
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
      gameId: frogger.id,
      difficulty,
      outcome,
      score: state.score,
      level: state.level,
      durationMs: durationMs(),
      metadata: { lives: state.lives, homes: state.homes.filter(Boolean).length },
    });
    clearGameSave(frogger.id);
  }

  function saveCurrentGame(): void {
    if (startedAt === null) return;
    if (mode === "won" || mode === "lost") {
      clearGameSave(frogger.id);
      return;
    }
    saveGameSave(frogger.id, savePayloadVersion, {
      runId,
      status: mode === "paused" ? "paused" : mode === "playing" ? "playing" : "ready",
      payload: { difficulty, mode, state, startedAt },
    });
  }

  function durationMs(): number | undefined {
    return durationSince(startedAt);
  }

  function savePreferences(): void {
    saveGamePreferences(frogger.id, { difficulty });
  }

  if (startedAt !== null) markGameStarted(shell);
  if (mode === "won" || mode === "lost") markGameFinished(shell);
  render();
  return () => {
    autosave.flush();
    stopTimer();
    lifeLostReset.clear();
    invalidMove.cleanup();
    scope.cleanup();
    remove();
  };
}

function parseSaveFrogger(value: unknown): SaveFrogger | null {
  const parsed = parseWithSchema(saveFroggerBaseSchema, value);
  if (!parsed) return null;
  const difficulty = parseDifficulty(parsed.difficulty);
  const mode = parseMode(parsed.mode);
  const state = parseFroggerState(parsed.state);
  const startedAt = parseStartedAt(parsed.startedAt);
  if (!difficulty || !mode || !state || startedAt === undefined) return null;
  return { difficulty, mode, state, startedAt };
}

function parseFroggerState(value: unknown): FroggerState | null {
  const parsed = parseWithSchema(froggerStateBaseSchema, value);
  if (!parsed || parsed.columns !== froggerColumns || parsed.rows !== froggerRows) return null;
  const frog = parsePoint(parsed.frog);
  const lanes = parseArray(parsed.lanes, parseLane);
  const homes = parseHomes(parsed.homes);
  if (!frog || !lanes || !homes) return null;
  return {
    columns: parsed.columns,
    rows: parsed.rows,
    frog,
    lanes,
    homes,
    score: parsed.score,
    lives: parsed.lives,
    level: parsed.level,
    ticksRemaining: parsed.ticksRemaining,
    reachedRow: parsed.reachedRow,
    tick: parsed.tick,
    won: parsed.won,
    lost: parsed.lost,
  };
}

function parsePoint(value: unknown): FroggerPoint | null {
  return parseWithSchema(froggerPointSchema, value);
}

function parseLane(value: unknown): FroggerLane | null {
  const parsed = parseWithSchema(froggerLaneBaseSchema, value);
  if (!parsed) return null;
  const kind = parseLaneKind(parsed.kind);
  const objects = parseArray(parsed.objects, parseLaneObject);
  if (!kind || !objects) return null;
  return { row: parsed.row, kind, objects };
}

function parseLaneObject(value: unknown): FroggerLaneObject | null {
  const parsed = parseWithSchema(froggerObjectBaseSchema, value);
  if (!parsed) return null;
  const kind = parseObjectKind(parsed.kind);
  if (!kind) return null;
  return {
    id: parsed.id,
    kind,
    x: parsed.x,
    length: parsed.length,
    speed: parsed.speed,
  };
}

function parseHomes(value: unknown): boolean[] | null {
  const homes = parseArray(value, parseBoolean);
  return homes && homes.length === froggerHomeColumns.length ? homes : null;
}

function parseBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function parseMode(value: unknown): Mode | null {
  return parseWithSchema(froggerModeSchema, value);
}

function parseLaneKind(value: unknown): FroggerLaneKind | null {
  return parseWithSchema(froggerLaneKindSchema, value);
}

function parseObjectKind(value: unknown): FroggerObjectKind | null {
  return parseWithSchema(froggerObjectKindSchema, value);
}
