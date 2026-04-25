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
import { loadGamePreferences, parseDifficulty, saveGamePreferences } from "../game-preferences";
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
type SnakeCellState = {
  snake: boolean;
  head: boolean;
  food: boolean;
};
type WallMode = "fatal" | "teleport";

const configs: Record<Difficulty, Config> = {
  Easy: { size: 14, speed: 170 },
  Medium: { size: 18, speed: 115 },
  Hard: { size: 22, speed: 75 },
};
const gameId = "snake";

export const snake: GameDefinition = {
  id: gameId,
  name: "Snake",
  tagline: "Eat, grow, do not crash.",
  players: "Solo",
  theme: "deep-forest",
  mount: mountSnake,
};

export function mountSnake(target: HTMLElement): () => void {
  const preferences = loadGamePreferences(gameId);
  let difficulty: Difficulty = parseDifficulty(preferences.difficulty) ?? "Medium";
  let wallMode: WallMode = parseWallMode(preferences.options?.wallMode) ?? "fatal";
  let config = configs[difficulty];
  let snake = startSnakeBody(config.size);
  let food = randomSnakeFood(config.size, snake);
  let direction: Direction = "right";
  let queuedDirection: Direction = direction;
  let state: State = "ready";
  let animationFrame = 0;
  let lastFrameTime = 0;
  let tickRemainder = 0;
  let cells: HTMLDivElement[] = [];
  let renderedSize = 0;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

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
      savePreferences();
    },
    reset: resetGame,
  };
  const difficultyButton = createDifficultyControl(actions, difficultyControl);
  const wallModeButton = createModeControl(actions, {
    get: () => wallMode,
    set: (next) => {
      wallMode = next;
      savePreferences();
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
    savePreferences();
    render();
  }

  function render(previousSnake?: SnakePoint[]): void {
    const boardRebuilt = prepareBoard();
    status.textContent = statusText();
    difficultyButton.textContent = difficulty;
    wallModeButton.textContent = wallModeLabel(wallMode);

    const body = new Set(snake.map(snakePointKey));
    const origins = previousSnake ? segmentOrigins(previousSnake) : new Map<string, SnakePoint>();
    const head = snakePointKey(required(snake[0]));
    cells.forEach((cell, index) => {
      const point = { row: Math.floor(index / config.size), column: index % config.size };
      const key = snakePointKey(point);
      const isSnake = body.has(key);
      const isHead = key === head;
      const isFood = snakePointsEqual(point, food);
      const cellState = {
        snake: isSnake,
        head: isHead,
        food: isFood,
      } satisfies SnakeCellState;
      updateCell(cell, point, cellState, boardRebuilt, origins.get(key));
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
    if (animationFrame) return;
    state = "playing";
    markGameStarted(shell);
    lastFrameTime = 0;
    tickRemainder = 0;
    animationFrame = requestAnimationFrame(runFrame);
    playSound("gameMajor");
    render();
  }

  function queueDirection(next: Direction): boolean {
    const queued = nextSnakeDirection(direction, queuedDirection, next);
    const changed = queued !== queuedDirection;
    queuedDirection = queued;
    return changed;
  }

  function runFrame(time: number): void {
    if (!lastFrameTime) lastFrameTime = time;
    tickRemainder += Math.min(time - lastFrameTime, config.speed * 2);
    lastFrameTime = time;

    if (tickRemainder >= config.speed) {
      tickRemainder %= config.speed;
      tick();
    }

    if (state === "playing") animationFrame = requestAnimationFrame(runFrame);
  }

  function tick(): void {
    direction = queuedDirection;
    const previousSnake = snake;
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
    render(previousSnake);
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

  function parseWallMode(value: unknown): WallMode | null {
    return value === "fatal" || value === "teleport" ? value : null;
  }

  function labelFor(point: SnakePoint, isHead: boolean, isSnake: boolean, isFood: boolean): string {
    if (isHead) return `Row ${point.row + 1}, column ${point.column + 1}, snake head`;
    if (isSnake) return `Row ${point.row + 1}, column ${point.column + 1}, snake body`;
    if (isFood) return `Row ${point.row + 1}, column ${point.column + 1}, food`;
    return `Row ${point.row + 1}, column ${point.column + 1}, empty`;
  }

  function prepareBoard(): boolean {
    if (renderedSize === config.size) return false;
    renderedSize = config.size;
    setBoardGrid(grid, config.size);
    cells = syncChildren(grid, config.size * config.size, () =>
      el("div", { className: "snake-cell" }),
    );
    return true;
  }

  function segmentOrigins(previousSnake: SnakePoint[]): Map<string, SnakePoint> {
    const origins = new Map<string, SnakePoint>();
    snake.forEach((point, index) => {
      const previous =
        snake.length > previousSnake.length && index === snake.length - 1
          ? point
          : (previousSnake[index - 1] ?? required(previousSnake[0]));
      origins.set(snakePointKey(point), previous);
    });
    return origins;
  }

  function updateCell(
    cell: HTMLDivElement,
    point: SnakePoint,
    next: SnakeCellState,
    forceLabel: boolean,
    origin?: SnakePoint,
  ): void {
    const changed =
      cell.dataset.snake !== String(next.snake) ||
      cell.dataset.head !== String(next.head) ||
      cell.dataset.food !== String(next.food);
    if (!changed && !forceLabel) {
      animateSnakeCell(cell, point, next, origin);
      return;
    }

    if (changed) {
      setData(cell, "snake", next.snake);
      setData(cell, "head", next.head);
      setData(cell, "food", next.food);
    }
    cell.setAttribute("aria-label", labelFor(point, next.head, next.snake, next.food));
    animateSnakeCell(cell, point, next, origin);
  }

  function animateSnakeCell(
    cell: HTMLDivElement,
    point: SnakePoint,
    next: SnakeCellState,
    origin: SnakePoint | undefined,
  ): void {
    if (!next.snake || !origin || reducedMotion.matches) return;

    const columnDelta = origin.column - point.column;
    const rowDelta = origin.row - point.row;
    if (Math.abs(columnDelta) + Math.abs(rowDelta) !== 1) return;

    const scale = next.head ? " scale(1.02)" : "";
    cell.getAnimations().forEach((animation) => animation.cancel());
    cell.animate(
      [
        { transform: `translate(${columnDelta * 100}%, ${rowDelta * 100}%)${scale}` },
        { transform: `translate(0, 0)${scale}` },
      ],
      {
        duration: Math.min(96, config.speed * 0.86),
        easing: "linear",
      },
    );
  }

  function setData(cell: HTMLDivElement, key: string, value: boolean): void {
    const next = String(value);
    if (cell.dataset[key] !== next) cell.dataset[key] = next;
  }

  function stopTimer(): void {
    if (!animationFrame) return;
    cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    lastFrameTime = 0;
    tickRemainder = 0;
  }

  function savePreferences(): void {
    saveGamePreferences(gameId, { difficulty, options: { wallMode } });
  }

  render();
  return () => {
    stopTimer();
    invalidMove.cleanup();
    scope.cleanup();
    remove();
  };
}
