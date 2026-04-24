import { gridCell, required, shuffleInPlace, type RandomSource } from "../core";

export type MinesweeperCell = { mine: boolean; open: boolean; flag: boolean; nearby: number };
export type MinesweeperConfig = { size: number; mines: number };

export function newMinesweeperBoard(config: MinesweeperConfig): MinesweeperCell[][] {
  return Array.from({ length: config.size }, () => Array.from({ length: config.size }, () => ({ mine: false, open: false, flag: false, nearby: 0 })));
}

export function seededMinesweeperBoard(config: MinesweeperConfig, safeRow: number, safeColumn: number, rng?: RandomSource): MinesweeperCell[][] {
  assertMinesweeperConfig(config);
  const board = newMinesweeperBoard(config);
  const blocked = new Set(minesweeperNeighbors(config, safeRow, safeColumn).concat([[safeRow, safeColumn]]).map(([r, c]) => key(r, c)));
  const spots = Array.from({ length: config.size * config.size }, (_, index) => [Math.floor(index / config.size), index % config.size] as const).filter(([r, c]) => !blocked.has(key(r, c)));

  shuffleInPlace(spots, rng).slice(0, config.mines).forEach(([r, c]) => { gridCell(board, r, c).mine = true; });

  for (let row = 0; row < config.size; row += 1) {
    for (let column = 0; column < config.size; column += 1) {
      gridCell(board, row, column).nearby = minesweeperNeighbors(config, row, column).filter(([r, c]) => board[r]?.[c]?.mine).length;
    }
  }
  return board;
}

export function floodOpenMinesweeperInPlace(board: MinesweeperCell[][], config: MinesweeperConfig, row: number, column: number): void {
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
  const found: [number, number][] = [];
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      const r = row + dr;
      const c = column + dc;
      if ((dr !== 0 || dc !== 0) && r >= 0 && r < config.size && c >= 0 && c < config.size) found.push([r, c]);
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
  if (!Number.isInteger(config.size) || config.size <= 0) throw new Error("Invalid Minesweeper size");
  if (!Number.isInteger(config.mines) || config.mines < 0 || config.mines >= config.size * config.size) throw new Error("Invalid Minesweeper mine count");
}

function key(row: number, column: number): string { return `${row}:${column}`; }
