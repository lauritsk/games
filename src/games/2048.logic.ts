import type { Direction } from "../core";

export type Board2048 = number[][];

export function start2048Board(size: number): Board2048 {
  return addRandom2048Tile(addRandom2048Tile(empty2048Board(size)));
}

export function empty2048Board(size: number): Board2048 {
  return Array.from({ length: size }, () => Array<number>(size).fill(0));
}

export function addRandom2048Tile(board: Board2048): Board2048 {
  const next = clone2048Board(board);
  const empty = next.flatMap((row, r) => row.map((value, c) => ({ value, r, c }))).filter((cell) => cell.value === 0);
  const cell = empty[Math.floor(Math.random() * empty.length)];
  if (cell) next[cell.r]![cell.c] = Math.random() < 0.9 ? 2 : 4;
  return next;
}

export function slide2048(board: Board2048, direction: Direction): { board: Board2048; score: number; changed: boolean } {
  const size = board.length;
  const next = empty2048Board(size);
  let score = 0;

  for (let index = 0; index < size; index += 1) {
    const line = readLine(board, direction, index);
    const merged = merge2048Line(line);
    score += merged.score;
    writeLine(next, direction, index, merged.line);
  }

  return { board: next, score, changed: !boards2048Equal(board, next) };
}

export function merge2048Line(line: number[]): { line: number[]; score: number } {
  const compact = line.filter(Boolean);
  const merged: number[] = [];
  let score = 0;

  for (let index = 0; index < compact.length; index += 1) {
    if (compact[index] === compact[index + 1]) {
      const value = compact[index]! * 2;
      merged.push(value);
      score += value;
      index += 1;
    } else {
      merged.push(compact[index]!);
    }
  }

  return { line: merged.concat(Array(line.length - merged.length).fill(0)), score };
}

export function canMove2048(board: Board2048): boolean {
  if (board.flat().includes(0)) return true;
  return (["up", "right", "down", "left"] as const).some((direction) => slide2048(board, direction).changed);
}

function readLine(board: Board2048, direction: Direction, index: number): number[] {
  const size = board.length;
  return Array.from({ length: size }, (_, step) => {
    if (direction === "left") return board[index]![step]!;
    if (direction === "right") return board[index]![size - 1 - step]!;
    if (direction === "up") return board[step]![index]!;
    return board[size - 1 - step]![index]!;
  });
}

function writeLine(board: Board2048, direction: Direction, index: number, line: number[]): void {
  const size = board.length;
  for (let step = 0; step < size; step += 1) {
    if (direction === "left") board[index]![step] = line[step]!;
    else if (direction === "right") board[index]![size - 1 - step] = line[step]!;
    else if (direction === "up") board[step]![index] = line[step]!;
    else board[size - 1 - step]![index] = line[step]!;
  }
}

function boards2048Equal(a: Board2048, b: Board2048): boolean {
  return a.every((row, rowIndex) => row.every((value, columnIndex) => value === b[rowIndex]?.[columnIndex]));
}

function clone2048Board(board: Board2048): Board2048 {
  return board.map((row) => [...row]);
}
