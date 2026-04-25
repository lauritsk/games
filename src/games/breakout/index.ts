import {
  createArcadeModeController,
  createHeldKeyInput,
  createPauseButton,
  createPauseOverlay,
  parseRect,
  positionPercent,
  startFixedStepLoop,
  syncPositionedChildren,
  type FixedStepLoop,
} from "@games/shared/arcade";
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
  isFiniteNumber,
  isRecord,
  markGameFinished,
  markGameStarted,
  onDocumentKeyDown,
  parseOneOf,
  parseStartedAt,
  pauseOnFocusLoss,
  resetGameProgress,
  setDifficultyIconLabel,
  setIconLabel,
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
  moveBreakoutPaddle,
  newBreakoutState,
  stepBreakout,
  type BreakoutBall,
  type BreakoutBrick,
  type BreakoutConfig,
  type BreakoutState,
} from "@games/breakout/logic";

type Mode = "ready" | "playing" | "paused" | "won" | "lost";

const configs: Record<Difficulty, BreakoutConfig> = {
  Easy: { brickRows: 3, brickColumns: 7, lives: 4, ballSpeed: 1.05, paddleWidth: 24 },
  Medium: { brickRows: 4, brickColumns: 8, lives: 3, ballSpeed: 1.28, paddleWidth: 20 },
  Hard: { brickRows: 5, brickColumns: 9, lives: 2, ballSpeed: 1.5, paddleWidth: 16 },
};
const savePayloadVersion = 1;

type SaveBreakout = {
  difficulty: Difficulty;
  mode: Mode;
  state: BreakoutState;
  startedAt: number | null;
};

export const breakout: GameDefinition = {
  id: "breakout",
  name: "Breakout",
  tagline: "Bounce, smash bricks, survive.",
  players: "Solo",
  theme: "deep-cave",
  mount: mountBreakout,
};

export function mountBreakout(target: HTMLElement): () => void {
  const preferences = loadGamePreferences(breakout.id);
  let difficulty: Difficulty = parseDifficulty(preferences.difficulty) ?? "Medium";
  let state = newBreakoutState(configs[difficulty]);
  let mode: Mode = "ready";
  let loop: FixedStepLoop | null = null;
  let runId = createRunId();
  let startedAt: number | null = null;

  const saved = loadGameSave(breakout.id, savePayloadVersion, parseSaveBreakout);
  if (saved) {
    runId = saved.runId;
    difficulty = saved.payload.difficulty;
    state = saved.payload.state;
    mode = saved.payload.mode === "playing" ? "paused" : saved.payload.mode;
    startedAt = saved.payload.startedAt;
  }

  const { shell, status, actions, board, remove } = createGameShell(target, {
    gameClass: "breakout-game",
    boardClass: "board--breakout",
    boardLabel: "Breakout playfield",
    layout: gameLayouts.portraitFit,
  });
  shell.tabIndex = 0;

  const scope = createMountScope();
  const invalidMove = createInvalidMoveFeedback(shell);
  const autosave = createAutosave({ gameId: breakout.id, scope, save: saveCurrentGame });
  const lifeLostReset = createDelayedAction();
  const input = createHeldKeyInput(scope, (direction) => {
    if (isConfirmOpen() || (direction !== "left" && direction !== "right")) return;
    start();
  });
  const ball = el("div", { className: "breakout-ball" });
  const paddle = el("div", { className: "breakout-paddle" });
  const bricks = el("div", { className: "breakout-bricks" });
  board.append(bricks, paddle, ball);
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
  const requestReset = createResetControl(actions, shell, resetGame);

  onDocumentKeyDown(onKeyDown, scope);
  pauseOnFocusLoss(scope, { isActive: () => mode === "playing", pause: togglePause });
  board.addEventListener("pointermove", onPointerMove, { signal: scope.signal });
  board.addEventListener(
    "pointerdown",
    (event) => {
      onPointerMove(event);
      start();
    },
    { signal: scope.signal },
  );
  addTouchGestureControls(
    board,
    {
      onSwipe: (direction) => {
        if (direction === "left" || direction === "right") nudgePaddle(direction);
        else start();
      },
    },
    { signal: scope.signal, touchAction: "none" },
  );

  function resetGame(): void {
    stopTimer();
    clearGameSave(breakout.id);
    lifeLostReset.clear();
    shell.dataset.lifeLost = "false";
    resetGameProgress(shell);
    runId = createRunId();
    startedAt = null;
    state = newBreakoutState(configs[difficulty]);
    mode = "ready";
    input.clear();
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
      onDirection: (direction) => movePaddleByKey(direction),
      onActivate: start,
      onNextDifficulty: () => changeDifficulty(difficultyControl, "next"),
      onPreviousDifficulty: () => changeDifficulty(difficultyControl, "previous"),
      onReset: requestReset,
    });
  }

  function movePaddleByKey(direction: Direction): void {
    if (direction !== "left" && direction !== "right") return;
    start();
  }

  function moveHeldPaddle(): void {
    const left = input.isHeld("left");
    const right = input.isHeld("right");
    if (left === right) return;
    const step = left ? -2.8 : 2.8;
    state = moveBreakoutPaddle(state, state.paddle.x + state.paddle.width / 2 + step);
  }

  function nudgePaddle(direction: "left" | "right"): void {
    const delta = direction === "left" ? -state.width * 0.12 : state.width * 0.12;
    state = moveBreakoutPaddle(state, state.paddle.x + state.paddle.width / 2 + delta);
    start();
    autosave.request();
    render();
  }

  function onPointerMove(event: PointerEvent): void {
    const rect = board.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * state.width;
    state = moveBreakoutPaddle(state, x);
    autosave.request();
    render();
  }

  function tick(): void {
    moveHeldPaddle();
    const beforeBricks = aliveBrickCount(state);
    const beforeLives = state.lives;
    state = stepBreakout(state);
    const afterBricks = aliveBrickCount(state);
    if (afterBricks < beforeBricks) playSound("gameGood");
    if (state.won) {
      mode = "won";
      finishGame("won");
      playSound("gameWin");
    } else if (state.lost) {
      mode = "lost";
      finishGame("lost");
      input.clear();
      playSound("gameLose");
    } else if (state.lives < beforeLives) {
      mode = "ready";
      stopTimer();
      input.clear();
      showLifeLost();
      saveCurrentGame();
      playSound("gameLose");
    } else autosave.request();
    render();
  }

  function render(): void {
    setDifficultyIconLabel(difficultyButton, difficulty);
    setIconLabel(
      pauseButton,
      mode === "paused" ? "▶" : "⏸",
      mode === "paused" ? "Resume" : "Pause",
    );
    status.textContent = statusText();
    overlay.setVisible(mode === "paused");
    positionBall();
    position(paddle, state.paddle.x, state.paddle.y, state.paddle.width, state.paddle.height);
    syncBricks(state);
  }

  function syncBricks(next: BreakoutState): void {
    syncPositionedChildren(bricks, next.bricks.length, "breakout-brick", (child, index) => {
      const brick = next.bricks[index];
      if (!brick) return;
      positionPercent(child, brick);
      child.dataset.alive = String(brick.alive);
      child.setAttribute(
        "aria-label",
        brick.alive ? `Brick ${index + 1}` : `Destroyed brick ${index + 1}`,
      );
    });
  }

  function positionBall(): void {
    const diameter = state.ball.radius * 2;
    const visualDiameterY = diameter * 0.8;
    positionPercent(ball, {
      x: state.ball.x - state.ball.radius,
      y: state.ball.y - visualDiameterY / 2,
      width: diameter,
      height: visualDiameterY,
    });
  }

  function position(
    element: HTMLElement,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    positionPercent(element, { x, y, width, height });
  }

  function statusText(): string {
    if (mode === "ready") return "Ready";
    if (mode === "paused") return "Paused";
    if (mode === "won") return `Clear · ${state.score}`;
    if (mode === "lost") return `Out · ${state.score}`;
    return `${state.score} · L${state.level} · ${"♥".repeat(state.lives)}`;
  }

  function showLifeLost(): void {
    shell.dataset.lifeLost = "true";
    lifeLostReset.start(() => {
      shell.dataset.lifeLost = "false";
    }, 900);
  }

  function aliveBrickCount(next: BreakoutState): number {
    return next.bricks.filter((brick) => brick.alive).length;
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

  function finishGame(outcome: "won" | "lost"): void {
    markGameFinished(shell);
    stopTimer();
    recordGameResult({
      runId,
      gameId: breakout.id,
      difficulty,
      outcome,
      score: state.score,
      level: state.level,
      durationMs: durationMs(),
      metadata: { lives: state.lives },
    });
    clearGameSave(breakout.id);
  }

  function saveCurrentGame(): void {
    if (startedAt === null) return;
    if (mode === "won" || mode === "lost") {
      clearGameSave(breakout.id);
      return;
    }
    saveGameSave(breakout.id, savePayloadVersion, {
      runId,
      status: mode === "paused" ? "paused" : mode === "playing" ? "playing" : "ready",
      payload: { difficulty, mode, state, startedAt },
    });
  }

  function durationMs(): number | undefined {
    return durationSince(startedAt);
  }

  function savePreferences(): void {
    saveGamePreferences(breakout.id, { difficulty });
  }

  if (startedAt !== null) markGameStarted(shell);
  if (mode === "won" || mode === "lost") markGameFinished(shell);
  render();
  return () => {
    autosave.flush();
    stopTimer();
    lifeLostReset.clear();
    invalidMove.cleanup();
    input.destroy();
    scope.cleanup();
    remove();
  };
}

function parseSaveBreakout(value: unknown): SaveBreakout | null {
  if (!isRecord(value)) return null;
  const difficulty = parseDifficulty(value.difficulty);
  const mode = parseMode(value.mode);
  const state = parseBreakoutState(value.state);
  const startedAt = parseStartedAt(value.startedAt);
  if (!difficulty || !mode || !state || startedAt === undefined) return null;
  return { difficulty, mode, state, startedAt };
}

function parseBreakoutState(value: unknown): BreakoutState | null {
  if (!isRecord(value)) return null;
  const ball = parseBall(value.ball);
  const paddle = parseRect(value.paddle);
  const bricks = parseBricks(value.bricks);
  if (!ball || !paddle || !bricks) return null;
  if (!isFiniteNumber(value.width) || !isFiniteNumber(value.height)) return null;
  if (!isFiniteNumber(value.score) || !isFiniteNumber(value.lives) || !isFiniteNumber(value.level))
    return null;
  if (typeof value.won !== "boolean" || typeof value.lost !== "boolean") return null;
  return {
    width: value.width,
    height: value.height,
    ball,
    paddle,
    bricks,
    score: value.score,
    lives: value.lives,
    level: value.level,
    won: value.won,
    lost: value.lost,
  };
}

function parseBall(value: unknown): BreakoutBall | null {
  const rect = parseRect(value);
  if (!rect || !isRecord(value)) return null;
  if (!isFiniteNumber(value.radius) || !isFiniteNumber(value.vx) || !isFiniteNumber(value.vy))
    return null;
  return { ...rect, radius: value.radius, vx: value.vx, vy: value.vy };
}

function parseBricks(value: unknown): BreakoutBrick[] | null {
  if (!Array.isArray(value)) return null;
  const bricks = value.map((brick) => {
    const rect = parseRect(brick);
    if (!rect || !isRecord(brick) || typeof brick.alive !== "boolean") return null;
    return { ...rect, alive: brick.alive };
  });
  return bricks.every((brick): brick is BreakoutBrick => brick !== null) ? bricks : null;
}

function parseMode(value: unknown): Mode | null {
  return parseOneOf(value, ["ready", "playing", "paused", "won", "lost"] as const);
}
