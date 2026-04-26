import type { Direction } from "@shared/types";

export type FroggerPoint = { row: number; column: number };
export type FroggerLaneKind = "goal" | "safe" | "road" | "water";
export type FroggerObjectKind = "car" | "truck" | "log" | "turtle";

export type FroggerLaneObject = {
  id: number;
  kind: FroggerObjectKind;
  x: number;
  length: number;
  speed: number;
};

export type FroggerLane = {
  row: number;
  kind: FroggerLaneKind;
  objects: FroggerLaneObject[];
};

export type FroggerLaneProfile = {
  row: number;
  kind: FroggerLaneKind;
  objectKind?: FroggerObjectKind;
  length?: number;
  speed?: number;
  offsets?: readonly number[];
};

export type FroggerConfig = {
  lives: number;
  timeLimitTicks: number;
  speedMultiplier: number;
  levelSpeedGrowth: number;
  maxLevel: number;
  laneProfiles: readonly FroggerLaneProfile[];
};

export type FroggerState = {
  columns: number;
  rows: number;
  frog: FroggerPoint;
  lanes: FroggerLane[];
  homes: boolean[];
  score: number;
  lives: number;
  level: number;
  ticksRemaining: number;
  reachedRow: number;
  tick: number;
  won: boolean;
  lost: boolean;
};

export const froggerColumns = 13;
export const froggerRows = 13;
export const froggerStart: FroggerPoint = { row: 12, column: 6 };
export const froggerHomeColumns = [1, 3, 6, 9, 11] as const;
export const froggerRowScore = 10;
export const froggerHomeScore = 50;
export const froggerTimeScoreMultiplier = 2;
export const froggerLevelScore = 1_000;
export const froggerWinScore = 2_500;

export const baseFroggerLaneProfiles = [
  { row: 0, kind: "goal" },
  { row: 1, kind: "water", objectKind: "log", length: 2.6, speed: -0.12, offsets: [0, 4.7, 9.4] },
  {
    row: 2,
    kind: "water",
    objectKind: "turtle",
    length: 1.8,
    speed: 0.14,
    offsets: [-1, 2.4, 5.8, 9.2],
  },
  { row: 3, kind: "water", objectKind: "log", length: 3.1, speed: 0.1, offsets: [0.4, 5.6, 10.8] },
  {
    row: 4,
    kind: "water",
    objectKind: "turtle",
    length: 2.1,
    speed: -0.16,
    offsets: [1.3, 5.3, 9.3],
  },
  {
    row: 5,
    kind: "water",
    objectKind: "log",
    length: 2.8,
    speed: 0.18,
    offsets: [-0.8, 4.8, 10.4],
  },
  { row: 6, kind: "safe" },
  { row: 7, kind: "road", objectKind: "car", length: 1.2, speed: -0.2, offsets: [1.2, 5.2, 9.2] },
  { row: 8, kind: "road", objectKind: "truck", length: 2.1, speed: 0.16, offsets: [-1.4, 3.8, 9] },
  { row: 9, kind: "road", objectKind: "car", length: 1.2, speed: 0.24, offsets: [0.6, 4.6, 8.6] },
  {
    row: 10,
    kind: "road",
    objectKind: "truck",
    length: 2.4,
    speed: -0.14,
    offsets: [1.4, 6.6, 11.8],
  },
  { row: 11, kind: "road", objectKind: "car", length: 1.2, speed: 0.18, offsets: [2.4, 6.4, 10.4] },
  { row: 12, kind: "safe" },
] as const satisfies readonly FroggerLaneProfile[];

export function newFroggerState(config: FroggerConfig, level = 1): FroggerState {
  const normalizedLevel = Math.max(1, Math.floor(level));
  return {
    columns: froggerColumns,
    rows: froggerRows,
    frog: { ...froggerStart },
    lanes: newFroggerLanes(config, normalizedLevel),
    homes: froggerHomeColumns.map(() => false),
    score: 0,
    lives: config.lives,
    level: normalizedLevel,
    ticksRemaining: config.timeLimitTicks,
    reachedRow: froggerStart.row,
    tick: 0,
    won: false,
    lost: false,
  };
}

export function newFroggerLanes(config: FroggerConfig, level: number): FroggerLane[] {
  const speedScale = config.speedMultiplier + Math.max(0, level - 1) * config.levelSpeedGrowth;
  let id = 1;
  return config.laneProfiles.map((profile) => ({
    row: profile.row,
    kind: profile.kind,
    objects: (profile.offsets ?? []).map((x) => ({
      id: id++,
      kind: profile.objectKind ?? "car",
      x,
      length: profile.length ?? 1,
      speed: (profile.speed ?? 0) * speedScale,
    })),
  }));
}

export function moveFrogger(
  state: FroggerState,
  direction: Direction,
  config: FroggerConfig,
): FroggerState {
  if (state.won || state.lost) return state;
  const frog = nextFroggerPoint(state, direction);
  if (frog.row === state.frog.row && frog.column === state.frog.column) return state;

  let score = state.score;
  let reachedRow = state.reachedRow;
  if (frog.row < reachedRow) {
    score += (reachedRow - frog.row) * froggerRowScore;
    reachedRow = frog.row;
  }

  return resolveFroggerPosition({ ...state, frog, score, reachedRow }, config);
}

export function stepFrogger(state: FroggerState, config: FroggerConfig): FroggerState {
  if (state.won || state.lost) return state;

  const ride = froggerRideAt(state, state.frog);
  if (froggerLaneAt(state, state.frog.row)?.kind === "water" && !ride) {
    return loseFroggerLife(state, config);
  }

  const frog = ride ? { ...state.frog, column: state.frog.column + ride.speed } : state.frog;
  const next = {
    ...state,
    frog,
    lanes: state.lanes.map(stepFroggerLane),
    ticksRemaining: state.ticksRemaining - 1,
    tick: state.tick + 1,
  };

  if (next.ticksRemaining <= 0) return loseFroggerLife(next, config);
  return resolveFroggerPosition(next, config);
}

export function froggerLaneAt(state: FroggerState, row: number): FroggerLane | null {
  return state.lanes.find((lane) => lane.row === row) ?? null;
}

export function froggerHomeIndexForColumn(column: number, tolerance = 0.45): number {
  return froggerHomeColumns.findIndex((homeColumn) => Math.abs(homeColumn - column) <= tolerance);
}

export function froggerObjectCoversColumn(object: FroggerLaneObject, column: number): boolean {
  const center = column + 0.5;
  return center >= object.x && center <= object.x + object.length;
}

export function froggerRideAt(state: FroggerState, point: FroggerPoint): FroggerLaneObject | null {
  const lane = froggerLaneAt(state, point.row);
  if (!lane || lane.kind !== "water") return null;
  return lane.objects.find((object) => froggerObjectCoversColumn(object, point.column)) ?? null;
}

export function froggerHitAt(state: FroggerState, point: FroggerPoint): FroggerLaneObject | null {
  const lane = froggerLaneAt(state, point.row);
  if (!lane || lane.kind !== "road") return null;
  return lane.objects.find((object) => froggerObjectCoversColumn(object, point.column)) ?? null;
}

function nextFroggerPoint(state: FroggerState, direction: Direction): FroggerPoint {
  if (direction === "up") return { ...state.frog, row: Math.max(0, state.frog.row - 1) };
  if (direction === "down")
    return { ...state.frog, row: Math.min(state.rows - 1, state.frog.row + 1) };
  if (direction === "left") return { ...state.frog, column: Math.max(0, state.frog.column - 1) };
  return { ...state.frog, column: Math.min(state.columns - 1, state.frog.column + 1) };
}

function stepFroggerLane(lane: FroggerLane): FroggerLane {
  return { ...lane, objects: lane.objects.map(stepFroggerObject) };
}

function stepFroggerObject(object: FroggerLaneObject): FroggerLaneObject {
  let x = object.x + object.speed;
  while (x >= froggerColumns) x -= froggerColumns + object.length;
  while (x + object.length <= 0) x += froggerColumns + object.length;
  return { ...object, x };
}

function resolveFroggerPosition(state: FroggerState, config: FroggerConfig): FroggerState {
  if (
    state.frog.row < 0 ||
    state.frog.row >= state.rows ||
    state.frog.column < 0 ||
    state.frog.column > state.columns - 1
  ) {
    return loseFroggerLife(state, config);
  }

  const lane = froggerLaneAt(state, state.frog.row);
  if (!lane) return loseFroggerLife(state, config);
  if (lane.kind === "goal") return settleFroggerHome(state, config);
  if (lane.kind === "road" && froggerHitAt(state, state.frog))
    return loseFroggerLife(state, config);
  if (lane.kind === "water" && !froggerRideAt(state, state.frog))
    return loseFroggerLife(state, config);
  return state;
}

function settleFroggerHome(state: FroggerState, config: FroggerConfig): FroggerState {
  const homeIndex = froggerHomeIndexForColumn(state.frog.column);
  if (homeIndex < 0 || state.homes[homeIndex]) return loseFroggerLife(state, config);

  const homes = state.homes.map((home, index) => (index === homeIndex ? true : home));
  const score = state.score + froggerHomeScore + state.ticksRemaining * froggerTimeScoreMultiplier;
  const settled = {
    ...state,
    frog: { ...froggerStart },
    homes,
    score,
    ticksRemaining: config.timeLimitTicks,
    reachedRow: froggerStart.row,
  };
  return homes.every(Boolean) ? completeFroggerLevel(settled, config) : settled;
}

function completeFroggerLevel(state: FroggerState, config: FroggerConfig): FroggerState {
  const score = state.score + state.level * froggerLevelScore;
  if (state.level >= config.maxLevel) {
    return { ...state, score: score + froggerWinScore, won: true };
  }

  const level = state.level + 1;
  return {
    ...state,
    frog: { ...froggerStart },
    lanes: newFroggerLanes(config, level),
    homes: froggerHomeColumns.map(() => false),
    score,
    level,
    ticksRemaining: config.timeLimitTicks,
    reachedRow: froggerStart.row,
  };
}

function loseFroggerLife(state: FroggerState, config: FroggerConfig): FroggerState {
  const lives = state.lives - 1;
  return {
    ...state,
    frog: { ...froggerStart },
    lives,
    ticksRemaining: config.timeLimitTicks,
    reachedRow: froggerStart.row,
    lost: lives <= 0,
  };
}
