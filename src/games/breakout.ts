import { Keys, createDifficultyButton, createGameShell, createMountScope, createResetButton, el, handleStandardGameKey, isConfirmOpen, markGameFinished, markGameStarted, matchesKey, nextDifficulty, onDocumentKeyDown, previousDifficulty, requestGameReset, resetGameProgress, type Difficulty, type Direction, type GameDefinition } from "../core";
import { createInvalidMoveFeedback } from "../feedback";
import { playSound } from "../sound";
import { moveBreakoutPaddle, newBreakoutState, stepBreakout, type BreakoutConfig, type BreakoutState } from "./breakout.logic";

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
  let difficulty: Difficulty = "Medium";
  let state = newBreakoutState(configs[difficulty]);
  let mode: Mode = "ready";
  let timer: ReturnType<typeof setInterval> | null = null;
  let lifeLostTimer: ReturnType<typeof setTimeout> | null = null;
  const heldKeys = new Set<"left" | "right">();

  const { shell, status, actions, board, remove } = createGameShell(target, {
    gameClass: "breakout-game",
    boardClass: "board--breakout",
    boardLabel: "Breakout playfield",
  });
  shell.tabIndex = 0;

  const scope = createMountScope();
  const invalidMove = createInvalidMoveFeedback(shell);
  const ball = el("div", { className: "breakout-ball" });
  const paddle = el("div", { className: "breakout-paddle" });
  const bricks = el("div", { className: "breakout-bricks" });
  board.append(bricks, paddle, ball);

  const difficultyButton = createDifficultyButton(actions, () => {
    difficulty = nextDifficulty(difficulty);
    playSound("uiToggle");
    resetGame();
  });
  const pauseButton = el("button", { className: "button pill surface interactive", text: "Pause", type: "button" });
  pauseButton.addEventListener("click", togglePause);
  actions.append(pauseButton);
  createResetButton(actions, requestReset);

  onDocumentKeyDown(onKeyDown, scope);
  document.addEventListener("keyup", onKeyUp, { signal: scope.signal });
  window.addEventListener("blur", () => heldKeys.clear(), { signal: scope.signal });
  board.addEventListener("pointermove", onPointerMove, { signal: scope.signal });
  board.addEventListener("pointerdown", (event) => {
    onPointerMove(event);
    start();
  }, { signal: scope.signal });

  function requestReset(): void {
    playSound("uiReset");
    requestGameReset(shell, resetGame);
  }

  function resetGame(): void {
    stopTimer();
    stopLifeLostTimer();
    shell.dataset.lifeLost = "false";
    resetGameProgress(shell);
    state = newBreakoutState(configs[difficulty]);
    mode = "ready";
    heldKeys.clear();
    render();
  }

  function start(): void {
    if (mode === "won" || mode === "lost") {
      invalidMove.trigger();
      return;
    }
    if (mode === "ready") {
      mode = "playing";
      markGameStarted(shell);
      playSound("gameMajor");
    }
    if (mode === "paused") mode = "playing";
    restartTimer();
    render();
  }

  function togglePause(): void {
    if (mode === "won" || mode === "lost") return;
    if (mode === "playing") {
      mode = "paused";
      stopTimer();
      playSound("uiToggle");
    } else start();
    render();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (isConfirmOpen()) return;
    if (event.key.toLowerCase() === "p") {
      event.preventDefault();
      togglePause();
      return;
    }
    if (matchesKey(event, [...Keys.left, "a"])) {
      event.preventDefault();
      heldKeys.add("left");
      start();
      return;
    }
    if (matchesKey(event, [...Keys.right, "d"])) {
      event.preventDefault();
      heldKeys.add("right");
      start();
      return;
    }
    handleStandardGameKey(event, {
      onDirection: (direction) => movePaddleByKey(direction),
      onActivate: start,
      onNextDifficulty: () => {
        difficulty = nextDifficulty(difficulty);
        playSound("uiToggle");
        resetGame();
      },
      onPreviousDifficulty: () => {
        difficulty = previousDifficulty(difficulty);
        playSound("uiToggle");
        resetGame();
      },
      onReset: requestReset,
    });
  }

  function onKeyUp(event: KeyboardEvent): void {
    if (matchesKey(event, [...Keys.left, "a"])) heldKeys.delete("left");
    if (matchesKey(event, [...Keys.right, "d"])) heldKeys.delete("right");
  }

  function movePaddleByKey(direction: Direction): void {
    if (direction !== "left" && direction !== "right") return;
    heldKeys.add(direction);
    start();
  }

  function moveHeldPaddle(): void {
    const left = heldKeys.has("left");
    const right = heldKeys.has("right");
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
      heldKeys.clear();
      playSound("gameLose");
    } else if (state.lives < beforeLives) {
      mode = "ready";
      stopTimer();
      heldKeys.clear();
      showLifeLost();
      playSound("gameLose");
    }
    render();
  }

  function render(): void {
    difficultyButton.textContent = difficulty;
    pauseButton.textContent = mode === "paused" ? "Resume" : "Pause";
    status.textContent = statusText();
    positionBall();
    position(paddle, state.paddle.x, state.paddle.y, state.paddle.width, state.paddle.height);
    syncBricks(state);
  }

  function syncBricks(next: BreakoutState): void {
    while (bricks.children.length > next.bricks.length) bricks.lastElementChild?.remove();
    while (bricks.children.length < next.bricks.length) bricks.append(el("div", { className: "breakout-brick" }));
    Array.from(bricks.children).forEach((child, index) => {
      const brick = next.bricks[index];
      if (!(child instanceof HTMLElement) || !brick) return;
      position(child, brick.x, brick.y, brick.width, brick.height);
      child.dataset.alive = String(brick.alive);
      child.setAttribute("aria-label", brick.alive ? `Brick ${index + 1}` : `Destroyed brick ${index + 1}`);
    });
  }

  function positionBall(): void {
    const diameter = state.ball.radius * 2;
    const visualDiameterY = diameter * 0.8;
    ball.style.left = `${state.ball.x - state.ball.radius}%`;
    ball.style.top = `${state.ball.y - visualDiameterY / 2}%`;
    ball.style.width = `${diameter}%`;
    ball.style.height = `${visualDiameterY}%`;
  }

  function position(element: HTMLElement, x: number, y: number, width: number, height: number): void {
    element.style.left = `${x}%`;
    element.style.top = `${y}%`;
    element.style.width = `${width}%`;
    element.style.height = `${height}%`;
  }

  function statusText(): string {
    if (mode === "ready") return "Ready";
    if (mode === "paused") return "Paused";
    if (mode === "won") return `Clear · ${state.score}`;
    if (mode === "lost") return `Out · ${state.score}`;
    return `${state.score} · ${"♥".repeat(state.lives)}`;
  }

  function showLifeLost(): void {
    stopLifeLostTimer();
    shell.dataset.lifeLost = "true";
    lifeLostTimer = setTimeout(() => {
      shell.dataset.lifeLost = "false";
      lifeLostTimer = null;
    }, 900);
  }

  function stopLifeLostTimer(): void {
    if (!lifeLostTimer) return;
    clearTimeout(lifeLostTimer);
    lifeLostTimer = null;
  }

  function aliveBrickCount(next: BreakoutState): number {
    return next.bricks.filter((brick) => brick.alive).length;
  }

  function restartTimer(): void {
    if (mode !== "playing" || timer) return;
    timer = setInterval(tick, 16);
  }

  function stopTimer(): void {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  render();
  return () => {
    stopTimer();
    stopLifeLostTimer();
    invalidMove.cleanup();
    scope.cleanup();
    remove();
  };
}
