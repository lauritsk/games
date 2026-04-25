import {
  createArcadeHud,
  createArcadeModeController,
  createHeldKeyInput,
  createPauseButton,
  createPauseOverlay,
  positionPercent,
  startFixedStepLoop,
  syncPositionedChildren,
  type FixedStepLoop,
} from "../arcade";
import {
  createDelayedAction,
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
import { loadGamePreferences, parseDifficulty, saveGamePreferences } from "../game-preferences";
import { playSound } from "../sound";
import { changeDifficulty, createDifficultyControl, createResetControl } from "./controls";
import {
  moveBreakoutPaddle,
  newBreakoutState,
  stepBreakout,
  type BreakoutConfig,
  type BreakoutState,
} from "./breakout.logic";

type Mode = "ready" | "playing" | "paused" | "won" | "lost";

const configs: Record<Difficulty, BreakoutConfig> = {
  Easy: { brickRows: 3, brickColumns: 7, lives: 4, ballSpeed: 1.05, paddleWidth: 24 },
  Medium: { brickRows: 4, brickColumns: 8, lives: 3, ballSpeed: 1.28, paddleWidth: 20 },
  Hard: { brickRows: 5, brickColumns: 9, lives: 2, ballSpeed: 1.5, paddleWidth: 16 },
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

  const { shell, status, actions, board, remove } = createGameShell(target, {
    gameClass: "breakout-game",
    boardClass: "board--breakout",
    boardLabel: "Breakout playfield",
    layout: gameLayouts.portraitFit,
  });
  shell.tabIndex = 0;

  const scope = createMountScope();
  const invalidMove = createInvalidMoveFeedback(shell);
  const lifeLostReset = createDelayedAction();
  const input = createHeldKeyInput(scope, (direction) => {
    if (isConfirmOpen() || (direction !== "left" && direction !== "right")) return;
    start();
  });
  const ball = el("div", { className: "breakout-ball" });
  const paddle = el("div", { className: "breakout-paddle" });
  const bricks = el("div", { className: "breakout-bricks" });
  board.append(bricks, paddle, ball);
  const hud = createArcadeHud(board);
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
  board.addEventListener("pointermove", onPointerMove, { signal: scope.signal });
  board.addEventListener(
    "pointerdown",
    (event) => {
      onPointerMove(event);
      start();
    },
    { signal: scope.signal },
  );

  function resetGame(): void {
    stopTimer();
    lifeLostReset.clear();
    shell.dataset.lifeLost = "false";
    resetGameProgress(shell);
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

  function onPointerMove(event: PointerEvent): void {
    const rect = board.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * state.width;
    state = moveBreakoutPaddle(state, x);
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
      markGameFinished(shell);
      stopTimer();
      playSound("gameWin");
    } else if (state.lost) {
      mode = "lost";
      markGameFinished(shell);
      stopTimer();
      input.clear();
      playSound("gameLose");
    } else if (state.lives < beforeLives) {
      mode = "ready";
      stopTimer();
      input.clear();
      showLifeLost();
      playSound("gameLose");
    }
    render();
  }

  function render(): void {
    difficultyButton.textContent = difficulty;
    pauseButton.textContent = mode === "paused" ? "Resume" : "Pause";
    status.textContent = statusText();
    hud.setStats({ Score: state.score, Lives: state.lives, Level: state.level });
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
    return `${state.score} · ${"♥".repeat(state.lives)}`;
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

  function savePreferences(): void {
    saveGamePreferences(breakout.id, { difficulty });
  }

  render();
  return () => {
    stopTimer();
    lifeLostReset.clear();
    invalidMove.cleanup();
    input.destroy();
    scope.cleanup();
    remove();
  };
}
