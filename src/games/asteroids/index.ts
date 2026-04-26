import * as v from "valibot";
import {
  createArcadeModeController,
  createHeldKeyInput,
  createPauseButton,
  createPauseOverlay,
  createTouchControls,
  positionCirclePercent,
  startFixedStepLoop,
  syncPositionedChildren,
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
  parseArray,
  parseStartedAt,
  parseWithSchema,
  pauseGameOnRequest,
  pauseOnFocusLoss,
  picklistSchema,
  resetGameProgress,
  setIconLabel,
  type Difficulty,
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
  fireAsteroidBullet,
  newAsteroidsState,
  nextAsteroidsWave,
  rotateAsteroidsShip,
  stepAsteroids,
  thrustAsteroidsShip,
  type AsteroidBullet,
  type AsteroidRock,
  type AsteroidSize,
  type AsteroidsConfig,
  type AsteroidsShip,
  type AsteroidsState,
} from "@games/asteroids/logic";

const configs: Record<Difficulty, AsteroidsConfig> = {
  Easy: {
    lives: 5,
    startingAsteroids: 2,
    asteroidGrowth: 1,
    maxAsteroids: 7,
    asteroidSpeed: 0.3,
    shipTurnSpeed: 0.1,
    shipThrust: 0.055,
    shipFriction: 0.989,
    maxShipSpeed: 1.45,
    bulletSpeed: 2.55,
    bulletTtl: 60,
    bulletCooldown: 9,
    respawnInvulnerableTicks: 150,
  },
  Medium: {
    lives: 4,
    startingAsteroids: 3,
    asteroidGrowth: 1,
    maxAsteroids: 8,
    asteroidSpeed: 0.37,
    shipTurnSpeed: 0.108,
    shipThrust: 0.06,
    shipFriction: 0.99,
    maxShipSpeed: 1.65,
    bulletSpeed: 2.65,
    bulletTtl: 56,
    bulletCooldown: 11,
    respawnInvulnerableTicks: 135,
  },
  Hard: {
    lives: 2,
    startingAsteroids: 5,
    asteroidGrowth: 2,
    maxAsteroids: 12,
    asteroidSpeed: 0.53,
    shipTurnSpeed: 0.115,
    shipThrust: 0.064,
    shipFriction: 0.99,
    maxShipSpeed: 1.92,
    bulletSpeed: 2.55,
    bulletTtl: 46,
    bulletCooldown: 15,
    respawnInvulnerableTicks: 90,
  },
};

type Mode = "ready" | "playing" | "paused" | "wave" | "lost";

type SaveAsteroids = {
  difficulty: Difficulty;
  mode: Mode;
  state: AsteroidsState;
  startedAt: number | null;
};

const savePayloadVersion = 1;
const asteroidsModeSchema = picklistSchema(["ready", "playing", "paused", "wave", "lost"] as const);
const asteroidSizeSchema = picklistSchema([1, 2, 3] as const);
const saveAsteroidsBaseSchema = v.looseObject({
  difficulty: v.unknown(),
  mode: v.unknown(),
  state: v.unknown(),
  startedAt: v.unknown(),
});
const asteroidsStateBaseSchema = v.looseObject({
  width: finiteNumberSchema,
  height: finiteNumberSchema,
  ship: v.unknown(),
  asteroids: v.unknown(),
  bullets: v.unknown(),
  score: finiteNumberSchema,
  lives: finiteNumberSchema,
  wave: finiteNumberSchema,
  tick: finiteNumberSchema,
  bulletCooldown: finiteNumberSchema,
  won: v.boolean(),
  lost: v.boolean(),
  nextId: finiteNumberSchema,
});
const asteroidsCircleSchema = v.looseObject({
  x: finiteNumberSchema,
  y: finiteNumberSchema,
  radius: finiteNumberSchema,
});
const asteroidsShipExtrasSchema = v.looseObject({
  angle: finiteNumberSchema,
  vx: finiteNumberSchema,
  vy: finiteNumberSchema,
  invulnerable: finiteNumberSchema,
  thrusting: v.boolean(),
});
const asteroidRockExtrasSchema = v.looseObject({
  id: finiteNumberSchema,
  size: v.unknown(),
  vx: finiteNumberSchema,
  vy: finiteNumberSchema,
  rotation: finiteNumberSchema,
  spin: finiteNumberSchema,
});
const asteroidBulletExtrasSchema = v.looseObject({
  id: finiteNumberSchema,
  vx: finiteNumberSchema,
  vy: finiteNumberSchema,
  ttl: finiteNumberSchema,
});

export const asteroids: GameDefinition = {
  id: "asteroids",
  name: "Asteroids",
  tagline: "Drift, dodge, split the rocks.",
  players: "Solo",
  theme: "outer-space",
  mount: mountAsteroids,
};

export function mountAsteroids(target: HTMLElement): () => void {
  const preferences = loadGamePreferences(asteroids.id);
  let difficulty: Difficulty = parseDifficulty(preferences.difficulty) ?? "Medium";
  let state = newAsteroidsState(configs[difficulty]);
  let mode: Mode = "ready";
  let loop: FixedStepLoop | null = null;
  let runId = createRunId();
  let startedAt: number | null = null;

  const saved = loadGameSave(asteroids.id, savePayloadVersion, parseSaveAsteroids);
  if (saved) {
    runId = saved.runId;
    difficulty = saved.payload.difficulty;
    state =
      saved.payload.mode === "wave"
        ? nextAsteroidsWave(saved.payload.state, configs[difficulty])
        : saved.payload.state;
    mode =
      saved.payload.mode === "playing" || saved.payload.mode === "wave"
        ? "paused"
        : saved.payload.mode;
    startedAt = saved.payload.startedAt;
  }

  const { shell, status, actions, board, remove } = createGameShell(target, {
    gameClass: "asteroids-game",
    boardClass: "board--asteroids",
    boardLabel: "Asteroids playfield",
    layout: gameLayouts.squareFit,
  });
  shell.tabIndex = 0;

  const scope = createMountScope();
  const invalidMove = createInvalidMoveFeedback(shell);
  const autosave = createAutosave({ gameId: asteroids.id, scope, save: saveCurrentGame });
  const waveAdvance = createDelayedAction();
  const input = createHeldKeyInput(scope, (direction) => {
    if (isConfirmOpen() || direction === "down") return;
    start();
  });
  const rocks = el("div", { className: "asteroids-rocks" });
  const shots = el("div", { className: "asteroids-shots" });
  const ship = el("div", { className: "arcade-entity arcade-glow asteroids-ship" });
  const thrust = el("span", { className: "asteroids-thrust" });
  ship.append(thrust);
  board.append(rocks, shots, ship);

  const modeController = createArcadeModeController<Mode>({
    getMode: () => mode,
    setMode: (next) => {
      mode = next;
    },
    blockedStart: ["lost", "wave"],
    blockedPause: ["lost", "wave"],
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
    left: () => touchRotate(-1),
    up: touchThrust,
    fire,
    right: () => touchRotate(1),
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
  board.addEventListener(
    "pointerdown",
    (event) => {
      if (event.pointerType !== "mouse" || event.button !== 0) return;
      fire();
    },
    { signal: scope.signal },
  );
  addTouchGestureControls(
    board,
    {
      onTap: fire,
      onSwipe: (direction) => {
        if (direction === "left") touchRotate(-1);
        else if (direction === "right") touchRotate(1);
        else if (direction === "up") touchThrust();
        else fire();
      },
    },
    { signal: scope.signal, touchAction: "none" },
  );

  function resetGame(): void {
    stopTimer();
    waveAdvance.clear();
    clearGameSave(asteroids.id);
    resetGameProgress(shell);
    runId = createRunId();
    startedAt = null;
    state = newAsteroidsState(configs[difficulty]);
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
    if (event.key === " ") {
      event.preventDefault();
      fire();
      return;
    }
    handleStandardGameKey(event, {
      onDirection: (direction) => {
        if (direction !== "down") start();
      },
      onActivate: start,
      onNextDifficulty: difficultyControl.next,
      onPreviousDifficulty: difficultyControl.previous,
      onReset: requestReset,
    });
  }

  function touchRotate(direction: -1 | 1): void {
    start();
    if (mode !== "playing") return;
    state = rotateAsteroidsShip(state, direction, configs[difficulty]);
    autosave.request();
    playSound("gameMove");
    render();
  }

  function touchThrust(): void {
    start();
    if (mode !== "playing") return;
    state = thrustAsteroidsShip(state, configs[difficulty]);
    autosave.request();
    playSound("gameMove");
    render();
  }

  function fire(): void {
    if (mode === "ready") start();
    if (mode !== "playing") return;
    const before = state.bullets.length;
    state = fireAsteroidBullet(state, configs[difficulty]);
    if (state.bullets.length > before) {
      autosave.request();
      playSound("uiToggle");
    }
    render();
  }

  function tick(): void {
    const beforeScore = state.score;
    const beforeLives = state.lives;
    state = stepAsteroids(state, configs[difficulty], {
      rotate: input.horizontal(),
      thrust: input.isHeld("up"),
    });
    if (state.score > beforeScore) playSound("gameGood");
    if (state.lives < beforeLives) playSound("gameLose");
    if (state.lost) {
      mode = "lost";
      finishGame();
      input.clear();
      playSound("gameLose");
    } else if (state.won) {
      mode = "wave";
      stopTimer();
      input.clear();
      saveCurrentGame();
      playSound("gameWin");
      waveAdvance.start(() => {
        state = nextAsteroidsWave(state, configs[difficulty]);
        mode = "playing";
        saveCurrentGame();
        restartTimer();
        render();
      }, 900);
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
    board.dataset.phase = mode;
    syncShip(state.ship);
    syncRocks(state.asteroids);
    syncShots(state.bullets);
  }

  function syncShip(next: AsteroidsShip): void {
    positionCirclePercent(ship, next);
    ship.style.transform = `rotate(${next.angle + Math.PI / 2}rad)`;
    ship.dataset.thrusting = String(next.thrusting && mode === "playing");
    ship.dataset.invulnerable = String(next.invulnerable > 0);
    ship.setAttribute("aria-label", "Ship");
  }

  function syncRocks(next: AsteroidRock[]): void {
    syncPositionedChildren(rocks, next.length, "arcade-entity asteroids-rock", (child, index) => {
      const rock = next[index];
      if (!rock) return;
      positionCirclePercent(child, rock);
      child.style.transform = `rotate(${rock.rotation}deg)`;
      child.dataset.size = String(rock.size);
      child.setAttribute("aria-label", `Asteroid ${index + 1}`);
    });
  }

  function syncShots(next: AsteroidBullet[]): void {
    syncPositionedChildren(
      shots,
      next.length,
      "arcade-entity arcade-glow asteroids-shot",
      (child, index) => {
        const shot = next[index];
        if (!shot) return;
        positionCirclePercent(child, shot);
        child.setAttribute("aria-label", `Shot ${index + 1}`);
      },
    );
  }

  function statusText(): string {
    if (mode === "ready") return "Ready · arrows/WASD, Space";
    if (mode === "paused") return "Paused";
    if (mode === "wave") return `Wave ${state.wave + 1}`;
    if (mode === "lost") return `Over · ${state.score}`;
    return `${state.score} · W${state.wave} · ${"♥".repeat(state.lives)}`;
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
      gameId: asteroids.id,
      difficulty,
      outcome: "lost",
      score: state.score,
      level: state.wave,
      durationMs: durationMs(),
      metadata: { lives: state.lives, wave: state.wave },
    });
    clearGameSave(asteroids.id);
  }

  function saveCurrentGame(): void {
    if (startedAt === null) return;
    if (mode === "lost") {
      clearGameSave(asteroids.id);
      return;
    }
    saveGameSave(asteroids.id, savePayloadVersion, {
      runId,
      status:
        mode === "paused" ? "paused" : mode === "playing" || mode === "wave" ? "playing" : "ready",
      payload: { difficulty, mode, state, startedAt },
    });
  }

  function durationMs(): number | undefined {
    return durationSince(startedAt);
  }

  function savePreferences(): void {
    saveGamePreferences(asteroids.id, { difficulty });
  }

  if (startedAt !== null) markGameStarted(shell);
  if (mode === "lost") markGameFinished(shell);
  render();
  return () => {
    autosave.flush();
    stopTimer();
    waveAdvance.clear();
    invalidMove.cleanup();
    input.destroy();
    scope.cleanup();
    remove();
  };
}

function parseSaveAsteroids(value: unknown): SaveAsteroids | null {
  const parsed = parseWithSchema(saveAsteroidsBaseSchema, value);
  if (!parsed) return null;
  const difficulty = parseDifficulty(parsed.difficulty);
  const mode = parseMode(parsed.mode);
  const state = parseAsteroidsState(parsed.state);
  const startedAt = parseStartedAt(parsed.startedAt);
  if (!difficulty || !mode || !state || startedAt === undefined) return null;
  return { difficulty, mode, state, startedAt };
}

function parseAsteroidsState(value: unknown): AsteroidsState | null {
  const parsed = parseWithSchema(asteroidsStateBaseSchema, value);
  if (!parsed) return null;
  const ship = parseShip(parsed.ship);
  const rocks = parseArray(parsed.asteroids, parseRock);
  const bullets = parseArray(parsed.bullets, parseBullet);
  if (!ship || !rocks || !bullets) return null;
  return {
    width: parsed.width,
    height: parsed.height,
    ship,
    asteroids: rocks,
    bullets,
    score: parsed.score,
    lives: parsed.lives,
    wave: parsed.wave,
    tick: parsed.tick,
    bulletCooldown: parsed.bulletCooldown,
    won: parsed.won,
    lost: parsed.lost,
    nextId: parsed.nextId,
  };
}

function parseShip(value: unknown): AsteroidsShip | null {
  const circle = parseWithSchema(asteroidsCircleSchema, value);
  const extras = parseWithSchema(asteroidsShipExtrasSchema, value);
  return circle && extras ? { ...circle, ...extras } : null;
}

function parseRock(value: unknown): AsteroidRock | null {
  const circle = parseWithSchema(asteroidsCircleSchema, value);
  const extras = parseWithSchema(asteroidRockExtrasSchema, value);
  const size = parseSize(extras?.size);
  return circle && extras && size ? { ...circle, ...extras, size } : null;
}

function parseBullet(value: unknown): AsteroidBullet | null {
  const circle = parseWithSchema(asteroidsCircleSchema, value);
  const extras = parseWithSchema(asteroidBulletExtrasSchema, value);
  return circle && extras ? { ...circle, ...extras } : null;
}

function parseMode(value: unknown): Mode | null {
  return parseWithSchema(asteroidsModeSchema, value);
}

function parseSize(value: unknown): AsteroidSize | null {
  return parseWithSchema(asteroidSizeSchema, value);
}
