import { gridCell, required, shuffleInPlace, type RandomSource } from "../core";

export type MinesweeperCell = { mine: boolean; open: boolean; flag: boolean; nearby: number };
export type MinesweeperConfig = { mines: number; layout?: "fit" | "scroll" } & (
  | { size: number }
  | { rows: number; columns: number }
);
export type MinesweeperShape = { rows: number; columns: number };

export function minesweeperShape(config: MinesweeperConfig): MinesweeperShape {
  if ("size" in config) return { rows: config.size, columns: config.size };
  return { rows: config.rows, columns: config.columns };
}

export function newMinesweeperBoard(config: MinesweeperConfig): MinesweeperCell[][] {
  const shape = minesweeperShape(config);
  return Array.from({ length: shape.rows }, () =>
    Array.from({ length: shape.columns }, () => ({ mine: false, open: false, flag: false, nearby: 0 })),
  );
}

export function seededMinesweeperBoard(
  config: MinesweeperConfig,
  safeRow: number,
  safeColumn: number,
  rng?: RandomSource,
): MinesweeperCell[][] {
  assertMinesweeperConfig(config);
  const shape = minesweeperShape(config);
  const board = newMinesweeperBoard(config);
  const blocked = new Set(
    minesweeperNeighbors(config, safeRow, safeColumn)
      .concat([[safeRow, safeColumn]])
      .map(([r, c]) => key(r, c)),
  );
  const spots = Array.from(
    { length: shape.rows * shape.columns },
    (_, index) => [Math.floor(index / shape.columns), index % shape.columns] as const,
  ).filter(([r, c]) => !blocked.has(key(r, c)));

  shuffleInPlace(spots, rng)
    .slice(0, config.mines)
    .forEach(([r, c]) => {
      gridCell(board, r, c).mine = true;
    });

  for (let row = 0; row < shape.rows; row += 1) {
    for (let column = 0; column < shape.columns; column += 1) {
      gridCell(board, row, column).nearby = minesweeperNeighbors(config, row, column).filter(
        ([r, c]) => board[r]?.[c]?.mine,
      ).length;
    }
  }
  return board;
}

export function floodOpenMinesweeperInPlace(
  board: MinesweeperCell[][],
  config: MinesweeperConfig,
  row: number,
  column: number,
): void {
  const queue: [number, number][] = [[row, column]];
  for (let index = 0; index < queue.length; index += 1) {
    const [r, c] = required(queue[index]);
    const cell = board[r]?.[c];
    if (!cell || cell.open || cell.flag) continue;
    cell.open = true;
    if (cell.nearby === 0) queue.push(...minesweeperNeighbors(config, r, c));
  }
}

export function minesweeperNeighbors(config: MinesweeperConfig, row: number, column: number): [number, number][] {
  const shape = minesweeperShape(config);
  const found: [number, number][] = [];
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      const r = row + dr;
      const c = column + dc;
      if ((dr !== 0 || dc !== 0) && r >= 0 && r < shape.rows && c >= 0 && c < shape.columns) found.push([r, c]);
    }
  }
  return found;
}

export function flagMinesweeperCount(board: MinesweeperCell[][]): number {
  return board.flat().filter((cell) => cell.flag).length;
}

export function openSafeMinesweeperCount(board: MinesweeperCell[][]): number {
  return board.flat().filter((cell) => cell.open && !cell.mine).length;
}

export function assertMinesweeperConfig(config: MinesweeperConfig): void {
  const shape = minesweeperShape(config);
  if (!Number.isInteger(shape.rows) || shape.rows <= 0) throw new Error("Invalid Minesweeper rows");
  if (!Number.isInteger(shape.columns) || shape.columns <= 0) throw new Error("Invalid Minesweeper columns");
  if (!Number.isInteger(config.mines) || config.mines < 0 || config.mines >= shape.rows * shape.columns)
    throw new Error("Invalid Minesweeper mine count");
}

function key(row: number, column: number): string {
  return `${row}:${column}`;
}
