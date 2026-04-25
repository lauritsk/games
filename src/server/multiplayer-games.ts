import { isRecord } from "../validation";
import {
  dropConnect4DiscInPlace,
  findConnect4Win,
  newConnect4Board,
  connect4Columns,
  connect4Rows,
  connect4Human,
  connect4Bot,
  type Connect4Cell,
  type Connect4Player,
  type Connect4WinLine,
} from "../games/connect4.logic";
import {
  getTicTacToeWinner,
  newTicTacToeBoard,
  humanMark,
  botMark,
  type Mark,
  type TicTacToeCell,
} from "../games/tictactoe.logic";
import type { MultiplayerSeat } from "../multiplayer-protocol";

export type MultiplayerFinish = { winner: MultiplayerSeat | "draw" };

export type MultiplayerApplyResult<TState> =
  | { ok: true; state: TState; finished?: MultiplayerFinish }
  | { ok: false; error: string };

export type MultiplayerAdapter<TState = unknown, TAction = unknown> = {
  gameId: string;
  newState(): TState;
  parseAction(value: unknown): TAction | null;
  applyAction(
    state: TState,
    seat: MultiplayerSeat,
    action: TAction,
  ): MultiplayerApplyResult<TState>;
  publicSnapshot(state: TState): unknown;
};

type TicTacToeOnlineState = {
  board: TicTacToeCell[];
  current: MultiplayerSeat;
  winner: MultiplayerSeat | "draw" | null;
  winLine: readonly number[];
  moves: number;
};

type TicTacToeAction = { type: "place"; index: number };

const marks: Record<MultiplayerSeat, Mark> = { p1: humanMark, p2: botMark };
const seatsByMark: Record<Mark, MultiplayerSeat> = { X: "p1", O: "p2" };

export const ticTacToeMultiplayerAdapter: MultiplayerAdapter<
  TicTacToeOnlineState,
  TicTacToeAction
> = {
  gameId: "tictactoe",
  newState: () => ({
    board: newTicTacToeBoard(),
    current: "p1",
    winner: null,
    winLine: [],
    moves: 0,
  }),
  parseAction(value) {
    if (!isRecord(value) || value.type !== "place") return null;
    if (typeof value.index !== "number" || !Number.isInteger(value.index)) return null;
    if (value.index < 0 || value.index >= 9) return null;
    return { type: "place", index: value.index };
  },
  applyAction(state, seat, action) {
    if (state.winner) return { ok: false, error: "Game already finished" };
    if (state.current !== seat) return { ok: false, error: "Not your turn" };
    if (state.board[action.index]) return { ok: false, error: "Invalid move" };
    const board = [...state.board];
    board[action.index] = marks[seat];
    const result = getTicTacToeWinner(board);
    const moves = state.moves + 1;
    if (result) {
      const winner = seatsByMark[result.winner];
      return {
        ok: true,
        state: { board, current: state.current, winner, winLine: result.line, moves },
        finished: { winner },
      };
    }
    if (board.every(Boolean)) {
      return {
        ok: true,
        state: { board, current: state.current, winner: "draw", winLine: [], moves },
        finished: { winner: "draw" },
      };
    }
    return {
      ok: true,
      state: { board, current: seat === "p1" ? "p2" : "p1", winner: null, winLine: [], moves },
    };
  },
  publicSnapshot: (state) => ({ ...state }),
};

type Connect4OnlineState = {
  board: Connect4Cell[][];
  current: MultiplayerSeat;
  winner: MultiplayerSeat | "draw" | null;
  winningLine: Connect4WinLine;
  moves: number;
};

type Connect4Action = { type: "drop"; column: number };

const players = { p1: connect4Human, p2: connect4Bot } satisfies Record<
  MultiplayerSeat,
  Connect4Player
>;
const seatsByPlayer = { 1: "p1", 2: "p2" } satisfies Record<Connect4Player, MultiplayerSeat>;

export const connect4MultiplayerAdapter: MultiplayerAdapter<Connect4OnlineState, Connect4Action> = {
  gameId: "connect4",
  newState: () => ({
    board: newConnect4Board(),
    current: "p1",
    winner: null,
    winningLine: [],
    moves: 0,
  }),
  parseAction(value) {
    if (!isRecord(value) || value.type !== "drop") return null;
    if (typeof value.column !== "number" || !Number.isInteger(value.column)) return null;
    if (value.column < 0 || value.column >= connect4Columns) return null;
    return { type: "drop", column: value.column };
  },
  applyAction(state, seat, action) {
    if (state.winner) return { ok: false, error: "Game already finished" };
    if (state.current !== seat) return { ok: false, error: "Not your turn" };
    if (state.board[0]?.[action.column] !== 0) return { ok: false, error: "Invalid move" };
    const board = state.board.map((row) => [...row]);
    const player = players[seat];
    const row = dropConnect4DiscInPlace(board, action.column, player);
    if (row === null) return { ok: false, error: "Invalid move" };
    const moves = state.moves + 1;
    const line = findConnect4Win(board, row, action.column, player);
    if (line) {
      const winner = seatsByPlayer[player];
      return {
        ok: true,
        state: { board, current: state.current, winner, winningLine: line, moves },
        finished: { winner },
      };
    }
    if (moves >= connect4Rows * connect4Columns) {
      return {
        ok: true,
        state: { board, current: state.current, winner: "draw", winningLine: [], moves },
        finished: { winner: "draw" },
      };
    }
    return {
      ok: true,
      state: {
        board,
        current: seat === "p1" ? "p2" : "p1",
        winner: null,
        winningLine: [],
        moves,
      },
    };
  },
  publicSnapshot: (state) => ({ ...state }),
};

const adapters = new Map<string, MultiplayerAdapter>(
  [ticTacToeMultiplayerAdapter, connect4MultiplayerAdapter].map((adapter) => [
    adapter.gameId,
    adapter,
  ]),
);

export function multiplayerAdapterForGame(gameId: string): MultiplayerAdapter | null {
  return adapters.get(gameId) ?? null;
}

export function supportedMultiplayerGameIds(): string[] {
  return [...adapters.keys()];
}

export function oppositeSeat(seat: MultiplayerSeat): MultiplayerSeat {
  return seat === "p1" ? "p2" : "p1";
}
