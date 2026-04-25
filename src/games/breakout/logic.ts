import { circleIntersectsRect, clamp, type Circle, type Rect } from "@games/shared/arcade";

export type BreakoutRect = Rect;
export type BreakoutBall = Circle & { vx: number; vy: number };
export type BreakoutBrick = BreakoutRect & { alive: boolean };
export type BreakoutState = {
  width: number;
  height: number;
  ball: BreakoutBall;
  paddle: BreakoutRect;
  bricks: BreakoutBrick[];
  score: number;
  lives: number;
  level: number;
  won: boolean;
  lost: boolean;
};

export type BreakoutConfig = {
  brickRows: number;
  brickColumns: number;
  lives: number;
  ballSpeed: number;
  paddleWidth: number;
};

export const breakoutWidth = 100;
export const breakoutHeight = 100;

export function newBreakoutState(config: BreakoutConfig, level = 1): BreakoutState {
  const ballSpeed = config.ballSpeed + (level - 1) * 0.18;
  return {
    width: breakoutWidth,
    height: breakoutHeight,
    ball: { x: 50, y: 72, vx: ballSpeed * 0.62, vy: -ballSpeed, radius: 1.6 },
    paddle: { x: 50 - config.paddleWidth / 2, y: 91, width: config.paddleWidth, height: 2.8 },
    bricks: newBreakoutBricks(config.brickRows, config.brickColumns),
    score: 0,
    lives: config.lives,
    level,
    won: false,
    lost: false,
  };
}

export function newBreakoutBricks(rows: number, columns: number): BreakoutBrick[] {
  const gap = 1.2;
  const margin = 5;
  const top = 9;
  const width = (breakoutWidth - margin * 2 - gap * (columns - 1)) / columns;
  const height = 4;
  return Array.from({ length: rows * columns }, (_, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    return {
      x: margin + column * (width + gap),
      y: top + row * (height + gap),
      width,
      height,
      alive: true,
    };
  });
}

export function moveBreakoutPaddle(state: BreakoutState, centerX: number): BreakoutState {
  const x = clamp(centerX - state.paddle.width / 2, 0, state.width - state.paddle.width);
  return { ...state, paddle: { ...state.paddle, x } };
}

export function stepBreakout(state: BreakoutState): BreakoutState {
  if (state.won || state.lost) return state;
  const previousBall = state.ball;
  let ball = { ...state.ball, x: state.ball.x + state.ball.vx, y: state.ball.y + state.ball.vy };
  let bricks = state.bricks;
  let score = state.score;
  let lives = state.lives;

  if (ball.x - ball.radius <= 0 || ball.x + ball.radius >= state.width) {
    ball = { ...ball, x: clamp(ball.x, ball.radius, state.width - ball.radius), vx: -ball.vx };
  }
  if (ball.y - ball.radius <= 0) {
    ball = { ...ball, y: ball.radius, vy: Math.abs(ball.vy) };
  }

  const crossedPaddleTop =
    previousBall.y + previousBall.radius <= state.paddle.y &&
    ball.y + ball.radius >= state.paddle.y;
  if (crossedPaddleTop && circleIntersectsRect(ball, state.paddle) && ball.vy > 0) {
    const hit = ((ball.x - state.paddle.x) / state.paddle.width - 0.5) * 2;
    const speed = Math.hypot(ball.vx, ball.vy);
    ball = {
      ...ball,
      y: state.paddle.y - ball.radius,
      vx: hit * speed * 0.82,
      vy: -Math.max(speed * 0.45, Math.abs(ball.vy)),
    };
  }

  const hitIndex = bricks.findIndex((brick) => brick.alive && circleIntersectsRect(ball, brick));
  if (hitIndex >= 0) {
    const brick = bricks[hitIndex]!;
    bricks = bricks.map((candidate, index) =>
      index === hitIndex ? { ...candidate, alive: false } : candidate,
    );
    score += 10 * state.level;
    const fromSide = ball.x < brick.x || ball.x > brick.x + brick.width;
    ball = fromSide ? { ...ball, vx: -ball.vx } : { ...ball, vy: -ball.vy };
  }

  if (ball.y - ball.radius > state.height) {
    lives -= 1;
    if (lives <= 0) return { ...state, lives, lost: true };
    ball = {
      x: state.paddle.x + state.paddle.width / 2,
      y: 72,
      vx: Math.abs(state.ball.vx),
      vy: -Math.abs(state.ball.vy),
      radius: state.ball.radius,
    };
  }

  return { ...state, ball, bricks, score, lives, won: bricks.every((brick) => !brick.alive) };
}

export { circleIntersectsRect };
