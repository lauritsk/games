import type { Difficulty } from "../core";

export type Mark = "X" | "O";
export type TicTacToeCell = Mark | "";

export const ticTacToeSize = 3;
export const humanMark: Mark = "X";
export const botMark: Mark = "O";

const lines = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
] as const;

export function newTicTacToeBoard(): TicTacToeCell[] {
  return Array<TicTacToeCell>(9).fill("");
}

export function chooseTicTacToeBotMove(board: TicTacToeCell[], difficulty: Difficulty): number {
  const open = openTicTacToeCells(board);
  if (difficulty === "Easy") return random(open);
  return winningTicTacToeMove(board, botMark) ?? winningTicTacToeMove(board, humanMark) ?? (difficulty === "Hard" ? minimaxMove(board) : centerCornerSide(board, open));
}

export function winningTicTacToeMove(board: TicTacToeCell[], mark: Mark): number | null {
  for (const index of openTicTacToeCells(board)) {
    const test = [...board];
    test[index] = mark;
    if (getTicTacToeWinner(test)?.winner === mark) return index;
  }
  return null;
}

export function openTicTacToeCells(board: TicTacToeCell[]): number[] {
  return board.flatMap((value, index) => value ? [] : [index]);
}

export function getTicTacToeWinner(board: TicTacToeCell[]): { winner: Mark; line: readonly number[] } | null {
  for (const line of lines) {
    const [a, b, c] = line;
    const value = board[a];
    if (value && value === board[b] && value === board[c]) return { winner: value, line };
  }
  return null;
}

function minimaxMove(board: TicTacToeCell[]): number {
  let best = -Infinity;
  let move = openTicTacToeCells(board)[0] ?? 0;
  for (const index of openTicTacToeCells(board)) {
    const test = [...board];
    test[index] = botMark;
    const score = minimax(test, false);
    if (score > best) {
      best = score;
      move = index;
    }
  }
  return move;
}

function minimax(board: TicTacToeCell[], maximizing: boolean): number {
  const result = getTicTacToeWinner(board);
  if (result?.winner === botMark) return 10;
  if (result?.winner === humanMark) return -10;
  if (board.every(Boolean)) return 0;

  const scores = openTicTacToeCells(board).map((index) => {
    const test = [...board];
    test[index] = maximizing ? botMark : humanMark;
    return minimax(test, !maximizing);
  });
  return maximizing ? Math.max(...scores) : Math.min(...scores);
}

function centerCornerSide(board: TicTacToeCell[], open: number[]): number {
  return [4, 0, 2, 6, 8, 1, 3, 5, 7].find((index) => open.includes(index)) ?? random(open);
}

function random(values: number[]): number {
  return values[Math.floor(Math.random() * values.length)] ?? 0;
}
