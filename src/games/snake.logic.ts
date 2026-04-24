import { required, type Direction, type RandomSource } from "../core";

export type SnakePoint = { row: number; column: number };

export const oppositeSnakeDirection: Record<Direction, Direction> = {
  up: "down",
  right: "left",
  down: "up",
  left: "right",
};

export function startSnakeBody(size: number): SnakePoint[] {
  const row = Math.floor(size / 2);
  const column = Math.floor(size / 2);
  return [
    { row, column },
    { row, column: column - 1 },
    { row, column: column - 2 },
  ];
}

export function moveSnakePoint(point: SnakePoint, direction: Direction): SnakePoint {
  if (direction === "up") return { row: point.row - 1, column: point.column };
  if (direction === "right") return { row: point.row, column: point.column + 1 };
  if (direction === "down") return { row: point.row + 1, column: point.column };
  return { row: point.row, column: point.column - 1 };
}

export function randomSnakeFood(size: number, snake: SnakePoint[], rng: RandomSource = Math.random): SnakePoint {
  const occupied = new Set(snake.map(snakePointKey));
  const empty = Array.from({ length: size * size }, (_, index) => ({
    row: Math.floor(index / size),
    column: index % size,
  })).filter((point) => !occupied.has(snakePointKey(point)));
  return empty[Math.floor(rng() * empty.length)] ?? required(snake[0]);
}

export function snakeOutOfBounds(point: SnakePoint, size: number): boolean {
  return point.row < 0 || point.column < 0 || point.row >= size || point.column >= size;
}

export function snakePointsEqual(a: SnakePoint, b: SnakePoint): boolean {
  return a.row === b.row && a.column === b.column;
}

export function snakePointKey(point: SnakePoint): string {
  return `${point.row}:${point.column}`;
}

export function nextSnakeDirection(current: Direction, queued: Direction, next: Direction): Direction {
  if (next === oppositeSnakeDirection[current] || next === queued) return queued;
  return next;
}
