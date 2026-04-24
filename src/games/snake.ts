import { button, clearNode, createGameShell, directionFromKey, el, isConfirmOpen, Keys, markGameFinished, markGameStarted, matchesKey, nextDifficulty, previousDifficulty, requestGameReset, resetGameProgress, setBoardGrid, type Difficulty, type Direction, type GameDefinition } from "../core";
import { playSound } from "../sound";
import { moveSnakePoint, nextSnakeDirection, randomSnakeFood, snakeOutOfBounds, snakePointKey, snakePointsEqual, startSnakeBody, type SnakePoint } from "./snake.logic";
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

  const difficultyButton = button("", "button pill surface interactive");
  const reset = button("New", "button pill surface interactive");
  actions.append(difficultyButton, reset);

  difficultyButton.addEventListener("click", () => {
    difficulty = nextDifficulty(difficulty);
    playSound("uiToggle");
    resetGame();
  });
  reset.addEventListener("click", requestReset);
  document.addEventListener("keydown", onKeyDown);

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
    clearNode(grid);
    setBoardGrid(grid, config.size);
    status.textContent = statusText();
    difficultyButton.textContent = difficulty;

    const body = new Set(snake.map(snakePointKey));
    const head = snakePointKey(snake[0]!);
    for (let row = 0; row < config.size; row += 1) {
      for (let column = 0; column < config.size; column += 1) {
        const point = { row, column };
        const key = snakePointKey(point);
        const cell = el("div", { className: "snake-cell", ariaLabel: labelFor(point) });
        cell.dataset.snake = String(body.has(key));
        cell.dataset.head = String(key === head);
        cell.dataset.food = String(snakePointsEqual(point, food));
        grid.append(cell);
      }
    }
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (isConfirmOpen()) return;
    const next = directionFromKey(event);
    if (next) {
      event.preventDefault();
      if (queueDirection(next)) playSound("gameMove");
      start();
    } else if (matchesKey(event, Keys.activate)) {
      event.preventDefault();
      start();
    } else if (matchesKey(event, Keys.nextDifficulty)) {
      event.preventDefault();
      difficulty = nextDifficulty(difficulty);
      playSound("uiToggle");
      resetGame();
    } else if (matchesKey(event, Keys.previousDifficulty)) {
      event.preventDefault();
      difficulty = previousDifficulty(difficulty);
      playSound("uiToggle");
      resetGame();
    } else if (event.key.toLowerCase() === "n") {
      event.preventDefault();
      requestReset();
    }
  }

  function start(): void {
    if (state === "lost" || state === "won") return;
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
    const head = snake[0]!;
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
    if (snakePointsEqual(point, snake[0]!)) return `Row ${point.row + 1}, column ${point.column + 1}, snake head`;
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
    document.removeEventListener("keydown", onKeyDown);
    remove();
  };
}

