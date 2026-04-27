import * as v from "valibot";
import {
  createArcadeModeController,
  createHeldKeyInput,
  createPauseButton,
  createPauseOverlay,
  createTouchControls,
  parseRect,
  positionCirclePercent,
  positionPercent,
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
  finiteNumberSchema,
  gameLayouts,
  handleStandardGameKey,
  isConfirmOpen,
  markGameFinished,
  markGameStarted,
  onDocumentKeyDown,
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
  movePongPlayer,
  newPongState,
  stepPong,
  type PongBall,
  type PongConfig,
  type PongState,
} from "@games/pong/logic";

const configs: Record<Difficulty, PongConfig> = {
  Easy: {
    winningScore: 5,
    paddleHeight: 15,
    paddleSpeed: 2.7,
    opponentSpeed: 1.75,
    ballSpeed: 1.05,
    ballSpeedGrowth: 0.05,
  },
  Medium: {
    winningScore: 7,
    paddleHeight: 12,
    paddleSpeed: 2.55,
    opponentSpeed: 2.1,
    ballSpeed: 1.22,
    ballSpeedGrowth: 0.065,
  },
  Hard: {
    winningScore: 9,
    paddleHeight: 10,
    paddleSpeed: 2.35,
    opponentSpeed: 2.55,
    ballSpeed: 1.38,
    ballSpeedGrowth: 0.08,
  },
};

const pongLayout = {
  ...gameLayouts.wideFit,
  aspectRatio: "16 / 10",
  maxInline: "800px",
};

type Mode = "ready" | "playing" | "paused" | "won" | "lost";

type SavePong = {
  difficulty: Difficulty;
  mode: Mode;
  state: PongState;
  startedAt: number | null;
};

const savePayloadVersion = 1;
const pongModeSchema = picklistSchema(["ready", "playing", "paused", "won", "lost"] as const);
const pongSideSchema = picklistSchema(["player", "opponent"] as const);
const savePongBaseSchema = v.looseObject({
  difficulty: v.unknown(),
  mode: v.unknown(),
  state: v.unknown(),
  startedAt: v.unknown(),
});
const pongBallSchema = v.looseObject({
  x: finiteNumberSchema,
  y: finiteNumberSchema,
  radius: finiteNumberSchema,
  vx: finiteNumberSchema,
  vy: finiteNumberSchema,
});
const pongStateBaseSchema = v.looseObject({
  width: finiteNumberSchema,
  height: finiteNumberSchema,
  player: v.unknown(),
  opponent: v.unknown(),
  ball: v.unknown(),
  playerScore: finiteNumberSchema,
  opponentScore: finiteNumberSchema,
  rally: finiteNumberSchema,
  tick: finiteNumberSchema,
  won: v.boolean(),
  lost: v.boolean(),
  lastScoredBy: v.unknown(),
});

export const pong: GameDefinition = {
  id: "pong",
  name: "Pong",
  tagline: "Hold the line. Beat the bot.",
  players: "Solo",
  theme: "deep-ocean",
  mount: mountPong,
};

export function mountPong(target: HTMLElement): () => void {
  const preferences = loadGamePreferences(pong.id);
  let difficulty: Difficulty = parseDifficulty(preferences.difficulty) ?? "Medium";
  let state = newPongState(configs[difficulty]);
  let mode: Mode = "ready";
  let loop: FixedStepLoop | null = null;
  let runId = createRunId();
  let startedAt: number | null = null;

  const saved = loadGameSave(pong.id, savePayloadVersion, parseSavePong);
  if (saved) {
    runId = saved.runId;
    difficulty = saved.payload.difficulty;
    state = saved.payload.state;
    mode = saved.payload.mode === "playing" ? "paused" : saved.payload.mode;
    startedAt = saved.payload.startedAt;
  }

  const { shell, status, actions, board, remove } = createGameShell(target, {
    gameClass: "pong-game",
    boardClass: "board--pong",
    boardLabel: "Pong court",
    layout: pongLayout,
  });
  shell.tabIndex = 0;

  const scope = createMountScope();
  const invalidMove = createInvalidMoveFeedback(shell);
  const pointFlash = createDelayedAction();
  const autosave = createAutosave({ gameId: pong.id, scope, save: saveCurrentGame });
  const input = createHeldKeyInput(scope, (direction) => {
    if (isConfirmOpen() || (direction !== "up" && direction !== "down")) return;
    start();
  });
  const net = el("div", { className: "pong-net" });
  net.setAttribute("aria-hidden", "true");
  const player = el("div", { className: "arcade-entity arcade-glow pong-paddle pong-player" });
  const opponent = el("div", {
    className: "arcade-entity arcade-glow pong-paddle pong-opponent",
  });
  const ball = el("div", { className: "arcade-entity arcade-glow pong-ball" });
  board.append(net, player, opponent, ball);

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
    up: () => nudgePaddle(-1),
    down: () => nudgePaddle(1),
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
        if (direction === "up") nudgePaddle(-1);
        else if (direction === "down") nudgePaddle(1);
        else start();
      },
    },
    { signal: scope.signal, touchAction: "none" },
  );

  function resetGame(): void {
    stopTimer();
    clearGameSave(pong.id);
    pointFlash.clear();
    shell.dataset.point = "false";
    resetGameProgress(shell);
    runId = createRunId();
    startedAt = null;
    state = newPongState(configs[difficulty]);
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
      onDirection: movePaddleByKey,
      onActivate: start,
      onNextDifficulty: difficultyControl.next,
      onPreviousDifficulty: difficultyControl.previous,
      onReset: requestReset,
    });
  }

  function movePaddleByKey(direction: Direction): void {
    if (direction !== "up" && direction !== "down") return;
    start();
  }

  function nudgePaddle(move: -1 | 1): void {
    state = movePongPlayer(
      state,
      state.player.y + state.player.height / 2 + move * state.height * 0.14,
    );
    start();
    autosave.request();
    render();
  }

  function onPointerMove(event: PointerEvent): void {
    const rect = board.getBoundingClientRect();
    const y = ((event.clientY - rect.top) / rect.height) * state.height;
    state = movePongPlayer(state, y);
    autosave.request();
    render();
  }

  function tick(): void {
    const beforeScore = state.playerScore + state.opponentScore;
    state = stepPong(state, configs[difficulty], { playerMove: input.vertical() });
    const afterScore = state.playerScore + state.opponentScore;
    if (state.won) {
      mode = "won";
      finishGame("won");
      playSound("gameWin");
    } else if (state.lost) {
      mode = "lost";
      finishGame("lost");
      input.clear();
      playSound("gameLose");
    } else if (afterScore > beforeScore) {
      mode = "ready";
      stopTimer();
      input.clear();
      showPointFlash();
      saveCurrentGame();
      playSound(state.lastScoredBy === "player" ? "gameGood" : "gameLose");
    } else autosave.request();
    render();
  }

  function render(): void {
    difficultyControl.sync();
    setIconLabel(
      pauseButton,
      mode === "paused" ? "▶" : "⏸",
      mode === "paused" ? "Resume" : "Pause",
    );
    status.textContent = statusText();
    overlay.setVisible(mode === "paused");
    board.dataset.lastScore = state.lastScoredBy ?? "none";
    positionPercent(player, state.player);
    positionPercent(opponent, state.opponent);
    positionCirclePercent(ball, state.ball);
  }

  function statusText(): string {
    const score = `${state.playerScore}–${state.opponentScore}`;
    if (mode === "ready") return `${score} · Ready`;
    if (mode === "paused") return `${score} · Paused`;
    if (mode === "won") return `${score} · Win`;
    if (mode === "lost") return `${score} · Out`;
    return `${score} · Rally ${state.rally}`;
  }

  function showPointFlash(): void {
    shell.dataset.point = "true";
    pointFlash.start(() => {
      shell.dataset.point = "false";
    }, 800);
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
      gameId: pong.id,
      difficulty,
      outcome,
      score: state.playerScore,
      level: state.playerScore + state.opponentScore,
      durationMs: durationMs(),
      metadata: { opponentScore: state.opponentScore, rally: state.rally },
    });
    clearGameSave(pong.id);
  }

  function saveCurrentGame(): void {
    if (startedAt === null) return;
    if (mode === "won" || mode === "lost") {
      clearGameSave(pong.id);
      return;
    }
    saveGameSave(pong.id, savePayloadVersion, {
      runId,
      status: mode === "paused" ? "paused" : mode === "playing" ? "playing" : "ready",
      payload: { difficulty, mode, state, startedAt },
    });
  }

  function durationMs(): number | undefined {
    return durationSince(startedAt);
  }

  function savePreferences(): void {
    saveGamePreferences(pong.id, { difficulty });
  }

  if (startedAt !== null) markGameStarted(shell);
  if (mode === "won" || mode === "lost") markGameFinished(shell);
  render();
  return () => {
    autosave.flush();
    stopTimer();
    pointFlash.clear();
    invalidMove.cleanup();
    input.destroy();
    scope.cleanup();
    remove();
  };
}

function parseSavePong(value: unknown): SavePong | null {
  const parsed = parseWithSchema(savePongBaseSchema, value);
  if (!parsed) return null;
  const difficulty = parseDifficulty(parsed.difficulty);
  const mode = parseMode(parsed.mode);
  const state = parsePongState(parsed.state);
  const startedAt = parseStartedAt(parsed.startedAt);
  if (!difficulty || !mode || !state || startedAt === undefined) return null;
  return { difficulty, mode, state, startedAt };
}

function parsePongState(value: unknown): PongState | null {
  const parsed = parseWithSchema(pongStateBaseSchema, value);
  if (!parsed) return null;
  const player = parseRect(parsed.player);
  const opponent = parseRect(parsed.opponent);
  const ball = parseBall(parsed.ball);
  const lastScoredBy = parseLastScoredBy(parsed.lastScoredBy);
  if (!player || !opponent || !ball || lastScoredBy === undefined) return null;
  return {
    width: parsed.width,
    height: parsed.height,
    player,
    opponent,
    ball,
    playerScore: parsed.playerScore,
    opponentScore: parsed.opponentScore,
    rally: parsed.rally,
    tick: parsed.tick,
    won: parsed.won,
    lost: parsed.lost,
    lastScoredBy,
  };
}

function parseBall(value: unknown): PongBall | null {
  return parseWithSchema(pongBallSchema, value);
}

function parseLastScoredBy(value: unknown): PongState["lastScoredBy"] | undefined {
  if (value === null) return null;
  return parseWithSchema(pongSideSchema, value) ?? undefined;
}

function parseMode(value: unknown): Mode | null {
  return parseWithSchema(pongModeSchema, value);
}
