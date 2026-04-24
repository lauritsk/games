import { button, clearNode, createGameShell, directionFromKey, el, isConfirmOpen, Keys, markGameFinished, markGameStarted, matchesKey, nextDifficulty, previousDifficulty, requestGameReset, resetGameProgress, setBoardGrid, type Difficulty, type Direction, type GameDefinition } from "../core";
import { playSound } from "../sound";

type Point = { row: number; column: number };
type State = "ready" | "playing" | "won" | "lost";
type Config = { size: number; speed: number };

const configs: Record<Difficulty, Config> = {
  Easy: { size: 14, speed: 170 },
  Medium: { size: 18, speed: 115 },
  Hard: { size: 22, speed: 75 },
};

const opposite: Record<Direction, Direction> = {
  up: "down",
  right: "left",
  down: "up",
  left: "right",
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
  let snake = startSnake(config.size);
  let food = randomFood(config.size, snake);
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
    snake = startSnake(config.size);
    food = randomFood(config.size, snake);
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

    const body = new Set(snake.map(pointKey));
    const head = pointKey(snake[0]!);
    for (let row = 0; row < config.size; row += 1) {
      for (let column = 0; column < config.size; column += 1) {
        const point = { row, column };
        const key = pointKey(point);
        const cell = el("div", { className: "snake-cell", ariaLabel: labelFor(point) });
        cell.dataset.snake = String(body.has(key));
        cell.dataset.head = String(key === head);
        cell.dataset.food = String(pointsEqual(point, food));
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
    if (next === opposite[direction] || next === queuedDirection) return false;
    queuedDirection = next;
    return true;
  }

  function tick(): void {
    direction = queuedDirection;
    const head = snake[0]!;
    const next = movePoint(head, direction);
    const ate = pointsEqual(next, food);
    const bodyToCheck = ate ? snake : snake.slice(0, -1);

    if (outOfBounds(next, config.size) || bodyToCheck.some((part) => pointsEqual(part, next))) {
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
        food = randomFood(config.size, snake);
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

  function labelFor(point: Point): string {
    if (pointsEqual(point, snake[0]!)) return `Row ${point.row + 1}, column ${point.column + 1}, snake head`;
    if (snake.some((part) => pointsEqual(part, point))) return `Row ${point.row + 1}, column ${point.column + 1}, snake body`;
    if (pointsEqual(point, food)) return `Row ${point.row + 1}, column ${point.column + 1}, food`;
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

function startSnake(size: number): Point[] {
  const row = Math.floor(size / 2);
  const column = Math.floor(size / 2);
  return [
    { row, column },
    { row, column: column - 1 },
    { row, column: column - 2 },
  ];
}

function movePoint(point: Point, direction: Direction): Point {
  if (direction === "up") return { row: point.row - 1, column: point.column };
  if (direction === "right") return { row: point.row, column: point.column + 1 };
  if (direction === "down") return { row: point.row + 1, column: point.column };
  return { row: point.row, column: point.column - 1 };
}

function randomFood(size: number, snake: Point[]): Point {
  const occupied = new Set(snake.map(pointKey));
  const empty = Array.from({ length: size * size }, (_, index) => ({
    row: Math.floor(index / size),
    column: index % size,
  })).filter((point) => !occupied.has(pointKey(point)));
  return empty[Math.floor(Math.random() * empty.length)] ?? snake[0]!;
}

function outOfBounds(point: Point, size: number): boolean {
  return point.row < 0 || point.column < 0 || point.row >= size || point.column >= size;
}

function pointsEqual(a: Point, b: Point): boolean {
  return a.row === b.row && a.column === b.column;
}

function pointKey(point: Point): string {
  return `${point.row}:${point.column}`;
}
