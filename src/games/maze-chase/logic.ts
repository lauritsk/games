import type { Direction } from "@shared/types";

export type MazeChaseCell = "wall" | "empty" | "dot" | "power";
export type MazeChasePoint = { row: number; column: number };
export type MazeChaseGhost = {
  id: number;
  start: MazeChasePoint;
  position: MazeChasePoint;
  direction: Direction;
};

export type MazeChaseConfig = {
  lives: number;
  powerTicks: number;
  ghostMoveInterval: number;
  dotScore: number;
  powerScore: number;
  ghostScore: number;
  levelScore: number;
  maxLevel: number;
};

export type MazeChaseState = {
  columns: number;
  rows: number;
  cells: MazeChaseCell[];
  player: MazeChasePoint;
  direction: Direction | null;
  queuedDirection: Direction | null;
  ghosts: MazeChaseGhost[];
  score: number;
  lives: number;
  level: number;
  tick: number;
  powerTicks: number;
  dotsRemaining: number;
  won: boolean;
  lost: boolean;
};

export const mazeChaseRows = 15;
export const mazeChaseColumns = 15;
export const mazeChasePlayerStart: MazeChasePoint = { row: 11, column: 7 };
export const mazeChaseGhostStarts = [
  { row: 7, column: 7 },
  { row: 7, column: 6 },
  { row: 7, column: 8 },
] as const satisfies readonly MazeChasePoint[];

const mazeTemplate = [
  "###############",
  "#o.....#.....o#",
  "#.###.#.#.###.#",
  "#.............#",
  "#.###.###.###.#",
  "#.....#.#.....#",
  "###.#.....#.###",
  "#.....# #.....#",
  "###.#.....#.###",
  "#.....#.#.....#",
  "#.###.###.###.#",
  "#.............#",
  "#.###.#.#.###.#",
  "#o.....#.....o#",
  "###############",
] as const;

export function newMazeChaseState(config: MazeChaseConfig, level = 1): MazeChaseState {
  const normalizedLevel = Math.max(1, Math.floor(level));
  const cells = mazeTemplate.flatMap((row, rowIndex) =>
    [...row].map((value, columnIndex) =>
      cellFromTemplate(value, { row: rowIndex, column: columnIndex }),
    ),
  );

  return {
    columns: mazeChaseColumns,
    rows: mazeChaseRows,
    cells,
    player: { ...mazeChasePlayerStart },
    direction: null,
    queuedDirection: null,
    ghosts: mazeChaseGhostStarts.map((start, index) => ({
      id: index + 1,
      start: { ...start },
      position: { ...start },
      direction: index % 2 === 0 ? "left" : "right",
    })),
    score: 0,
    lives: config.lives,
    level: normalizedLevel,
    tick: 0,
    powerTicks: 0,
    dotsRemaining: cells.filter((cell) => cell === "dot" || cell === "power").length,
    won: false,
    lost: false,
  };
}

export function queueMazeChaseDirection(
  state: MazeChaseState,
  direction: Direction,
): MazeChaseState {
  if (state.won || state.lost) return state;
  return { ...state, queuedDirection: direction };
}

export function stepMazeChase(state: MazeChaseState, config: MazeChaseConfig): MazeChaseState {
  if (state.won || state.lost) return state;

  const tick = state.tick + 1;
  let next = { ...state, tick };
  next = movePlayer(next, config);
  next = resolveCollisions(next, config);
  if (next.won || next.lost || next.lives < state.lives) return next;

  const shouldMoveGhosts = tick % Math.max(1, Math.floor(config.ghostMoveInterval)) === 0;
  if (shouldMoveGhosts) next = moveGhosts(next);
  next = { ...next, powerTicks: Math.max(0, next.powerTicks - 1) };
  return resolveCollisions(next, config);
}

export function mazeChaseCellAt(state: MazeChaseState, point: MazeChasePoint): MazeChaseCell {
  if (!mazeChaseInBounds(state, point)) return "wall";
  return state.cells[mazeChaseCellIndex(state, point)] ?? "wall";
}

export function mazeChaseCanMove(state: MazeChaseState, point: MazeChasePoint): boolean {
  return mazeChaseCellAt(state, point) !== "wall";
}

export function mazeChaseCellIndex(state: MazeChaseState, point: MazeChasePoint): number {
  return point.row * state.columns + point.column;
}

export function mazeChaseInBounds(state: MazeChaseState, point: MazeChasePoint): boolean {
  return (
    point.row >= 0 && point.row < state.rows && point.column >= 0 && point.column < state.columns
  );
}

function cellFromTemplate(value: string, point: MazeChasePoint): MazeChaseCell {
  if (
    pointsEqual(point, mazeChasePlayerStart) ||
    mazeChaseGhostStarts.some((start) => pointsEqual(start, point))
  ) {
    return "empty";
  }
  if (value === "#") return "wall";
  if (value === "o") return "power";
  if (value === ".") return "dot";
  return "empty";
}

function movePlayer(state: MazeChaseState, config: MazeChaseConfig): MazeChaseState {
  const direction = nextPlayerDirection(state);
  if (!direction) return state;

  const player = nextPoint(state.player, direction);
  if (!mazeChaseCanMove(state, player)) return { ...state, direction: null };

  let score = state.score;
  let dotsRemaining = state.dotsRemaining;
  let powerTicks = state.powerTicks;
  const cells = [...state.cells];
  const index = mazeChaseCellIndex(state, player);
  const cell = cells[index];

  if (cell === "dot" || cell === "power") {
    score += cell === "power" ? config.powerScore : config.dotScore;
    dotsRemaining -= 1;
    cells[index] = "empty";
    if (cell === "power") powerTicks = config.powerTicks;
  }

  const moved = {
    ...state,
    player,
    direction,
    queuedDirection: state.queuedDirection === direction ? null : state.queuedDirection,
    cells,
    score,
    dotsRemaining,
    powerTicks,
  };
  return dotsRemaining <= 0 ? completeMazeChaseLevel(moved, config) : moved;
}

function nextPlayerDirection(state: MazeChaseState): Direction | null {
  if (
    state.queuedDirection &&
    mazeChaseCanMove(state, nextPoint(state.player, state.queuedDirection))
  ) {
    return state.queuedDirection;
  }
  if (state.direction && mazeChaseCanMove(state, nextPoint(state.player, state.direction))) {
    return state.direction;
  }
  return null;
}

function moveGhosts(state: MazeChaseState): MazeChaseState {
  return {
    ...state,
    ghosts: state.ghosts.map((ghost) => {
      const direction = chooseGhostDirection(state, ghost);
      return { ...ghost, direction, position: nextPoint(ghost.position, direction) };
    }),
  };
}

function chooseGhostDirection(state: MazeChaseState, ghost: MazeChaseGhost): Direction {
  const options = legalGhostDirections(state, ghost);
  if (options.length === 0) return ghost.direction;
  const target = state.powerTicks > 0 ? ghost.start : state.player;
  const ranked = options.toSorted((a, b) => {
    const distanceA = manhattan(nextPoint(ghost.position, a), target);
    const distanceB = manhattan(nextPoint(ghost.position, b), target);
    return state.powerTicks > 0 ? distanceB - distanceA : distanceA - distanceB;
  });
  return ranked[0] ?? ghost.direction;
}

function legalGhostDirections(state: MazeChaseState, ghost: MazeChaseGhost): Direction[] {
  const all: Direction[] = ["up", "left", "down", "right"];
  const legal = all.filter((direction) =>
    mazeChaseCanMove(state, nextPoint(ghost.position, direction)),
  );
  const forward = legal.filter((direction) => direction !== oppositeDirection(ghost.direction));
  return forward.length > 0 ? forward : legal;
}

function resolveCollisions(state: MazeChaseState, config: MazeChaseConfig): MazeChaseState {
  const hitGhost = state.ghosts.find((ghost) => pointsEqual(ghost.position, state.player));
  if (!hitGhost) return state;
  if (state.powerTicks > 0) {
    return {
      ...state,
      score: state.score + config.ghostScore,
      ghosts: state.ghosts.map((ghost) =>
        ghost.id === hitGhost.id
          ? {
              ...ghost,
              position: { ...ghost.start },
              direction: oppositeDirection(ghost.direction),
            }
          : ghost,
      ),
    };
  }
  return loseMazeChaseLife(state, config);
}

function completeMazeChaseLevel(state: MazeChaseState, config: MazeChaseConfig): MazeChaseState {
  const score = state.score + state.level * config.levelScore;
  if (state.level >= config.maxLevel) return { ...state, score, won: true };
  const next = newMazeChaseState(config, state.level + 1);
  return { ...next, score, lives: state.lives };
}

function loseMazeChaseLife(state: MazeChaseState, config: MazeChaseConfig): MazeChaseState {
  const lives = state.lives - 1;
  return {
    ...state,
    lives,
    lost: lives <= 0,
    player: { ...mazeChasePlayerStart },
    direction: null,
    queuedDirection: null,
    powerTicks: 0,
    ghosts: newMazeChaseState(config, state.level).ghosts,
  };
}

function nextPoint(point: MazeChasePoint, direction: Direction): MazeChasePoint {
  if (direction === "up") return { row: point.row - 1, column: point.column };
  if (direction === "down") return { row: point.row + 1, column: point.column };
  if (direction === "left") return { row: point.row, column: point.column - 1 };
  return { row: point.row, column: point.column + 1 };
}

function oppositeDirection(direction: Direction): Direction {
  if (direction === "up") return "down";
  if (direction === "down") return "up";
  if (direction === "left") return "right";
  return "left";
}

function pointsEqual(a: MazeChasePoint, b: MazeChasePoint): boolean {
  return a.row === b.row && a.column === b.column;
}

function manhattan(a: MazeChasePoint, b: MazeChasePoint): number {
  return Math.abs(a.row - b.row) + Math.abs(a.column - b.column);
}
