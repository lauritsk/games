import {
  circleIntersectsRect,
  clamp,
  type Circle,
  type Rect,
  type Vector,
} from "@games/shared/arcade";
import type { RandomSource } from "@shared/types";

export type BallzPhase = "aiming" | "running" | "lost";
export type BallzRect = Rect;
export type BallzVector = Vector;
export type BallzBall = Circle & { id: number; vx: number; vy: number };
export type BallzBrick = BallzRect & { id: number; hp: number; maxHp: number };
export type BallzPickup = Circle & { id: number };
export type BallzLaunch = { remaining: number; delay: number; vx: number; vy: number } | null;

export type BallzState = {
  width: number;
  height: number;
  launcherX: number;
  launcherY: number;
  balls: BallzBall[];
  bricks: BallzBrick[];
  pickups: BallzPickup[];
  ballCount: number;
  collectedBalls: number;
  round: number;
  score: number;
  phase: BallzPhase;
  launch: BallzLaunch;
  firstSettledX: number | null;
  nextId: number;
  lost: boolean;
};

export type BallzConfig = {
  columns: number;
  startingBalls: number;
  ballSpeed: number;
  launchInterval: number;
  spawnDensity: number;
  pickupChance: number;
  hpScale: number;
  hpVariance: number;
  dangerY: number;
  rowStep: number;
  brickGap: number;
  horizontalMargin: number;
  topMargin: number;
  brickHeight: number;
};

export const ballzWidth = 100;
export const ballzHeight = 100;
export const ballzLauncherY = 94;
export const ballzBallRadius = 1.05;
export const ballzPickupRadius = 1.25;
export const minimumBallzAimUp = 0.28;

export function newBallzState(config: BallzConfig, random: RandomSource = Math.random): BallzState {
  return spawnBallzRow(
    {
      width: ballzWidth,
      height: ballzHeight,
      launcherX: ballzWidth / 2,
      launcherY: ballzLauncherY,
      balls: [],
      bricks: [],
      pickups: [],
      ballCount: config.startingBalls,
      collectedBalls: 0,
      round: 1,
      score: 0,
      phase: "aiming",
      launch: null,
      firstSettledX: null,
      nextId: 1,
      lost: false,
    },
    config,
    random,
  );
}

export function ballzBrickWidth(config: BallzConfig): number {
  return (
    (ballzWidth - config.horizontalMargin * 2 - config.brickGap * (config.columns - 1)) /
    config.columns
  );
}

export function ballzCellCenterX(column: number, config: BallzConfig): number {
  const width = ballzBrickWidth(config);
  return config.horizontalMargin + column * (width + config.brickGap) + width / 2;
}

export function ballzAimVector(from: Vector, to: Vector, speed: number): Vector {
  return clampBallzAim({ x: to.x - from.x, y: to.y - from.y }, speed);
}

export function clampBallzAim(vector: Vector, speed: number): Vector {
  if (!Number.isFinite(vector.x) || !Number.isFinite(vector.y)) return { x: 0, y: -speed };
  if (Math.abs(vector.x) < 0.001 && vector.y >= 0) return { x: 0, y: -speed };

  const length = Math.hypot(vector.x, vector.y);
  if (length <= 0.001) return { x: 0, y: -speed };

  let x = vector.x / length;
  let y = vector.y / length;
  if (y > -minimumBallzAimUp) {
    const sign = x < 0 ? -1 : x > 0 ? 1 : 0;
    if (sign === 0) return { x: 0, y: -speed };
    y = -minimumBallzAimUp;
    x = sign * Math.sqrt(1 - y ** 2);
  }
  return { x: x * speed, y: y * speed };
}

export function rotateBallzAim(vector: Vector, radians: number, speed: number): Vector {
  const current = clampBallzAim(vector, speed);
  const angle = Math.atan2(current.y, current.x);
  const minimumAngle = Math.asin(minimumBallzAimUp);
  const nextAngle = clamp(angle + radians, -Math.PI + minimumAngle, -minimumAngle);
  return { x: Math.cos(nextAngle) * speed, y: Math.sin(nextAngle) * speed };
}

export function launchBallzVolley(state: BallzState, aim: Vector, config: BallzConfig): BallzState {
  if (state.phase !== "aiming" || state.lost) return state;
  const velocity = clampBallzAim(aim, config.ballSpeed);
  return {
    ...state,
    balls: [],
    collectedBalls: 0,
    phase: "running",
    launch: { remaining: state.ballCount, delay: 0, vx: velocity.x, vy: velocity.y },
    firstSettledX: null,
  };
}

export function stepBallz(
  state: BallzState,
  config: BallzConfig,
  random: RandomSource = Math.random,
): BallzState {
  if (state.phase !== "running" || state.lost) return state;

  const launched = launchQueuedBall(state, config);
  let bricks = launched.bricks;
  let pickups = launched.pickups;
  let score = launched.score;
  let collectedBalls = launched.collectedBalls;
  let firstSettledX = launched.firstSettledX;
  const balls: BallzBall[] = [];

  for (const ball of launched.balls) {
    const moved = moveBall(ball, launched, bricks, pickups, score, collectedBalls);
    bricks = moved.bricks;
    pickups = moved.pickups;
    score = moved.score;
    collectedBalls = moved.collectedBalls;
    if (moved.ball) balls.push(moved.ball);
    else if (firstSettledX === null) firstSettledX = moved.settledX;
  }

  const next: BallzState = {
    ...launched,
    balls,
    bricks,
    pickups,
    score,
    collectedBalls,
    firstSettledX,
  };

  if (!next.launch && next.balls.length === 0) return advanceBallzRound(next, config, random);
  return next;
}

export function advanceBallzRound(
  state: BallzState,
  config: BallzConfig,
  random: RandomSource = Math.random,
): BallzState {
  const launcherX = state.firstSettledX ?? state.launcherX;
  const bricks = state.bricks.map((brick) => ({ ...brick, y: brick.y + config.rowStep }));
  const pickups = state.pickups
    .map((pickup) => ({ ...pickup, y: pickup.y + config.rowStep }))
    .filter((pickup) => pickup.y - pickup.radius < state.launcherY);
  const lost = bricks.some((brick) => brick.y + brick.height >= config.dangerY);
  const next: BallzState = {
    ...state,
    launcherX,
    balls: [],
    bricks,
    pickups,
    ballCount: state.ballCount + state.collectedBalls,
    collectedBalls: 0,
    round: state.round + 1,
    phase: lost ? "lost" : "aiming",
    launch: null,
    firstSettledX: null,
    lost,
  };
  return lost ? next : spawnBallzRow(next, config, random);
}

export function spawnBallzRow(
  state: BallzState,
  config: BallzConfig,
  random: RandomSource = Math.random,
): BallzState {
  const width = ballzBrickWidth(config);
  const nextBricks: BallzBrick[] = [];
  let nextId = state.nextId;

  for (let column = 0; column < config.columns; column += 1) {
    if (random() >= config.spawnDensity) continue;
    const hp = ballzBrickHp(state.round, config, random);
    nextBricks.push({
      id: nextId,
      x: config.horizontalMargin + column * (width + config.brickGap),
      y: config.topMargin,
      width,
      height: config.brickHeight,
      hp,
      maxHp: hp,
    });
    nextId += 1;
  }

  if (nextBricks.length === 0) {
    const column = Math.min(config.columns - 1, Math.floor(random() * config.columns));
    const hp = ballzBrickHp(state.round, config, random);
    nextBricks.push({
      id: nextId,
      x: config.horizontalMargin + column * (width + config.brickGap),
      y: config.topMargin,
      width,
      height: config.brickHeight,
      hp,
      maxHp: hp,
    });
    nextId += 1;
  }

  const occupied = new Set(
    nextBricks.map((brick) => ballzColumnForX(brick.x + brick.width / 2, config)),
  );
  const emptyColumns = Array.from({ length: config.columns }, (_, column) => column).filter(
    (column) => !occupied.has(column),
  );
  const pickups = [...state.pickups];
  if (emptyColumns.length > 0 && random() < config.pickupChance) {
    const column =
      emptyColumns[Math.min(emptyColumns.length - 1, Math.floor(random() * emptyColumns.length))]!;
    pickups.push({
      id: nextId,
      x: ballzCellCenterX(column, config),
      y: config.topMargin + config.brickHeight / 2,
      radius: ballzPickupRadius,
    });
    nextId += 1;
  }

  return {
    ...state,
    bricks: [...state.bricks, ...nextBricks],
    pickups,
    nextId,
  };
}

export function ballzBrickHp(
  round: number,
  config: Pick<BallzConfig, "hpScale" | "hpVariance">,
  random: RandomSource = Math.random,
): number {
  const base = Math.max(1, Math.floor(round * config.hpScale));
  const variance = Math.max(0, Math.floor(config.hpVariance));
  return base + Math.floor(random() * (variance + 1));
}

function launchQueuedBall(state: BallzState, config: BallzConfig): BallzState {
  const launch = state.launch;
  if (!launch) return state;
  if (launch.delay > 0) return { ...state, launch: { ...launch, delay: launch.delay - 1 } };

  const balls = [
    ...state.balls,
    {
      id: state.nextId,
      x: state.launcherX,
      y: state.launcherY,
      vx: launch.vx,
      vy: launch.vy,
      radius: ballzBallRadius,
    },
  ];
  const remaining = launch.remaining - 1;
  return {
    ...state,
    balls,
    nextId: state.nextId + 1,
    launch: remaining > 0 ? { ...launch, remaining, delay: config.launchInterval } : null,
  };
}

type MoveBallResult = {
  ball: BallzBall | null;
  settledX: number;
  bricks: BallzBrick[];
  pickups: BallzPickup[];
  score: number;
  collectedBalls: number;
};

function moveBall(
  ball: BallzBall,
  state: BallzState,
  bricks: BallzBrick[],
  pickups: BallzPickup[],
  currentScore: number,
  currentCollectedBalls: number,
): MoveBallResult {
  const previous = ball;
  let next = { ...ball, x: ball.x + ball.vx, y: ball.y + ball.vy };

  if (next.x - next.radius <= 0) next = { ...next, x: next.radius, vx: Math.abs(next.vx) };
  if (next.x + next.radius >= state.width) {
    next = { ...next, x: state.width - next.radius, vx: -Math.abs(next.vx) };
  }
  if (next.y - next.radius <= 0) next = { ...next, y: next.radius, vy: Math.abs(next.vy) };

  if (next.y + next.radius >= state.launcherY && next.vy > 0) {
    return {
      ball: null,
      settledX: clamp(next.x, next.radius, state.width - next.radius),
      bricks,
      pickups,
      score: currentScore,
      collectedBalls: currentCollectedBalls,
    };
  }

  let score = currentScore;
  const hitIndex = bricks.findIndex((brick) => circleIntersectsRect(next, brick));
  if (hitIndex >= 0) {
    const brick = bricks[hitIndex]!;
    score += 1;
    bricks =
      brick.hp <= 1
        ? bricks.filter((_, index) => index !== hitIndex)
        : bricks.map((candidate, index) =>
            index === hitIndex ? { ...candidate, hp: candidate.hp - 1 } : candidate,
          );
    next = reflectBallFromBrick(next, previous, brick);
  }

  let collectedBalls = currentCollectedBalls;
  const keptPickups: BallzPickup[] = [];
  for (const pickup of pickups) {
    if (circlesIntersect(next, pickup)) collectedBalls += 1;
    else keptPickups.push(pickup);
  }

  return { ball: next, settledX: next.x, bricks, pickups: keptPickups, score, collectedBalls };
}

function reflectBallFromBrick(ball: BallzBall, previous: BallzBall, brick: BallzBrick): BallzBall {
  if (previous.x + previous.radius <= brick.x && ball.vx > 0) {
    return { ...ball, x: brick.x - ball.radius, vx: -Math.abs(ball.vx) };
  }
  if (previous.x - previous.radius >= brick.x + brick.width && ball.vx < 0) {
    return { ...ball, x: brick.x + brick.width + ball.radius, vx: Math.abs(ball.vx) };
  }
  if (previous.y + previous.radius <= brick.y && ball.vy > 0) {
    return { ...ball, y: brick.y - ball.radius, vy: -Math.abs(ball.vy) };
  }
  if (previous.y - previous.radius >= brick.y + brick.height && ball.vy < 0) {
    return { ...ball, y: brick.y + brick.height + ball.radius, vy: Math.abs(ball.vy) };
  }

  const overlaps = [
    { axis: "x" as const, amount: Math.max(0, ball.x + ball.radius - brick.x), direction: -1 },
    {
      axis: "x" as const,
      amount: Math.max(0, brick.x + brick.width - (ball.x - ball.radius)),
      direction: 1,
    },
    { axis: "y" as const, amount: Math.max(0, ball.y + ball.radius - brick.y), direction: -1 },
    {
      axis: "y" as const,
      amount: Math.max(0, brick.y + brick.height - (ball.y - ball.radius)),
      direction: 1,
    },
  ];
  const side = overlaps.reduce((best, candidate) =>
    candidate.amount < best.amount ? candidate : best,
  );
  if (side.axis === "x") return { ...ball, vx: Math.abs(ball.vx) * side.direction };
  return { ...ball, vy: Math.abs(ball.vy) * side.direction };
}

function circlesIntersect(a: Circle, b: Circle): boolean {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 <= (a.radius + b.radius) ** 2;
}

function ballzColumnForX(x: number, config: BallzConfig): number {
  const width = ballzBrickWidth(config);
  return Math.floor((x - config.horizontalMargin) / (width + config.brickGap));
}
