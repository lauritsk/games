import { circleIntersectsRect, clamp, type Circle, type Rect } from "@games/shared/arcade";

export type PongSide = "player" | "opponent";
export type PongPaddle = Rect;
export type PongBall = Circle & { vx: number; vy: number };
export type PongInput = { playerMove?: -1 | 0 | 1; opponentMove?: -1 | 0 | 1 };
export type PongConfig = {
  winningScore: number;
  paddleHeight: number;
  paddleSpeed: number;
  opponentSpeed: number;
  ballSpeed: number;
  ballSpeedGrowth: number;
};
export type PongState = {
  width: number;
  height: number;
  player: PongPaddle;
  opponent: PongPaddle;
  ball: PongBall;
  playerScore: number;
  opponentScore: number;
  rally: number;
  tick: number;
  won: boolean;
  lost: boolean;
  lastScoredBy: PongSide | null;
};

export const pongWidth = 100;
export const pongHeight = 60;
export const pongPaddleWidth = 2.2;
export const pongBallRadius = 1.35;

export function newPongState(config: PongConfig): PongState {
  return {
    width: pongWidth,
    height: pongHeight,
    player: newPongPaddle(5, config.paddleHeight),
    opponent: newPongPaddle(pongWidth - 5 - pongPaddleWidth, config.paddleHeight),
    ball: newPongBall(config, "player"),
    playerScore: 0,
    opponentScore: 0,
    rally: 0,
    tick: 0,
    won: false,
    lost: false,
    lastScoredBy: null,
  };
}

export function movePongPlayer(state: PongState, centerY: number): PongState {
  return { ...state, player: movePongPaddleTo(state.player, centerY, state.height) };
}

export function stepPong(state: PongState, config: PongConfig, input: PongInput = {}): PongState {
  if (state.won || state.lost) return state;

  const player = movePongPaddleBy(
    state.player,
    input.playerMove ?? 0,
    config.paddleSpeed,
    state.height,
  );
  const opponentMove = input.opponentMove ?? pongOpponentMove(state, config);
  const opponent = movePongPaddleBy(
    state.opponent,
    opponentMove,
    config.opponentSpeed,
    state.height,
  );
  const activeState = { ...state, player, opponent, tick: state.tick + 1 };
  let ball = { ...state.ball, x: state.ball.x + state.ball.vx, y: state.ball.y + state.ball.vy };
  let rally = state.rally;

  if (ball.y - ball.radius <= 0 || ball.y + ball.radius >= state.height) {
    ball = {
      ...ball,
      y: clamp(ball.y, ball.radius, state.height - ball.radius),
      vy: -ball.vy,
    };
  }

  if (ball.vx < 0 && circleIntersectsRect(ball, player)) {
    ball = bouncePongBall(ball, player, 1, config, activeState.width);
    rally += 1;
  } else if (ball.vx > 0 && circleIntersectsRect(ball, opponent)) {
    ball = bouncePongBall(ball, opponent, -1, config, activeState.width);
    rally += 1;
  }

  if (ball.x + ball.radius < 0)
    return scorePongPoint({ ...activeState, ball, rally }, config, "opponent");
  if (ball.x - ball.radius > state.width)
    return scorePongPoint({ ...activeState, ball, rally }, config, "player");

  return { ...activeState, ball, rally, lastScoredBy: null };
}

export function pongOpponentMove(state: PongState, config: PongConfig): -1 | 0 | 1 {
  const center = state.opponent.y + state.opponent.height / 2;
  const target = state.ball.vx > 0 ? state.ball.y : state.height / 2;
  const deadZone = Math.max(1.2, config.opponentSpeed * 0.55);
  if (target < center - deadZone) return -1;
  if (target > center + deadZone) return 1;
  return 0;
}

function newPongPaddle(x: number, height: number): PongPaddle {
  return { x, y: (pongHeight - height) / 2, width: pongPaddleWidth, height };
}

function newPongBall(config: PongConfig, server: PongSide): PongBall {
  const direction = server === "player" ? 1 : -1;
  return {
    x: pongWidth / 2,
    y: pongHeight / 2,
    radius: pongBallRadius,
    vx: direction * config.ballSpeed,
    vy: config.ballSpeed * 0.32,
  };
}

function movePongPaddleBy(
  paddle: PongPaddle,
  move: -1 | 0 | 1,
  speed: number,
  height: number,
): PongPaddle {
  if (move === 0) return paddle;
  return { ...paddle, y: clamp(paddle.y + move * speed, 0, height - paddle.height) };
}

function movePongPaddleTo(paddle: PongPaddle, centerY: number, height: number): PongPaddle {
  return { ...paddle, y: clamp(centerY - paddle.height / 2, 0, height - paddle.height) };
}

function bouncePongBall(
  ball: PongBall,
  paddle: PongPaddle,
  direction: -1 | 1,
  config: PongConfig,
  width: number,
): PongBall {
  const paddleCenter = paddle.y + paddle.height / 2;
  const normalizedHit = clamp((ball.y - paddleCenter) / (paddle.height / 2), -1, 1);
  const speed = Math.hypot(ball.vx, ball.vy) + config.ballSpeedGrowth;
  const maxAngle = Math.PI * 0.34;
  const angle = normalizedHit * maxAngle;
  const x =
    direction > 0
      ? paddle.x + paddle.width + ball.radius
      : clamp(paddle.x - ball.radius, ball.radius, width - ball.radius);
  return {
    ...ball,
    x,
    vx: direction * Math.max(config.ballSpeed * 0.8, Math.cos(angle) * speed),
    vy: Math.sin(angle) * speed,
  };
}

function scorePongPoint(state: PongState, config: PongConfig, scorer: PongSide): PongState {
  const playerScore = state.playerScore + (scorer === "player" ? 1 : 0);
  const opponentScore = state.opponentScore + (scorer === "opponent" ? 1 : 0);
  const finished = playerScore >= config.winningScore || opponentScore >= config.winningScore;
  return {
    ...state,
    ball: finished ? state.ball : newPongBall(config, scorer),
    playerScore,
    opponentScore,
    rally: 0,
    won: playerScore >= config.winningScore,
    lost: opponentScore >= config.winningScore,
    lastScoredBy: scorer,
  };
}
