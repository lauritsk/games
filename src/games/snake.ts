import { createDifficultyButton, createGameShell, createMountScope, createResetButton, el, handleStandardGameKey, markGameFinished, markGameStarted, nextDifficulty, onDocumentKeyDown, previousDifficulty, requestGameReset, resetGameProgress, required, setBoardGrid, syncChildren, type Difficulty, type Direction, type GameDefinition } from "../core";
import { createInvalidMoveFeedback } from "../feedback";
import { playSound } from "../sound";
import { moveSnakePoint, nextSnakeDirection, oppositeSnakeDirection, randomSnakeFood, snakeOutOfBounds, snakePointKey, snakePointsEqual, startSnakeBody, type SnakePoint } from "./snake.logic";
type State = "ready" | "playing" | "won" | "lost";
type Config = { size: number; speed: number };

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
  let timer: ReturnType<typeof setInterval> | null = null;

  const { shell, status, actions, board: grid, remove } = createGameShell(target, {
    gameClass: "snake-game",
    boardClass: "board--snake",
    boardLabel: "Snake board",
  });
  shell.tabIndex = 0;

  const scope = createMountScope();
  const invalidMove = createInvalidMoveFeedback(shell);
  const difficultyButton = createDifficultyButton(actions, () => {
    difficulty = nextDifficulty(difficulty);
    playSound("uiToggle");
    resetGame();
  });
  createResetButton(actions, requestReset);
  onDocumentKeyDown(onKeyDown, scope);

  function requestReset(): void {
    playSound("uiReset");
    requestGameReset(shell, resetGame);
  }

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

    const body = new Set(snake.map(snakePointKey));
    const head = snakePointKey(required(snake[0]));
    const cells = syncChildren(grid, config.size * config.size, () => el("div", { className: "snake-cell" }));
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
        else if (state === "playing" && next === oppositeSnakeDirection[direction]) invalidMove.trigger();
        start();
      },
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
    const next = moveSnakePoint(head, direction);
    const ate = snakePointsEqual(next, food);
    const bodyToCheck = ate ? snake : snake.slice(0, -1);

    if (snakeOutOfBounds(next, config.size) || bodyToCheck.some((part) => snakePointsEqual(part, next))) {
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
    if (state === "ready") return "Ready";
    if (state === "won") return "Full";
    if (state === "lost") return `Crash · ${snake.length}`;
    return `Length ${snake.length}`;
  }

  function labelFor(point: SnakePoint): string {
    if (snakePointsEqual(point, required(snake[0]))) return `Row ${point.row + 1}, column ${point.column + 1}, snake head`;
    if (snake.some((part) => snakePointsEqual(part, point))) return `Row ${point.row + 1}, column ${point.column + 1}, snake body`;
    if (snakePointsEqual(point, food)) return `Row ${point.row + 1}, column ${point.column + 1}, food`;
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

