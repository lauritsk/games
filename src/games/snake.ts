import {
  createGameShell,
  createMountScope,
  el,
  gameLayouts,
  handleStandardGameKey,
  markGameFinished,
  markGameStarted,
  onDocumentKeyDown,
  resetGameProgress,
  required,
  setBoardGrid,
  syncChildren,
  type Difficulty,
  type Direction,
  type GameDefinition,
} from "../core";
import { createInvalidMoveFeedback } from "../feedback";
import { playSound } from "../sound";
import {
  changeDifficulty,
  createDifficultyControl,
  createModeControl,
  createResetControl,
} from "./controls";
import {
  moveSnakePoint,
  nextSnakeDirection,
  oppositeSnakeDirection,
  randomSnakeFood,
  snakeOutOfBounds,
  snakePointKey,
  snakePointsEqual,
  startSnakeBody,
  wrapSnakePoint,
  type SnakePoint,
} from "./snake.logic";
type State = "ready" | "playing" | "won" | "lost";
type Config = { size: number; speed: number };
type WallMode = "fatal" | "teleport";

const configs: Record<Difficulty, Config> = {
  Easy: { size: 14, speed: 170 },
  Medium: { size: 18, speed: 115 },
  Hard: { size: 22, speed: 75 },
};

export const snake: GameDefinition = {
  id: "snake",
  name: "Snake",
  tagline: "Eat, grow, do not crash.",
  players: "Solo",
  theme: "deep-forest",
  mount: mountSnake,
};

export function mountSnake(target: HTMLElement): () => void {
  let difficulty: Difficulty = "Medium";
  let config = configs[difficulty];
  let snake = startSnakeBody(config.size);
  let food = randomSnakeFood(config.size, snake);
  let direction: Direction = "right";
  let queuedDirection: Direction = direction;
  let state: State = "ready";
  let wallMode: WallMode = "fatal";
  let timer: ReturnType<typeof setInterval> | null = null;

  const {
    shell,
    status,
    actions,
    board: grid,
    remove,
  } = createGameShell(target, {
    gameClass: "snake-game",
    boardClass: "board--snake",
    boardLabel: "Snake board",
    layout: gameLayouts.squareFit,
  });
  shell.tabIndex = 0;

  const scope = createMountScope();
  const invalidMove = createInvalidMoveFeedback(shell);
  const difficultyControl = {
    get: () => difficulty,
    set: (next: Difficulty) => {
      difficulty = next;
    },
    reset: resetGame,
  };
  const difficultyButton = createDifficultyControl(actions, difficultyControl);
  const wallModeButton = createModeControl(actions, {
    get: () => wallMode,
    set: (next) => {
      wallMode = next;
    },
    next: (current) => (current === "fatal" ? "teleport" : "fatal"),
    label: wallModeLabel,
    reset: resetGame,
  });
  const requestReset = createResetControl(actions, shell, resetGame);
  onDocumentKeyDown(onKeyDown, scope);

  function resetGame(): void {
    stopTimer();
    resetGameProgress(shell);
    config = configs[difficulty];
    snake = startSnakeBody(config.size);
    food = randomSnakeFood(config.size, snake);
    direction = "right";
    queuedDirection = direction;
    state = "ready";
    render();
  }

  function render(): void {
    setBoardGrid(grid, config.size);
    status.textContent = statusText();
    difficultyButton.textContent = difficulty;
    wallModeButton.textContent = wallModeLabel(wallMode);

    const body = new Set(snake.map(snakePointKey));
    const head = snakePointKey(required(snake[0]));
    const cells = syncChildren(grid, config.size * config.size, () =>
      el("div", { className: "snake-cell" }),
    );
    cells.forEach((cell, index) => {
      const point = { row: Math.floor(index / config.size), column: index % config.size };
      const key = snakePointKey(point);
      cell.setAttribute("aria-label", labelFor(point));
      cell.dataset.snake = String(body.has(key));
      cell.dataset.head = String(key === head);
      cell.dataset.food = String(snakePointsEqual(point, food));
    });
  }

  function onKeyDown(event: KeyboardEvent): void {
    handleStandardGameKey(event, {
      onDirection: (next) => {
        if (queueDirection(next)) playSound("gameMove");
        else if (state === "playing" && next === oppositeSnakeDirection[direction])
          invalidMove.trigger();
        start();
      },
      onActivate: start,
      onNextDifficulty: () => changeDifficulty(difficultyControl, "next"),
      onPreviousDifficulty: () => changeDifficulty(difficultyControl, "previous"),
      onReset: requestReset,
    });
  }

  function start(): void {
    if (state === "lost" || state === "won") {
      invalidMove.trigger();
      return;
    }
    if (timer) return;
    state = "playing";
    markGameStarted(shell);
    timer = setInterval(tick, config.speed);
    playSound("gameMajor");
    render();
  }

  function queueDirection(next: Direction): boolean {
    const queued = nextSnakeDirection(direction, queuedDirection, next);
    const changed = queued !== queuedDirection;
    queuedDirection = queued;
    return changed;
  }

  function tick(): void {
    direction = queuedDirection;
    const head = required(snake[0]);
    const moved = moveSnakePoint(head, direction);
    const outOfBounds = snakeOutOfBounds(moved, config.size);
    const next = wallMode === "teleport" ? wrapSnakePoint(moved, config.size) : moved;
    const ate = snakePointsEqual(next, food);
    const bodyToCheck = ate ? snake : snake.slice(0, -1);

    if (
      (outOfBounds && wallMode === "fatal") ||
      bodyToCheck.some((part) => snakePointsEqual(part, next))
    ) {
      state = "lost";
      markGameFinished(shell);
      stopTimer();
      playSound("gameLose");
      render();
      return;
    }

    snake = [next, ...snake];
    if (ate) {
      if (snake.length === config.size * config.size) {
        state = "won";
        markGameFinished(shell);
        stopTimer();
        playSound("gameWin");
      } else {
        food = randomSnakeFood(config.size, snake);
        playSound("gameGood");
      }
    } else {
      snake.pop();
    }
    render();
  }

  function statusText(): string {
    if (state === "ready") return `Ready · ${wallModeLabel(wallMode)}`;
    if (state === "won") return "Full";
    if (state === "lost") return `Crash · ${snake.length}`;
    return `Length ${snake.length} · ${wallModeLabel(wallMode)}`;
  }

  function wallModeLabel(mode: WallMode): string {
    return mode === "fatal" ? "Fatal walls" : "Teleport walls";
  }

  function labelFor(point: SnakePoint): string {
    if (snakePointsEqual(point, required(snake[0])))
      return `Row ${point.row + 1}, column ${point.column + 1}, snake head`;
    if (snake.some((part) => snakePointsEqual(part, point)))
      return `Row ${point.row + 1}, column ${point.column + 1}, snake body`;
    if (snakePointsEqual(point, food))
      return `Row ${point.row + 1}, column ${point.column + 1}, food`;
    return `Row ${point.row + 1}, column ${point.column + 1}, empty`;
  }

  function stopTimer(): void {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  render();
  return () => {
    stopTimer();
    invalidMove.cleanup();
    scope.cleanup();
    remove();
  };
}
