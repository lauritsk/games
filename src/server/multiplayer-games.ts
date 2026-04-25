import { isRecord, parseOneOf } from "../validation";
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
  moveSnakePoint,
  nextSnakeDirection,
  randomSnakeFood,
  snakeOutOfBounds,
  snakePointKey,
  snakePointsEqual,
  type SnakePoint,
} from "../games/snake.logic";
import {
  getTicTacToeWinner,
  newTicTacToeBoard,
  humanMark,
  botMark,
  ticTacToeSize,
  type Mark,
  type TicTacToeCell,
} from "../games/tictactoe.logic";
import { oppositeMultiplayerSeat, type MultiplayerSeat } from "../multiplayer-protocol";
import type { Direction } from "../types";

export type MultiplayerFinish = { winner: MultiplayerSeat | "draw" };

export type MultiplayerApplyResult<TState> =
  | { ok: true; state: TState; finished?: MultiplayerFinish }
  | { ok: false; error: string };

export type MultiplayerAdapter<TState = unknown, TAction = unknown> = {
  gameId: string;
  minPlayers?: number;
  maxPlayers?: number;
  autoStart?: boolean;
  tickMs?: number;
  acceptStaleActions?: boolean;
  newState(): TState;
  start?(state: TState, seats: readonly MultiplayerSeat[]): MultiplayerApplyResult<TState>;
  tick?(state: TState): MultiplayerApplyResult<TState> | null;
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

const ticTacToeCellCount = ticTacToeSize * ticTacToeSize;
const marks: Record<MultiplayerSeat, Mark> = {
  p1: humanMark,
  p2: botMark,
  p3: humanMark,
  p4: botMark,
};
const seatsByMark: Record<Mark, MultiplayerSeat> = { X: "p1", O: "p2" };

export const ticTacToeMultiplayerAdapter: MultiplayerAdapter<
  TicTacToeOnlineState,
  TicTacToeAction
> = {
  gameId: "tictactoe",
  maxPlayers: 2,
  newState: () => ({
    board: newTicTacToeBoard(),
    current: "p1",
    winner: null,
    winLine: [],
    moves: 0,
  }),
  parseAction(value) {
    if (!isRecord(value) || value.type !== "place") return null;
    const index = parseIntegerInRange(value.index, 0, ticTacToeCellCount);
    return index === null ? null : { type: "place", index };
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
      state: { board, current: oppositeMultiplayerSeat(seat), winner: null, winLine: [], moves },
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

const players = {
  p1: connect4Human,
  p2: connect4Bot,
  p3: connect4Human,
  p4: connect4Bot,
} satisfies Record<MultiplayerSeat, Connect4Player>;
const seatsByPlayer = { 1: "p1", 2: "p2" } satisfies Record<Connect4Player, MultiplayerSeat>;

export const connect4MultiplayerAdapter: MultiplayerAdapter<Connect4OnlineState, Connect4Action> = {
  gameId: "connect4",
  maxPlayers: 2,
  newState: () => ({
    board: newConnect4Board(),
    current: "p1",
    winner: null,
    winningLine: [],
    moves: 0,
  }),
  parseAction(value) {
    if (!isRecord(value) || value.type !== "drop") return null;
    const column = parseIntegerInRange(value.column, 0, connect4Columns);
    return column === null ? null : { type: "drop", column };
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
        current: oppositeMultiplayerSeat(seat),
        winner: null,
        winningLine: [],
        moves,
      },
    };
  },
  publicSnapshot: (state) => ({ ...state }),
};

type SnakeOnlinePlayer = {
  seat: MultiplayerSeat;
  snake: SnakePoint[];
  direction: Direction;
  queuedDirection: Direction;
  alive: boolean;
  score: number;
};

type SnakeOnlineState = {
  size: number;
  food: SnakePoint;
  players: SnakeOnlinePlayer[];
  winner: MultiplayerSeat | "draw" | null;
  tick: number;
  startedAt: number | null;
};

type SnakeAction = { type: "direction"; direction: Direction };

type SnakeMoveProposal = {
  seat: MultiplayerSeat;
  direction: Direction;
  next: SnakePoint;
  ate: boolean;
  outOfBounds: boolean;
};

const snakeOnlineSize = 18;
const snakeOnlineSpeedMs = 115;
const snakeStartDirections = {
  p1: "right",
  p2: "left",
  p3: "down",
  p4: "up",
} satisfies Record<MultiplayerSeat, Direction>;

export const snakeMultiplayerAdapter: MultiplayerAdapter<SnakeOnlineState, SnakeAction> = {
  gameId: "snake",
  minPlayers: 2,
  maxPlayers: 4,
  autoStart: false,
  tickMs: snakeOnlineSpeedMs,
  acceptStaleActions: true,
  newState: () => ({
    size: snakeOnlineSize,
    food: { row: 0, column: 0 },
    players: [],
    winner: null,
    tick: 0,
    startedAt: null,
  }),
  start(_state, seats) {
    const players = seats.map((seat) => newSnakeOnlinePlayer(snakeOnlineSize, seat));
    return {
      ok: true,
      state: {
        size: snakeOnlineSize,
        food: randomSnakeFood(
          snakeOnlineSize,
          players.flatMap((player) => player.snake),
        ),
        players,
        winner: null,
        tick: 0,
        startedAt: Date.now(),
      },
    };
  },
  parseAction(value) {
    if (!isRecord(value) || value.type !== "direction") return null;
    const direction = parseDirection(value.direction);
    return direction ? { type: "direction", direction } : null;
  },
  applyAction(state, seat, action) {
    if (state.winner) return { ok: false, error: "Game already finished" };
    const index = state.players.findIndex((player) => player.seat === seat);
    const player = state.players[index];
    if (index < 0 || !player) return { ok: false, error: "Not in this game" };
    if (!player.alive) return { ok: false, error: "Snake has crashed" };
    const queuedDirection = nextSnakeDirection(
      player.direction,
      player.queuedDirection,
      action.direction,
    );
    const players = state.players.map((entry, playerIndex) =>
      playerIndex === index ? { ...entry, queuedDirection } : entry,
    );
    return { ok: true, state: { ...state, players } };
  },
  tick(state) {
    if (state.winner || state.players.length < 2) return null;

    const proposals = new Map<MultiplayerSeat, SnakeMoveProposal>();
    const headCounts = new Map<string, number>();
    for (const player of state.players) {
      if (!player.alive) continue;
      const head = player.snake[0];
      if (!head) continue;
      const direction = player.queuedDirection;
      const moved = moveSnakePoint(head, direction);
      const proposal = {
        seat: player.seat,
        direction,
        next: moved,
        ate: snakePointsEqual(moved, state.food),
        outOfBounds: snakeOutOfBounds(moved, state.size),
      } satisfies SnakeMoveProposal;
      proposals.set(player.seat, proposal);
      const key = snakePointKey(moved);
      headCounts.set(key, (headCounts.get(key) ?? 0) + 1);
    }

    const occupied = new Set<string>();
    for (const player of state.players) {
      const proposal = proposals.get(player.seat);
      const body =
        player.alive && proposal && !proposal.ate ? player.snake.slice(0, -1) : player.snake;
      body.forEach((point) => occupied.add(snakePointKey(point)));
    }

    const crashed = new Set<MultiplayerSeat>();
    for (const proposal of proposals.values()) {
      const key = snakePointKey(proposal.next);
      if (proposal.outOfBounds || (headCounts.get(key) ?? 0) > 1 || occupied.has(key)) {
        crashed.add(proposal.seat);
      }
    }

    let ateFood = false;
    const players = state.players.map((player) => {
      const proposal = proposals.get(player.seat);
      if (!player.alive || !proposal) return player;
      if (crashed.has(player.seat)) {
        return {
          ...player,
          direction: proposal.direction,
          queuedDirection: proposal.direction,
          alive: false,
        };
      }

      const snake = [proposal.next, ...player.snake];
      if (proposal.ate) {
        ateFood = true;
        return {
          ...player,
          snake,
          direction: proposal.direction,
          queuedDirection: proposal.direction,
          score: player.score + 1,
        };
      }
      snake.pop();
      return {
        ...player,
        snake,
        direction: proposal.direction,
        queuedDirection: proposal.direction,
      };
    });

    const alive = players.filter((player) => player.alive);
    const onlySurvivor = alive[0]?.seat;
    const winner: MultiplayerSeat | "draw" | null =
      alive.length === 0 ? "draw" : alive.length === 1 && onlySurvivor ? onlySurvivor : null;
    const food =
      ateFood && !winner
        ? randomSnakeFood(
            state.size,
            players.flatMap((player) => player.snake),
          )
        : state.food;
    const nextState = { ...state, players, food, winner, tick: state.tick + 1 };
    return winner
      ? { ok: true, state: nextState, finished: { winner } }
      : { ok: true, state: nextState };
  },
  publicSnapshot: (state) => ({ ...state }),
};

const adapters = new Map<string, MultiplayerAdapter>(
  [ticTacToeMultiplayerAdapter, connect4MultiplayerAdapter, snakeMultiplayerAdapter].map(
    (adapter) => [adapter.gameId, adapter],
  ),
);

export function multiplayerAdapterForGame(gameId: string): MultiplayerAdapter | null {
  return adapters.get(gameId) ?? null;
}

export function supportedMultiplayerGameIds(): string[] {
  return [...adapters.keys()];
}

export function oppositeSeat(seat: MultiplayerSeat): MultiplayerSeat {
  return oppositeMultiplayerSeat(seat);
}

function newSnakeOnlinePlayer(size: number, seat: MultiplayerSeat): SnakeOnlinePlayer {
  const direction = snakeStartDirections[seat];
  return {
    seat,
    snake: startSnakeBodyForSeat(size, seat),
    direction,
    queuedDirection: direction,
    alive: true,
    score: 0,
  };
}

function startSnakeBodyForSeat(size: number, seat: MultiplayerSeat): SnakePoint[] {
  const oneThird = Math.floor(size / 3);
  const twoThird = Math.floor((size * 2) / 3);
  if (seat === "p1") {
    return [
      { row: oneThird, column: 3 },
      { row: oneThird, column: 2 },
      { row: oneThird, column: 1 },
    ];
  }
  if (seat === "p2") {
    return [
      { row: twoThird, column: size - 4 },
      { row: twoThird, column: size - 3 },
      { row: twoThird, column: size - 2 },
    ];
  }
  if (seat === "p3") {
    return [
      { row: 3, column: twoThird },
      { row: 2, column: twoThird },
      { row: 1, column: twoThird },
    ];
  }
  return [
    { row: size - 4, column: oneThird },
    { row: size - 3, column: oneThird },
    { row: size - 2, column: oneThird },
  ];
}

function parseIntegerInRange(value: unknown, min: number, maxExclusive: number): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return value >= min && value < maxExclusive ? value : null;
}

function parseDirection(value: unknown): Direction | null {
  return parseOneOf(value, ["up", "right", "down", "left"] as const);
}
