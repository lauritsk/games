import { required, type Difficulty, type RandomSource } from "../core";

export type Connect4Player = 1 | 2;
export type Connect4Cell = Connect4Player | 0;
export type Connect4WinLine = [number, number][];

export const connect4Rows = 6;
export const connect4Columns = 7;
export const connect4Length = 4;
export const connect4Human: Connect4Player = 1;
export const connect4Bot: Connect4Player = 2;

export function newConnect4Board(): Connect4Cell[][] {
  return Array.from({ length: connect4Rows }, () => Array<Connect4Cell>(connect4Columns).fill(0));
}

export function chooseConnect4BotColumn(board: Connect4Cell[][], difficulty: Difficulty, rng?: RandomSource): number {
  assertConnect4Board(board);
  const valid = playableConnect4Columns(board);
  if (difficulty === "Easy") return randomMove(valid, rng);

  const tactical = findConnect4TacticalMove(board, connect4Bot, valid) ?? findConnect4TacticalMove(board, connect4Human, valid);
  if (tactical !== null) return tactical;

  if (difficulty === "Hard") return safeShapeMove(board, valid) ?? bestShapeMove(board, valid) ?? randomMove(valid, rng);
  return bestShapeMove(board, valid) ?? randomMove(valid, rng);
}

export function playableConnect4Columns(board: Connect4Cell[][]): number[] {
  assertConnect4Board(board);
  return Array.from({ length: connect4Columns }, (_, column) => column).filter((column) => board[0]?.[column] === 0);
}

export function findConnect4TacticalMove(board: Connect4Cell[][], player: Connect4Player, valid = playableConnect4Columns(board)): number | null {
  assertConnect4Board(board);
  for (const column of valid) {
    const test = cloneConnect4Board(board);
    const row = dropConnect4DiscInPlace(test, column, player);
    if (row !== null && findConnect4Win(test, row, column, player)) return column;
  }
  return null;
}

export function dropConnect4DiscInPlace(board: Connect4Cell[][], column: number, player: Connect4Player): number | null {
  assertConnect4Board(board);
  for (let row = connect4Rows - 1; row >= 0; row -= 1) {
    if (board[row]?.[column] === 0) {
      required(board[row])[column] = player;
      return row;
    }
  }
  return null;
}

export function cloneConnect4Board(board: Connect4Cell[][]): Connect4Cell[][] {
  return board.map((row) => [...row]);
}

export function findConnect4Win(board: Connect4Cell[][], row: number, column: number, player: Connect4Player): Connect4WinLine | null {
  const directions = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ] as const;

  for (const [dr, dc] of directions) {
    const line: Connect4WinLine = [[row, column]];
    line.push(...walk(board, row, column, dr, dc, player));
    line.push(...walk(board, row, column, -dr, -dc, player));
    if (line.length >= connect4Length) return line;
  }
  return null;
}

function randomMove(valid: number[], rng: RandomSource = Math.random): number {
  return valid[Math.floor(rng() * valid.length)] ?? 0;
}

function safeShapeMove(board: Connect4Cell[][], valid: number[]): number | null {
  return valid
    .filter((column) => !givesImmediateWin(board, column))
    .sort((a, b) => scoreMove(board, b, connect4Bot) - scoreMove(board, a, connect4Bot))[0] ?? null;
}

function givesImmediateWin(board: Connect4Cell[][], column: number): boolean {
  const test = cloneConnect4Board(board);
  const row = dropConnect4DiscInPlace(test, column, connect4Bot);
  if (row === null) return true;
  return findConnect4TacticalMove(test, connect4Human, playableConnect4Columns(test)) !== null;
}

function bestShapeMove(board: Connect4Cell[][], valid: number[]): number | null {
  const center = Math.floor(connect4Columns / 2);
  return [...valid].sort((a, b) => scoreMove(board, b, connect4Bot) - scoreMove(board, a, connect4Bot) || Math.abs(a - center) - Math.abs(b - center))[0] ?? null;
}

function scoreMove(board: Connect4Cell[][], column: number, player: Connect4Player): number {
  const test = cloneConnect4Board(board);
  const row = dropConnect4DiscInPlace(test, column, player);
  if (row === null) return -Infinity;
  return longestLine(test, row, column, player) * 10 - Math.abs(column - Math.floor(connect4Columns / 2));
}

function longestLine(board: Connect4Cell[][], row: number, column: number, player: Connect4Player): number {
  const directions = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ] as const;
  return Math.max(...directions.map(([dr, dc]) => 1 + walk(board, row, column, dr, dc, player).length + walk(board, row, column, -dr, -dc, player).length));
}

export function assertConnect4Board(board: Connect4Cell[][]): void {
  if (board.length !== connect4Rows || board.some((row) => row.length !== connect4Columns)) throw new Error("Invalid Connect 4 board shape");
}

function walk(board: Connect4Cell[][], row: number, column: number, dr: number, dc: number, player: Connect4Player): Connect4WinLine {
  const line: Connect4WinLine = [];
  let r = row + dr;
  let c = column + dc;
  while (r >= 0 && r < connect4Rows && c >= 0 && c < connect4Columns && board[r]?.[c] === player) {
    line.push([r, c]);
    r += dr;
    c += dc;
  }
  return line;
}
