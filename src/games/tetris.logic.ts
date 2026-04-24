import { required, shuffleInPlace, type Direction, type RandomSource } from "../core";

export const tetrisRows = 20;
export const tetrisColumns = 10;

export type Tetromino = "I" | "J" | "L" | "O" | "S" | "T" | "Z";
export type TetrisCell = Tetromino | "";
export type TetrisBoard = TetrisCell[][];
export type TetrisPoint = { row: number; column: number };
export type TetrisPiece = { type: Tetromino; origin: TetrisPoint; rotation: number };
export type TetrisState = {
  board: TetrisBoard;
  piece: TetrisPiece;
  next: Tetromino;
  bag: Tetromino[];
  score: number;
  lines: number;
  level: number;
  over: boolean;
};

export const tetrominoes: Tetromino[] = ["I", "J", "L", "O", "S", "T", "Z"];

const shapes: Record<Tetromino, TetrisPoint[]> = {
  I: [{ row: 0, column: -1 }, { row: 0, column: 0 }, { row: 0, column: 1 }, { row: 0, column: 2 }],
  J: [{ row: -1, column: -1 }, { row: 0, column: -1 }, { row: 0, column: 0 }, { row: 0, column: 1 }],
  L: [{ row: -1, column: 1 }, { row: 0, column: -1 }, { row: 0, column: 0 }, { row: 0, column: 1 }],
  O: [{ row: -1, column: 0 }, { row: -1, column: 1 }, { row: 0, column: 0 }, { row: 0, column: 1 }],
  S: [{ row: -1, column: 0 }, { row: -1, column: 1 }, { row: 0, column: -1 }, { row: 0, column: 0 }],
  T: [{ row: -1, column: 0 }, { row: 0, column: -1 }, { row: 0, column: 0 }, { row: 0, column: 1 }],
  Z: [{ row: -1, column: -1 }, { row: -1, column: 0 }, { row: 0, column: 0 }, { row: 0, column: 1 }],
};

const kicks: TetrisPoint[] = [
  { row: 0, column: 0 },
  { row: 0, column: -1 },
  { row: 0, column: 1 },
  { row: -1, column: 0 },
  { row: 1, column: 0 },
  { row: 0, column: -2 },
  { row: 0, column: 2 },
];

export function newTetrisBoard(): TetrisBoard {
  return Array.from({ length: tetrisRows }, () => Array.from({ length: tetrisColumns }, () => "" as TetrisCell));
}

export function newTetrisState(rng: RandomSource = Math.random): TetrisState {
  const bag = newTetrisBag(rng);
  const piece = spawnTetrisPiece(drawFromBag(bag, rng));
  const next = drawFromBag(bag, rng);
  return { board: newTetrisBoard(), piece, next, bag, score: 0, lines: 0, level: 1, over: false };
}

export function newTetrisBag(rng: RandomSource = Math.random): Tetromino[] {
  return shuffleInPlace([...tetrominoes], rng);
}

export function drawFromBag(bag: Tetromino[], rng: RandomSource = Math.random): Tetromino {
  if (bag.length === 0) bag.push(...newTetrisBag(rng));
  return required(bag.shift(), "Missing tetromino");
}

export function spawnTetrisPiece(type: Tetromino): TetrisPiece {
  return { type, origin: { row: 1, column: Math.floor(tetrisColumns / 2) - 1 }, rotation: 0 };
}

export function tetrisPieceCells(piece: TetrisPiece): TetrisPoint[] {
  return shapes[piece.type].map((point) => {
    let row = point.row;
    let column = point.column;
    const turns = piece.type === "O" ? 0 : piece.rotation % 4;
    for (let index = 0; index < turns; index += 1) [row, column] = [column, -row];
    return { row: piece.origin.row + row, column: piece.origin.column + column };
  });
}

export function canPlaceTetrisPiece(board: TetrisBoard, piece: TetrisPiece): boolean {
  return tetrisPieceCells(piece).every((cell) =>
    cell.column >= 0 &&
    cell.column < tetrisColumns &&
    cell.row < tetrisRows &&
    (cell.row < 0 || board[cell.row]?.[cell.column] === ""),
  );
}

export function moveTetrisPiece(board: TetrisBoard, piece: TetrisPiece, direction: Direction): TetrisPiece {
  const delta = direction === "left" ? { row: 0, column: -1 } : direction === "right" ? { row: 0, column: 1 } : { row: 1, column: 0 };
  const moved = { ...piece, origin: { row: piece.origin.row + delta.row, column: piece.origin.column + delta.column } };
  return canPlaceTetrisPiece(board, moved) ? moved : piece;
}

export function rotateTetrisPiece(board: TetrisBoard, piece: TetrisPiece): TetrisPiece {
  if (piece.type === "O") return piece;
  const rotation = (piece.rotation + 1) % 4;
  for (const kick of kicks) {
    const rotated = { ...piece, rotation, origin: { row: piece.origin.row + kick.row, column: piece.origin.column + kick.column } };
    if (canPlaceTetrisPiece(board, rotated)) return rotated;
  }
  return piece;
}

export function lockTetrisPiece(board: TetrisBoard, piece: TetrisPiece): TetrisBoard {
  const next = board.map((row) => [...row]);
  for (const cell of tetrisPieceCells(piece)) {
    if (cell.row >= 0 && cell.row < tetrisRows && cell.column >= 0 && cell.column < tetrisColumns) {
      next[cell.row]![cell.column] = piece.type;
    }
  }
  return next;
}

export function clearTetrisLines(board: TetrisBoard): { board: TetrisBoard; cleared: number } {
  const remaining = board.filter((row) => row.some((cell) => cell === ""));
  const cleared = tetrisRows - remaining.length;
  const empty = Array.from({ length: cleared }, () => Array.from({ length: tetrisColumns }, () => "" as TetrisCell));
  return { board: [...empty, ...remaining], cleared };
}

export function tetrisDrop(state: TetrisState, rng: RandomSource = Math.random): TetrisState {
  if (state.over) return state;
  const moved = moveTetrisPiece(state.board, state.piece, "down");
  if (moved !== state.piece) return { ...state, piece: moved };

  const locked = lockTetrisPiece(state.board, state.piece);
  const { board, cleared } = clearTetrisLines(locked);
  const piece = spawnTetrisPiece(state.next);
  const next = drawFromBag(state.bag, rng);
  const lines = state.lines + cleared;
  const level = Math.floor(lines / 10) + 1;
  const score = state.score + tetrisLineScore(cleared, state.level);
  return { ...state, board, piece, next, lines, level, score, over: !canPlaceTetrisPiece(board, piece) };
}

export function tetrisHardDrop(state: TetrisState, rng: RandomSource = Math.random): TetrisState {
  let next = state;
  let drops = 0;
  while (!next.over) {
    const moved = moveTetrisPiece(next.board, next.piece, "down");
    if (moved === next.piece) break;
    next = { ...next, piece: moved };
    drops += 1;
  }
  const locked = tetrisDrop(next, rng);
  return { ...locked, score: locked.score + drops * 2 };
}

export function tetrisLineScore(lines: number, level: number): number {
  return ([0, 100, 300, 500, 800][lines] ?? 0) * level;
}
