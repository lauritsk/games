import * as v from "valibot";
import {
  createPauseButton,
  createPauseOverlay,
  parseRect,
  positionCirclePercent,
  positionPercent,
  startFixedStepLoop,
  syncPositionedChildren,
  type FixedStepLoop,
} from "@games/shared/arcade";
import { createGameDifficultyControl, createResetControl } from "@games/shared/controls";
import {
  createGameShell,
  createMountScope,
  durationSince,
  el,
  finiteNumberSchema,
  gameLayouts,
  handleStandardGameKey,
  isConfirmOpen,
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
  setIconLabel,
  type Difficulty,
  type Direction,
  type GameDefinition,
} from "@shared/core";
import { recordGameResult } from "@features/results/game-results";
import {
  clearGameSave,
  createAutosave,
  createRunId,
  loadGameSave,
  saveGameSave,
} from "@games/shared/game-state";
import {
  loadGamePreferences,
  parseDifficulty,
  saveGamePreferences,
} from "@games/shared/game-preferences";
import { createInvalidMoveFeedback } from "@ui/feedback";
import { playSound } from "@ui/sound";
import {
  ballzAimVector,
  ballzLauncherY,
  ballzPickupRadius,
  clampBallzAim,
  launchBallzVolley,
  newBallzState,
  rotateBallzAim,
  stepBallz,
  type BallzBall,
  type BallzBrick,
  type BallzConfig,
  type BallzLaunch,
  type BallzPhase,
  type BallzPickup,
  type BallzState,
  type BallzVector,
} from "@games/ballz/logic";

const configs: Record<Difficulty, BallzConfig> = {
  Easy: {
    columns: 7,
    startingBalls: 1,
    ballSpeed: 1.18,
    launchInterval: 3,
    spawnDensity: 0.48,
    pickupChance: 0.72,
    hpScale: 0.78,
    hpVariance: 1,
    dangerY: 86,
    rowStep: 8,
    brickGap: 1.2,
    horizontalMargin: 5,
    topMargin: 7,
    brickHeight: 5.8,
  },
  Medium: {
    columns: 8,
    startingBalls: 1,
    ballSpeed: 1.32,
    launchInterval: 3,
    spawnDensity: 0.56,
    pickupChance: 0.62,
    hpScale: 0.96,
    hpVariance: 2,
    dangerY: 85,
    rowStep: 7.6,
    brickGap: 1.1,
    horizontalMargin: 4.5,
    topMargin: 7,
    brickHeight: 5.6,
  },
  Hard: {
    columns: 9,
    startingBalls: 1,
    ballSpeed: 1.48,
    launchInterval: 2,
    spawnDensity: 0.64,
    pickupChance: 0.54,
    hpScale: 1.16,
    hpVariance: 3,
    dangerY: 84,
    rowStep: 7.2,
    brickGap: 1,
    horizontalMargin: 4,
    topMargin: 7,
    brickHeight: 5.4,
  },
};

type Mode = "aiming" | "playing" | "paused" | "lost";

type SaveBallz = {
  difficulty: Difficulty;
  mode: Mode;
  state: BallzState;
  aim: BallzVector;
  startedAt: number | null;
};

const savePayloadVersion = 1;
const ballzModeSchema = picklistSchema(["aiming", "playing", "paused", "lost"] as const);
const ballzPhaseSchema = picklistSchema(["aiming", "running", "lost"] as const);
const saveBallzBaseSchema = v.looseObject({
  difficulty: v.unknown(),
  mode: v.unknown(),
  state: v.unknown(),
  aim: v.unknown(),
  startedAt: v.unknown(),
});
const ballzStateBaseSchema = v.looseObject({
  width: finiteNumberSchema,
  height: finiteNumberSchema,
  launcherX: finiteNumberSchema,
  launcherY: finiteNumberSchema,
  balls: v.unknown(),
  bricks: v.unknown(),
  pickups: v.unknown(),
  ballCount: finiteNumberSchema,
  collectedBalls: finiteNumberSchema,
  round: finiteNumberSchema,
  score: finiteNumberSchema,
  phase: v.unknown(),
  launch: v.unknown(),
  firstSettledX: v.unknown(),
  nextId: finiteNumberSchema,
  lost: v.boolean(),
});
const ballzCircleSchema = v.looseObject({
  id: finiteNumberSchema,
  x: finiteNumberSchema,
  y: finiteNumberSchema,
  radius: finiteNumberSchema,
});
const ballzBallExtrasSchema = v.looseObject({ vx: finiteNumberSchema, vy: finiteNumberSchema });
const ballzBrickExtrasSchema = v.looseObject({
  id: finiteNumberSchema,
  hp: finiteNumberSchema,
  maxHp: finiteNumberSchema,
});
const ballzLaunchSchema = v.looseObject({
  remaining: finiteNumberSchema,
  delay: finiteNumberSchema,
  vx: finiteNumberSchema,
  vy: finiteNumberSchema,
});
const ballzVectorSchema = v.looseObject({ x: finiteNumberSchema, y: finiteNumberSchema });

export const ballz: GameDefinition = {
  id: "ballz",
  name: "Ballz",
  tagline: "Aim the volley. Break the numbers.",
  players: "Solo",
  theme: "deep-cave",
  mount: mountBallz,
};

export function mountBallz(target: HTMLElement): () => void {
  const preferences = loadGamePreferences(ballz.id);
  let difficulty: Difficulty = parseDifficulty(preferences.difficulty) ?? "Medium";
  let state = newBallzState(configs[difficulty]);
  let aim = defaultAim(configs[difficulty]);
  let mode: Mode = "aiming";
  let loop: FixedStepLoop | null = null;
  let runId = createRunId();
  let startedAt: number | null = null;
  let activePointerId: number | null = null;

  const saved = loadGameSave(ballz.id, savePayloadVersion, parseSaveBallz);
  if (saved) {
    runId = saved.runId;
    difficulty = saved.payload.difficulty;
    state = saved.payload.state;
    aim = clampBallzAim(saved.payload.aim, configs[difficulty].ballSpeed);
    mode = saved.payload.mode === "playing" ? "paused" : saved.payload.mode;
    startedAt = saved.payload.startedAt;
  }

  const { shell, status, actions, board, remove } = createGameShell(target, {
    gameClass: "ballz-game",
    boardClass: "board--ballz",
    boardLabel: "Ballz playfield",
    layout: gameLayouts.portraitFit,
  });
  shell.tabIndex = 0;

  const scope = createMountScope();
  const invalidMove = createInvalidMoveFeedback(shell);
  const autosave = createAutosave({ gameId: ballz.id, scope, save: saveCurrentGame });
  const bricks = el("div", { className: "ballz-bricks" });
  const pickups = el("div", { className: "ballz-pickups" });
  const balls = el("div", { className: "ballz-balls" });
  const dangerLine = el("div", { className: "ballz-danger-line", ariaLabel: "Danger line" });
  const aimGuide = el("div", { className: "ballz-aim-guide", ariaLabel: "Aim guide" });
  const launcher = el("div", { className: "arcade-entity arcade-glow ballz-launcher" });
  board.append(dangerLine, aimGuide, bricks, pickups, balls, launcher);

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
  const overlay = createPauseOverlay(board, togglePause);

  onDocumentKeyDown(onKeyDown, scope);
  pauseGameOnRequest(shell, scope, {
    canPause: () => mode === "playing",
    isPaused: () => mode === "paused",
    pause: togglePause,
  });
  pauseOnFocusLoss(scope, { isActive: () => mode === "playing", pause: togglePause });
  board.addEventListener("pointerdown", onPointerDown, { signal: scope.signal });
  board.addEventListener("pointermove", onPointerMove, { signal: scope.signal });
  board.addEventListener("pointerup", onPointerUp, { signal: scope.signal });
  board.addEventListener("pointercancel", cancelPointer, { signal: scope.signal });

  function resetGame(): void {
    stopTimer();
    clearGameSave(ballz.id);
    resetGameProgress(shell);
    runId = createRunId();
    startedAt = null;
    state = newBallzState(configs[difficulty]);
    aim = defaultAim(configs[difficulty]);
    mode = "aiming";
    activePointerId = null;
    savePreferences();
    render();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (isConfirmOpen()) return;
    if (event.key.toLowerCase() === "p") {
      event.preventDefault();
      togglePause();
      return;
    }
    if (event.key.toLowerCase() === "r") {
      event.preventDefault();
      requestReset();
      return;
    }
    handleStandardGameKey(event, {
      onDirection: aimByDirection,
      onActivate: launchCurrentVolley,
      onNextDifficulty: difficultyControl.next,
      onPreviousDifficulty: difficultyControl.previous,
      onReset: requestReset,
    });
  }

  function aimByDirection(direction: Direction): void {
    if (!canAim()) return;
    if (direction === "up") aim = defaultAim(configs[difficulty]);
    else if (direction === "left") aim = rotateBallzAim(aim, -0.09, configs[difficulty].ballSpeed);
    else if (direction === "right") aim = rotateBallzAim(aim, 0.09, configs[difficulty].ballSpeed);
    else return;
    autosave.request();
    render();
  }

  function onPointerDown(event: PointerEvent): void {
    if (isConfirmOpen() || !canAim() || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    shell.focus({ preventScroll: true });
    activePointerId = event.pointerId;
    board.setPointerCapture(event.pointerId);
    updateAimFromPointer(event);
  }

  function onPointerMove(event: PointerEvent): void {
    if (isConfirmOpen() || !canAim()) return;
    if (activePointerId !== null && event.pointerId !== activePointerId) return;
    if (activePointerId === null && event.pointerType !== "mouse") return;
    updateAimFromPointer(event);
  }

  function onPointerUp(event: PointerEvent): void {
    if (activePointerId !== event.pointerId) return;
    event.preventDefault();
    updateAimFromPointer(event);
    cancelPointer(event);
    launchCurrentVolley();
  }

  function cancelPointer(event?: PointerEvent): void {
    if (event && board.hasPointerCapture(event.pointerId))
      board.releasePointerCapture(event.pointerId);
    activePointerId = null;
  }

  function updateAimFromPointer(event: PointerEvent): void {
    const point = boardPoint(event);
    aim = ballzAimVector(
      { x: state.launcherX, y: state.launcherY },
      point,
      configs[difficulty].ballSpeed,
    );
    autosave.request();
    render();
  }

  function boardPoint(event: PointerEvent): { x: number; y: number } {
    const rect = board.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * state.width,
      y: ((event.clientY - rect.top) / rect.height) * state.height,
    };
  }

  function launchCurrentVolley(): void {
    if (mode === "paused") {
      togglePause();
      return;
    }
    if (!canAim()) {
      invalidMove.trigger();
      return;
    }
    ensureStarted();
    state = launchBallzVolley(state, aim, configs[difficulty]);
    mode = "playing";
    playSound("gameMajor");
    restartTimer();
    saveCurrentGame();
    render();
  }

  function togglePause(): void {
    if (mode === "playing") {
      mode = "paused";
      stopTimer();
      saveCurrentGame();
      playSound("uiToggle");
      render();
      return;
    }
    if (mode === "paused") {
      mode = "playing";
      restartTimer();
      playSound("uiToggle");
      render();
      return;
    }
    invalidMove.trigger();
  }

  function tick(): void {
    const previousScore = state.score;
    const previousPhase = state.phase;
    const previousBallCount = state.ballCount;
    state = stepBallz(state, configs[difficulty]);
    if (state.score > previousScore) playSound("gameGood");
    if (state.lost) {
      mode = "lost";
      finishGame();
      playSound("gameLose");
    } else if (previousPhase === "running" && state.phase === "aiming") {
      mode = "aiming";
      stopTimer();
      saveCurrentGame();
      if (state.ballCount > previousBallCount) playSound("gameWin");
    } else autosave.request();
    render();
  }

  function render(): void {
    difficultyControl.sync();
    pauseButton.disabled = mode !== "playing" && mode !== "paused";
    setIconLabel(
      pauseButton,
      mode === "paused" ? "▶" : "⏸",
      mode === "paused" ? "Resume" : "Pause",
    );
    board.dataset.phase = state.phase;
    status.textContent = statusText();
    overlay.setVisible(mode === "paused");
    positionDangerLine();
    positionAimGuide();
    positionLauncher();
    syncBricks();
    syncPickups();
    syncBalls();
  }

  function syncBricks(): void {
    syncPositionedChildren(
      bricks,
      state.bricks.length,
      "arcade-entity ballz-brick",
      (child, index) => {
        const brick = state.bricks[index];
        if (!brick) return;
        positionPercent(child, brick);
        child.textContent = String(brick.hp);
        child.dataset.critical = String(
          brick.y + brick.height >= configs[difficulty].dangerY - configs[difficulty].rowStep,
        );
        child.style.setProperty(
          "--ballz-brick-health",
          String(Math.min(1, brick.hp / Math.max(1, brick.maxHp))),
        );
        child.setAttribute("aria-label", `Brick ${index + 1}, ${brick.hp} hits left`);
      },
    );
  }

  function syncPickups(): void {
    syncPositionedChildren(
      pickups,
      state.pickups.length,
      "arcade-entity arcade-glow ballz-pickup",
      (child, index) => {
        const pickup = state.pickups[index];
        if (!pickup) return;
        positionCirclePercent(child, pickup);
        child.setAttribute("aria-label", `Extra ball ${index + 1}`);
      },
    );
  }

  function syncBalls(): void {
    syncPositionedChildren(
      balls,
      state.balls.length,
      "arcade-entity arcade-glow ballz-ball",
      (child, index) => {
        const ball = state.balls[index];
        if (!ball) return;
        positionCirclePercent(child, ball);
      },
    );
  }

  function positionDangerLine(): void {
    dangerLine.style.top = `${configs[difficulty].dangerY}%`;
  }

  function positionAimGuide(): void {
    aimGuide.hidden = !(mode === "aiming" && state.phase === "aiming");
    aimGuide.style.left = `${state.launcherX}%`;
    aimGuide.style.top = `${state.launcherY}%`;
    aimGuide.style.width = "42%";
    aimGuide.style.transform = `translateY(-50%) rotate(${Math.atan2(aim.y, aim.x)}rad)`;
  }

  function positionLauncher(): void {
    positionCirclePercent(launcher, {
      x: state.launcherX,
      y: ballzLauncherY,
      radius: ballzPickupRadius,
    });
  }

  function statusText(): string {
    if (mode === "paused") return "Paused";
    if (mode === "lost") return `Over · ${state.score}`;
    if (mode === "playing") {
      const pending = state.launch?.remaining ?? 0;
      return `${state.score} · R${state.round} · ${state.balls.length + pending}/${state.ballCount}`;
    }
    return `${state.score} · R${state.round} · ${state.ballCount} ball${state.ballCount === 1 ? "" : "s"}`;
  }

  function canAim(): boolean {
    return mode === "aiming" && state.phase === "aiming" && !state.lost;
  }

  function restartTimer(): void {
    if (mode !== "playing" || loop?.running) return;
    loop = startFixedStepLoop(tick, render, 60);
  }

  function stopTimer(): void {
    loop?.stop();
    loop = null;
  }

  function ensureStarted(): void {
    if (startedAt === null) startedAt = Date.now();
    markGameStarted(shell);
  }

  function finishGame(): void {
    markGameFinished(shell);
    stopTimer();
    recordGameResult({
      runId,
      gameId: ballz.id,
      difficulty,
      outcome: "lost",
      score: state.score,
      level: state.round,
      durationMs: durationMs(),
      metadata: { balls: state.ballCount },
    });
    clearGameSave(ballz.id);
  }

  function saveCurrentGame(): void {
    if (startedAt === null) return;
    if (mode === "lost") {
      clearGameSave(ballz.id);
      return;
    }
    saveGameSave(ballz.id, savePayloadVersion, {
      runId,
      status: mode === "paused" ? "paused" : mode === "playing" ? "playing" : "ready",
      payload: { difficulty, mode, state, aim, startedAt },
    });
  }

  function durationMs(): number | undefined {
    return durationSince(startedAt);
  }

  function savePreferences(): void {
    saveGamePreferences(ballz.id, { difficulty });
  }

  if (startedAt !== null) markGameStarted(shell);
  if (mode === "lost") markGameFinished(shell);
  render();
  return () => {
    autosave.flush();
    stopTimer();
    invalidMove.cleanup();
    scope.cleanup();
    remove();
  };
}

function defaultAim(config: BallzConfig): BallzVector {
  return { x: 0, y: -config.ballSpeed };
}

function parseSaveBallz(value: unknown): SaveBallz | null {
  const parsed = parseWithSchema(saveBallzBaseSchema, value);
  if (!parsed) return null;
  const difficulty = parseDifficulty(parsed.difficulty);
  const mode = parseMode(parsed.mode);
  const state = parseBallzState(parsed.state);
  const aim = parseVector(parsed.aim);
  const startedAt = parseStartedAt(parsed.startedAt);
  if (!difficulty || !mode || !state || !aim || startedAt === undefined) return null;
  return { difficulty, mode, state, aim, startedAt };
}

function parseBallzState(value: unknown): BallzState | null {
  const parsed = parseWithSchema(ballzStateBaseSchema, value);
  if (!parsed) return null;
  const balls = parseArray(parsed.balls, parseBall);
  const bricks = parseArray(parsed.bricks, parseBrick);
  const pickups = parseArray(parsed.pickups, parsePickup);
  const phase = parsePhase(parsed.phase);
  const launch = parseLaunch(parsed.launch);
  const firstSettledX = parseNullableFinite(parsed.firstSettledX);
  if (
    !balls ||
    !bricks ||
    !pickups ||
    !phase ||
    launch === undefined ||
    firstSettledX === undefined
  ) {
    return null;
  }
  return {
    width: parsed.width,
    height: parsed.height,
    launcherX: parsed.launcherX,
    launcherY: parsed.launcherY,
    balls,
    bricks,
    pickups,
    ballCount: parsed.ballCount,
    collectedBalls: parsed.collectedBalls,
    round: parsed.round,
    score: parsed.score,
    phase,
    launch,
    firstSettledX,
    nextId: parsed.nextId,
    lost: parsed.lost,
  };
}

function parseBall(value: unknown): BallzBall | null {
  const circle = parseWithSchema(ballzCircleSchema, value);
  const extras = parseWithSchema(ballzBallExtrasSchema, value);
  return circle && extras ? { ...circle, ...extras } : null;
}

function parseBrick(value: unknown): BallzBrick | null {
  const rect = parseRect(value);
  const extras = parseWithSchema(ballzBrickExtrasSchema, value);
  return rect && extras ? { ...rect, ...extras } : null;
}

function parsePickup(value: unknown): BallzPickup | null {
  return parseWithSchema(ballzCircleSchema, value);
}

function parseLaunch(value: unknown): BallzLaunch | undefined {
  if (value === null) return null;
  const parsed = parseWithSchema(ballzLaunchSchema, value);
  return parsed ? { ...parsed } : undefined;
}

function parseNullableFinite(value: unknown): number | null | undefined {
  if (value === null) return null;
  const parsed = parseWithSchema(finiteNumberSchema, value);
  return parsed === null ? undefined : parsed;
}

function parseVector(value: unknown): BallzVector | null {
  return parseWithSchema(ballzVectorSchema, value);
}

function parseMode(value: unknown): Mode | null {
  return parseWithSchema(ballzModeSchema, value);
}

function parsePhase(value: unknown): BallzPhase | null {
  return parseWithSchema(ballzPhaseSchema, value);
}
