import {
  clamp,
  createArcadeHud,
  createArcadeModeController,
  createHeldKeyInput,
  createPauseButton,
  createPauseOverlay,
  createTouchControls,
  positionPercent,
  startFixedStepLoop,
  syncPositionedChildren,
  type FixedStepLoop,
} from "../arcade";
import {
  createGameShell,
  createMountScope,
  el,
  gameLayouts,
  handleStandardGameKey,
  isConfirmOpen,
  markGameFinished,
  markGameStarted,
  onDocumentKeyDown,
  resetGameProgress,
  type Difficulty,
  type Direction,
  type GameDefinition,
} from "../core";
import { createInvalidMoveFeedback } from "../feedback";
import { playSound } from "../sound";
import { changeDifficulty, createDifficultyControl, createResetControl } from "./controls";
import {
  fireInvaderShot,
  invaderShotHeight,
  invaderShotWidth,
  newInvaderState,
  nextInvaderWave,
  stepInvaders,
  type InvaderConfig,
  type InvaderState,
} from "./space-invaders.logic";

type Mode = "ready" | "playing" | "paused" | "wave" | "lost";

const configs: Record<Difficulty, InvaderConfig> = {
  Easy: {
    alienRows: 3,
    alienColumns: 7,
    lives: 4,
    playerSpeed: 2.8,
    alienStepEvery: 32,
    alienShotEvery: 62,
  },
  Medium: {
    alienRows: 4,
    alienColumns: 8,
    lives: 3,
    playerSpeed: 2.5,
    alienStepEvery: 26,
    alienShotEvery: 48,
  },
  Hard: {
    alienRows: 5,
    alienColumns: 9,
    lives: 2,
    playerSpeed: 2.2,
    alienStepEvery: 21,
    alienShotEvery: 36,
  },
};

export const spaceInvaders: GameDefinition = {
  id: "space-invaders",
  name: "Space Invaders",
  tagline: "Hold the line against descending waves.",
  players: "Solo",
  theme: "outer-space",
  mount: mountSpaceInvaders,
};

export function mountSpaceInvaders(target: HTMLElement): () => void {
  let difficulty: Difficulty = "Medium";
  let state = newInvaderState(configs[difficulty]);
  let mode: Mode = "ready";
  let loop: FixedStepLoop | null = null;
  let waveTimer: ReturnType<typeof setTimeout> | null = null;

  const { shell, status, actions, board, remove } = createGameShell(target, {
    gameClass: "invaders-game",
    boardClass: "board--invaders",
    boardLabel: "Space Invaders playfield",
    layout: gameLayouts.portraitFit,
  });
  shell.tabIndex = 0;

  const scope = createMountScope();
  const invalidMove = createInvalidMoveFeedback(shell);
  const input = createHeldKeyInput(scope, (direction) => {
    if (isConfirmOpen() || (direction !== "left" && direction !== "right")) return;
    start();
  });
  const player = el("div", { className: "invader-player", ariaLabel: "Player cannon" });
  const aliens = el("div", { className: "invader-aliens" });
  const barriers = el("div", { className: "invader-barriers" });
  const shots = el("div", { className: "invader-shots" });
  board.append(aliens, barriers, shots, player);
  const hud = createArcadeHud(board);
  const modeController = createArcadeModeController<Mode>({
    getMode: () => mode,
    setMode: (next) => {
      mode = next;
    },
    blockedStart: ["lost"],
    blockedPause: ["lost", "wave"],
    ready: "ready",
    playing: "playing",
    paused: "paused",
    onBlockedStart: () => invalidMove.trigger(),
    onFirstStart: () => {
      markGameStarted(shell);
      playSound("gameMajor");
    },
    onPlaying: restartTimer,
    onPause: () => {
      stopTimer();
      playSound("uiToggle");
    },
    afterChange: render,
  });
  const overlay = createPauseOverlay(board, togglePause);
  createTouchControls(shell, {
    left: () => moveByDirection("left"),
    right: () => moveByDirection("right"),
    fire,
  });

  const difficultyControl = {
    get: () => difficulty,
    set: (next: Difficulty) => {
      difficulty = next;
    },
    reset: resetGame,
  };
  const difficultyButton = createDifficultyControl(actions, difficultyControl);
  const pauseButton = createPauseButton(actions, togglePause);
  const requestReset = createResetControl(actions, shell, resetGame);

  onDocumentKeyDown(onKeyDown, scope);
  board.addEventListener(
    "pointerdown",
    (event) => {
      movePointer(event);
      start();
      fire();
    },
    { signal: scope.signal },
  );
  board.addEventListener("pointermove", movePointer, { signal: scope.signal });

  function resetGame(): void {
    stopTimer();
    stopWaveTimer();
    resetGameProgress(shell);
    state = newInvaderState(configs[difficulty]);
    mode = "ready";
    input.clear();
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
      onDirection: moveByDirection,
      onActivate: () => {
        start();
        fire();
      },
      onNextDifficulty: () => changeDifficulty(difficultyControl, "next"),
      onPreviousDifficulty: () => changeDifficulty(difficultyControl, "previous"),
      onReset: requestReset,
    });
  }

  function moveByDirection(direction: Direction): void {
    if (direction !== "left" && direction !== "right") return;
    const delta =
      direction === "left" ? -configs[difficulty].playerSpeed : configs[difficulty].playerSpeed;
    state = {
      ...state,
      player: {
        ...state.player,
        x: clamp(state.player.x + delta, 0, state.width - state.player.width),
      },
    };
    start();
    render();
  }

  function fire(): void {
    if (mode !== "playing") return;
    const before = state.shots.length;
    state = fireInvaderShot(state);
    if (state.shots.length > before) playSound("uiToggle");
    render();
  }

  function tick(): void {
    const move = input.horizontal();
    const beforeScore = state.score;
    const beforeLives = state.lives;
    state = stepInvaders(state, configs[difficulty], { move });
    if (state.score > beforeScore) playSound("gameGood");
    if (state.lives < beforeLives) playSound("gameLose");
    if (state.lost) {
      mode = "lost";
      markGameFinished(shell);
      stopTimer();
      input.clear();
      playSound("gameLose");
    } else if (state.won) {
      mode = "wave";
      stopTimer();
      input.clear();
      playSound("gameWin");
      waveTimer = setTimeout(() => {
        waveTimer = null;
        state = nextInvaderWave(state, configs[difficulty]);
        mode = "playing";
        restartTimer();
        render();
      }, 900);
    }
    render();
  }

  function movePointer(event: PointerEvent): void {
    const rect = board.getBoundingClientRect();
    const center = ((event.clientX - rect.left) / rect.width) * state.width;
    state = {
      ...state,
      player: {
        ...state.player,
        x: clamp(center - state.player.width / 2, 0, state.width - state.player.width),
      },
    };
    render();
  }

  function render(): void {
    difficultyButton.textContent = difficulty;
    pauseButton.textContent = mode === "paused" ? "Resume" : "Pause";
    status.textContent = statusText();
    hud.setStats({ Score: state.score, Lives: state.lives, Wave: state.wave });
    overlay.setVisible(mode === "paused");
    position(player, state.player.x, state.player.y, state.player.width, state.player.height);
    syncAliens(state);
    syncBarriers(state);
    syncShots(state);
  }

  function syncAliens(next: InvaderState): void {
    syncPositioned(aliens, next.aliens.length, "invader-alien", (child, index) => {
      const alien = next.aliens[index];
      if (!alien) return;
      position(child, alien.x, alien.y, alien.width, alien.height);
      child.dataset.alive = String(alien.alive);
      child.setAttribute(
        "aria-label",
        alien.alive ? `Alien ${index + 1}` : `Destroyed alien ${index + 1}`,
      );
    });
  }

  function syncBarriers(next: InvaderState): void {
    syncPositioned(barriers, next.barriers.length, "invader-barrier", (child, index) => {
      const barrier = next.barriers[index];
      if (!barrier) return;
      position(child, barrier.x, barrier.y, barrier.width, barrier.height);
      child.dataset.hp = String(barrier.hp);
      child.setAttribute("aria-label", `Barrier ${index + 1}, ${barrier.hp} strength`);
    });
  }

  function syncShots(next: InvaderState): void {
    syncPositioned(shots, next.shots.length, "invader-shot", (child, index) => {
      const shot = next.shots[index];
      if (!shot) return;
      child.dataset.owner = shot.owner;
      position(
        child,
        shot.x - invaderShotWidth / 2,
        shot.y - invaderShotHeight / 2,
        invaderShotWidth,
        invaderShotHeight,
      );
    });
  }

  function syncPositioned(
    container: HTMLElement,
    count: number,
    className: string,
    apply: (child: HTMLElement, index: number) => void,
  ): void {
    syncPositionedChildren(container, count, className, apply);
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
    if (mode === "wave") return `Wave ${state.wave + 1}`;
    if (mode === "lost") return `Over · ${state.score}`;
    return `${state.score} · W${state.wave} · ${"♥".repeat(state.lives)}`;
  }

  function restartTimer(): void {
    if (mode !== "playing" || loop?.running) return;
    loop = startFixedStepLoop(tick, render, 31);
  }

  function stopTimer(): void {
    loop?.stop();
    loop = null;
  }

  function stopWaveTimer(): void {
    if (!waveTimer) return;
    clearTimeout(waveTimer);
    waveTimer = null;
  }

  render();
  return () => {
    stopTimer();
    stopWaveTimer();
    invalidMove.cleanup();
    input.destroy();
    scope.cleanup();
    remove();
  };
}
