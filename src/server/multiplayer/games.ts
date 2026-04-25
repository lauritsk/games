import * as v from "valibot";
import {
  finiteNumberSchema,
  integerRangeSchema,
  parseWithSchema,
  picklistSchema,
} from "@shared/validation";
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
} from "@games/connect4/logic";
import {
  allMemoryMatched,
  memoryConfigs,
  newMemoryDeck,
  openUnmatchedMemoryCards,
  type MemoryCard,
} from "@games/memory/logic";
import {
  aimInvaderPlayer,
  fireInvaderPlayerShot,
  invaderConfigs,
  newInvaderPlayers,
  newInvaderState,
  nextInvaderWave,
  scaleInvaderConfigForPlayers,
  stepInvadersWithPlayerInputs,
  type InvaderState,
} from "@games/space-invaders/logic";
import {
  moveSnakePoint,
  nextSnakeDirection,
  randomSnakeFood,
  snakeOutOfBounds,
  snakePointKey,
  snakePointsEqual,
  wrapSnakePoint,
  type SnakePoint,
} from "@games/snake/logic";
import {
  getTicTacToeWinner,
  newTicTacToeBoard,
  humanMark,
  botMark,
  ticTacToeSize,
  type Mark,
  type TicTacToeCell,
} from "@games/tictactoe/logic";
import {
  oppositeMultiplayerSeat,
  type MultiplayerSeat,
} from "@features/multiplayer/multiplayer-protocol";
import type { Difficulty, Direction } from "@shared/types";

export type MultiplayerFinish = { winner: MultiplayerSeat | "draw" };

export type MultiplayerApplyResult<TState> =
  | { ok: true; state: TState; finished?: MultiplayerFinish }
  | { ok: false; error: string };

export type MultiplayerAdapter<TState = unknown, TAction = unknown, TSettings = unknown> = {
  gameId: string;
  minPlayers?: number;
  maxPlayers?: number;
  autoStart?: boolean;
  tickMs?: number;
  tickIntervalMs?(state: TState): number;
  acceptStaleActions?: boolean;
  defaultSettings?(): TSettings;
  parseSettings?(value: unknown): TSettings | null;
  newState(settings?: TSettings): TState;
  start?(
    state: TState,
    seats: readonly MultiplayerSeat[],
    settings?: TSettings,
  ): MultiplayerApplyResult<TState>;
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
const difficultySchema = picklistSchema(["Easy", "Medium", "Hard"] as const);
const directionSchema = picklistSchema(["up", "right", "down", "left"] as const);
const wallModeSchema = picklistSchema(["fatal", "teleport"] as const);
const invaderMoveSchema = picklistSchema([-1, 0, 1] as const);
const invaderMoveStepSchema = picklistSchema([-1, 1] as const);
const ticTacToeActionSchema = v.object({
  type: v.literal("place"),
  index: integerRangeSchema(0, ticTacToeCellCount),
});
const connect4ActionSchema = v.object({
  type: v.literal("drop"),
  column: integerRangeSchema(0, connect4Columns),
});
const snakeActionSchema = v.object({ type: v.literal("direction"), direction: directionSchema });
const snakeOnlineSettingsSchema = v.object({
  difficulty: difficultySchema,
  wallMode: wallModeSchema,
});
const memoryActionSchema = v.object({
  type: v.literal("flip"),
  index: integerRangeSchema(0, memoryConfigs.Hard.pairs * 2),
});
const memoryOnlineSettingsSchema = v.object({ difficulty: difficultySchema });
const spaceInvadersOnlineSettingsSchema = v.object({ difficulty: difficultySchema });
const spaceInvadersActionSchema = v.variant("type", [
  v.object({ type: v.literal("fire") }),
  v.object({ type: v.literal("move"), move: invaderMoveSchema }),
  v.object({ type: v.literal("step"), move: invaderMoveStepSchema }),
  v.object({ type: v.literal("aim"), x: finiteNumberSchema }),
]);
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
    return parseWithSchema(ticTacToeActionSchema, value);
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
    return parseWithSchema(connect4ActionSchema, value);
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

type SnakeWallMode = "fatal" | "teleport";

type SnakeOnlineSettings = {
  difficulty: Difficulty;
  wallMode: SnakeWallMode;
};

type SnakeOnlineConfig = {
  size: number;
  speed: number;
};

type SnakeOnlineState = {
  difficulty: Difficulty;
  wallMode: SnakeWallMode;
  speed: number;
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

const snakeOnlineConfigs: Record<Difficulty, SnakeOnlineConfig> = {
  Easy: { size: 14, speed: 170 },
  Medium: { size: 18, speed: 115 },
  Hard: { size: 22, speed: 75 },
};
const defaultSnakeOnlineSettings = {
  difficulty: "Medium",
  wallMode: "fatal",
} satisfies SnakeOnlineSettings;
const snakeStartDirections = {
  p1: "right",
  p2: "left",
  p3: "down",
  p4: "up",
} satisfies Record<MultiplayerSeat, Direction>;

export const snakeMultiplayerAdapter: MultiplayerAdapter<
  SnakeOnlineState,
  SnakeAction,
  SnakeOnlineSettings
> = {
  gameId: "snake",
  minPlayers: 2,
  maxPlayers: 4,
  autoStart: false,
  tickIntervalMs: (state) => state.speed,
  acceptStaleActions: true,
  defaultSettings: () => ({ ...defaultSnakeOnlineSettings }),
  parseSettings: parseSnakeOnlineSettings,
  newState: newSnakeOnlineState,
  start(_state, seats, settings = defaultSnakeOnlineSettings) {
    return {
      ok: true,
      state: startSnakeOnlineState(seats, settings),
    };
  },
  parseAction(value) {
    return parseWithSchema(snakeActionSchema, value);
  },
  applyAction(state, seat, action) {
    return queueSnakeOnlineDirection(state, seat, action.direction);
  },
  tick: tickSnakeOnlineState,
  publicSnapshot: (state) => ({ ...state }),
};

function newSnakeOnlineState(
  settings: SnakeOnlineSettings = defaultSnakeOnlineSettings,
): SnakeOnlineState {
  const config = snakeOnlineConfigs[settings.difficulty];
  return {
    difficulty: settings.difficulty,
    wallMode: settings.wallMode,
    speed: config.speed,
    size: config.size,
    food: { row: 0, column: 0 },
    players: [],
    winner: null,
    tick: 0,
    startedAt: null,
  };
}

function startSnakeOnlineState(
  seats: readonly MultiplayerSeat[],
  settings: SnakeOnlineSettings,
): SnakeOnlineState {
  const config = snakeOnlineConfigs[settings.difficulty];
  const players = seats.map((seat) => newSnakeOnlinePlayer(config.size, seat));
  return {
    difficulty: settings.difficulty,
    wallMode: settings.wallMode,
    speed: config.speed,
    size: config.size,
    food: randomSnakeFood(
      config.size,
      players.flatMap((player) => player.snake),
    ),
    players,
    winner: null,
    tick: 0,
    startedAt: Date.now(),
  };
}

function queueSnakeOnlineDirection(
  state: SnakeOnlineState,
  seat: MultiplayerSeat,
  direction: Direction,
): MultiplayerApplyResult<SnakeOnlineState> {
  if (state.winner) return { ok: false, error: "Game already finished" };
  const index = state.players.findIndex((player) => player.seat === seat);
  const player = state.players[index];
  if (index < 0 || !player) return { ok: false, error: "Not in this game" };
  if (!player.alive) return { ok: false, error: "Snake has crashed" };
  const queuedDirection = nextSnakeDirection(player.direction, player.queuedDirection, direction);
  const players = state.players.map((entry, playerIndex) =>
    playerIndex === index ? { ...entry, queuedDirection } : entry,
  );
  return { ok: true, state: { ...state, players } };
}

function tickSnakeOnlineState(
  state: SnakeOnlineState,
): MultiplayerApplyResult<SnakeOnlineState> | null {
  if (state.winner || state.players.length < 2) return null;

  const proposals = snakeMoveProposals(state);
  const crashed = crashedSnakeSeats(state, proposals);
  const { players, ateFood } = applySnakeMoveProposals(state.players, proposals, crashed);
  const winner = snakeOnlineWinner(players);
  const food = nextSnakeOnlineFood(state, players, ateFood, winner);
  const nextState = { ...state, players, food, winner, tick: state.tick + 1 };
  return winner
    ? { ok: true, state: nextState, finished: { winner } }
    : { ok: true, state: nextState };
}

function snakeMoveProposals(state: SnakeOnlineState): Map<MultiplayerSeat, SnakeMoveProposal> {
  const proposals = new Map<MultiplayerSeat, SnakeMoveProposal>();
  for (const player of state.players) {
    if (!player.alive) continue;
    const head = player.snake[0];
    if (!head) continue;
    const direction = player.queuedDirection;
    const moved = moveSnakePoint(head, direction);
    const outOfBounds = snakeOutOfBounds(moved, state.size);
    const next = state.wallMode === "teleport" ? wrapSnakePoint(moved, state.size) : moved;
    proposals.set(player.seat, {
      seat: player.seat,
      direction,
      next,
      ate: snakePointsEqual(next, state.food),
      outOfBounds,
    });
  }
  return proposals;
}

function crashedSnakeSeats(
  state: SnakeOnlineState,
  proposals: ReadonlyMap<MultiplayerSeat, SnakeMoveProposal>,
): Set<MultiplayerSeat> {
  const headCounts = snakeHeadCounts(proposals.values());
  const occupied = occupiedSnakeCells(state.players, proposals);
  const crashed = new Set<MultiplayerSeat>();
  for (const proposal of proposals.values()) {
    const key = snakePointKey(proposal.next);
    if (
      (proposal.outOfBounds && state.wallMode === "fatal") ||
      (headCounts.get(key) ?? 0) > 1 ||
      occupied.has(key)
    ) {
      crashed.add(proposal.seat);
    }
  }
  return crashed;
}

function snakeHeadCounts(proposals: Iterable<SnakeMoveProposal>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const proposal of proposals) {
    const key = snakePointKey(proposal.next);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function occupiedSnakeCells(
  players: readonly SnakeOnlinePlayer[],
  proposals: ReadonlyMap<MultiplayerSeat, SnakeMoveProposal>,
): Set<string> {
  const occupied = new Set<string>();
  for (const player of players) {
    const proposal = proposals.get(player.seat);
    const body =
      player.alive && proposal && !proposal.ate ? player.snake.slice(0, -1) : player.snake;
    body.forEach((point) => occupied.add(snakePointKey(point)));
  }
  return occupied;
}

function applySnakeMoveProposals(
  players: readonly SnakeOnlinePlayer[],
  proposals: ReadonlyMap<MultiplayerSeat, SnakeMoveProposal>,
  crashed: ReadonlySet<MultiplayerSeat>,
): { players: SnakeOnlinePlayer[]; ateFood: boolean } {
  let ateFood = false;
  const nextPlayers = players.map((player) => {
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
  return { players: nextPlayers, ateFood };
}

function snakeOnlineWinner(players: readonly SnakeOnlinePlayer[]): MultiplayerSeat | "draw" | null {
  const alive = players.filter((player) => player.alive);
  const onlySurvivor = alive[0]?.seat;
  if (alive.length === 0) return "draw";
  return alive.length === 1 && onlySurvivor ? onlySurvivor : null;
}

function nextSnakeOnlineFood(
  state: SnakeOnlineState,
  players: readonly SnakeOnlinePlayer[],
  ateFood: boolean,
  winner: MultiplayerSeat | "draw" | null,
): SnakePoint {
  if (!ateFood || winner) return state.food;
  return randomSnakeFood(
    state.size,
    players.flatMap((player) => player.snake),
  );
}

type MemoryOnlineSettings = {
  difficulty: Difficulty;
};

type MemoryOnlineState = {
  difficulty: Difficulty;
  cards: MemoryCard[];
  current: MultiplayerSeat;
  scores: Record<MultiplayerSeat, number>;
  moves: number;
  winner: MultiplayerSeat | "draw" | null;
  pendingCloseAt: number | null;
};

type MemoryAction = { type: "flip"; index: number };

const memoryMismatchDelayMs = 650;
const defaultMemoryOnlineSettings = { difficulty: "Medium" } satisfies MemoryOnlineSettings;

export const memoryMultiplayerAdapter: MultiplayerAdapter<
  MemoryOnlineState,
  MemoryAction,
  MemoryOnlineSettings
> = {
  gameId: "memory",
  maxPlayers: 2,
  tickMs: 100,
  defaultSettings: () => ({ ...defaultMemoryOnlineSettings }),
  parseSettings: parseMemoryOnlineSettings,
  newState: (settings = defaultMemoryOnlineSettings) => newMemoryOnlineState(settings),
  parseAction(value) {
    return parseWithSchema(memoryActionSchema, value);
  },
  applyAction(state, seat, action) {
    if (state.winner) return { ok: false, error: "Game already finished" };
    if (state.pendingCloseAt !== null) return { ok: false, error: "Cards are settling" };
    if (state.current !== seat) return { ok: false, error: "Not your turn" };
    const card = state.cards[action.index];
    if (!card || card.open || card.matched) return { ok: false, error: "Invalid move" };

    const cards = state.cards.map((entry, index) =>
      index === action.index ? { ...entry, open: true } : { ...entry },
    );
    const open = openUnmatchedMemoryCards(cards);
    if (open.length < 2) return { ok: true, state: { ...state, cards } };

    const [a, b] = open;
    if (!a || !b) return { ok: false, error: "Invalid move" };
    const moves = state.moves + 1;
    if (a.symbol !== b.symbol) {
      return {
        ok: true,
        state: { ...state, cards, moves, pendingCloseAt: Date.now() + memoryMismatchDelayMs },
      };
    }

    const matchedCards = cards.map((entry) =>
      entry.open && !entry.matched ? { ...entry, open: false, matched: true } : entry,
    );
    const scores = { ...state.scores, [seat]: state.scores[seat] + 1 };
    const winner = allMemoryMatched(matchedCards) ? memoryWinner(scores) : null;
    return {
      ok: true,
      state: { ...state, cards: matchedCards, scores, moves, winner },
      ...(winner ? { finished: { winner } } : {}),
    };
  },
  tick(state) {
    if (state.winner || state.pendingCloseAt === null || Date.now() < state.pendingCloseAt) {
      return null;
    }
    const cards = state.cards.map((card) =>
      card.open && !card.matched ? { ...card, open: false } : card,
    );
    return {
      ok: true,
      state: {
        ...state,
        cards,
        current: oppositeMultiplayerSeat(state.current),
        pendingCloseAt: null,
      },
    };
  },
  publicSnapshot: (state) => ({ ...state }),
};

type SpaceInvadersOnlineSettings = {
  difficulty: Difficulty;
};

type SpaceInvadersOnlineState = InvaderState & {
  difficulty: Difficulty;
  moveControls: Record<MultiplayerSeat, -1 | 0 | 1>;
};

type SpaceInvadersAction =
  | { type: "move"; move: -1 | 0 | 1 }
  | { type: "step"; move: -1 | 1 }
  | { type: "fire" }
  | { type: "aim"; x: number };

const defaultSpaceInvadersOnlineSettings = {
  difficulty: "Medium",
} satisfies SpaceInvadersOnlineSettings;

export const spaceInvadersMultiplayerAdapter: MultiplayerAdapter<
  SpaceInvadersOnlineState,
  SpaceInvadersAction,
  SpaceInvadersOnlineSettings
> = {
  gameId: "space-invaders",
  minPlayers: 2,
  maxPlayers: 2,
  tickMs: 31,
  acceptStaleActions: true,
  defaultSettings: () => ({ ...defaultSpaceInvadersOnlineSettings }),
  parseSettings: parseSpaceInvadersOnlineSettings,
  newState: (settings = defaultSpaceInvadersOnlineSettings) =>
    newSpaceInvadersOnlineState(settings),
  start(_state, seats, settings = defaultSpaceInvadersOnlineSettings) {
    if (seats.length < 2) return { ok: false, error: "Need two players" };
    return { ok: true, state: newSpaceInvadersOnlineState(settings) };
  },
  parseAction(value) {
    return parseWithSchema(spaceInvadersActionSchema, value);
  },
  applyAction(state, seat, action) {
    if (state.lost) return { ok: false, error: "Game already finished" };
    const playerId = invaderPlayerIdForSeat(seat);
    if (!playerId) return { ok: false, error: "Not in this game" };
    if (action.type === "move") {
      return {
        ok: true,
        state: { ...state, moveControls: { ...state.moveControls, [seat]: action.move } },
      };
    }
    if (action.type === "step") {
      const config = spaceInvadersOnlineConfig(state.difficulty);
      const moved = stepInvadersWithPlayerInputs(state, config, [
        { playerId, move: action.move },
      ]) as SpaceInvadersOnlineState;
      const nextState = {
        ...moved,
        difficulty: state.difficulty,
        moveControls: state.moveControls,
      };
      return nextState.lost
        ? { ok: true, state: nextState, finished: { winner: "draw" } }
        : { ok: true, state: nextState };
    }
    if (action.type === "aim") {
      return {
        ok: true,
        state: aimInvaderPlayer(state, playerId, action.x) as SpaceInvadersOnlineState,
      };
    }
    return {
      ok: true,
      state: fireInvaderPlayerShot(state, playerId) as SpaceInvadersOnlineState,
    };
  },
  tick(state) {
    if (state.lost) return null;
    const config = spaceInvadersOnlineConfig(state.difficulty);
    const ticked = stepInvadersWithPlayerInputs(state, config, [
      { playerId: "p1", move: state.moveControls.p1 },
      { playerId: "p2", move: state.moveControls.p2 },
    ]);
    const next = ticked.won ? nextInvaderWave(ticked, config) : ticked;
    const nextState = {
      ...next,
      difficulty: state.difficulty,
      moveControls: state.moveControls,
    } satisfies SpaceInvadersOnlineState;
    return nextState.lost
      ? { ok: true, state: nextState, finished: { winner: "draw" } }
      : { ok: true, state: nextState };
  },
  publicSnapshot: (state) => {
    const { moveControls: _moveControls, ...snapshot } = state;
    return snapshot;
  },
};

const adapters = new Map<string, MultiplayerAdapter>(
  [
    ticTacToeMultiplayerAdapter,
    connect4MultiplayerAdapter,
    snakeMultiplayerAdapter,
    memoryMultiplayerAdapter,
    spaceInvadersMultiplayerAdapter,
  ].map((adapter) => [adapter.gameId, adapter]),
);

export function multiplayerAdapterForGame(gameId: string): MultiplayerAdapter | null {
  return adapters.get(gameId) ?? null;
}

function newMemoryOnlineState(settings: MemoryOnlineSettings): MemoryOnlineState {
  const config = memoryConfigs[settings.difficulty];
  return {
    difficulty: settings.difficulty,
    cards: newMemoryDeck(config.pairs),
    current: "p1",
    scores: { p1: 0, p2: 0, p3: 0, p4: 0 },
    moves: 0,
    winner: null,
    pendingCloseAt: null,
  };
}

function memoryWinner(scores: Record<MultiplayerSeat, number>): MultiplayerSeat | "draw" {
  if (scores.p1 === scores.p2) return "draw";
  return scores.p1 > scores.p2 ? "p1" : "p2";
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

function parseSnakeOnlineSettings(value: unknown): SnakeOnlineSettings | null {
  return parseWithSchema(snakeOnlineSettingsSchema, value);
}

function parseMemoryOnlineSettings(value: unknown): MemoryOnlineSettings | null {
  return parseWithSchema(memoryOnlineSettingsSchema, value);
}

function parseSpaceInvadersOnlineSettings(value: unknown): SpaceInvadersOnlineSettings | null {
  return parseWithSchema(spaceInvadersOnlineSettingsSchema, value);
}

function newSpaceInvadersOnlineState(
  settings: SpaceInvadersOnlineSettings,
): SpaceInvadersOnlineState {
  return {
    ...newInvaderState(spaceInvadersOnlineConfig(settings.difficulty), 1, newInvaderPlayers(2)),
    difficulty: settings.difficulty,
    moveControls: { p1: 0, p2: 0, p3: 0, p4: 0 },
  };
}

function spaceInvadersOnlineConfig(difficulty: Difficulty) {
  return scaleInvaderConfigForPlayers(invaderConfigs[difficulty], 2);
}

function invaderPlayerIdForSeat(seat: MultiplayerSeat): "p1" | "p2" | null {
  if (seat === "p1" || seat === "p2") return seat;
  return null;
}
