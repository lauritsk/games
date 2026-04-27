import { describe, expect, test } from "bun:test";
import {
  movePongPlayer,
  newPongState,
  pongOpponentMove,
  stepPong,
  type PongConfig,
  type PongState,
} from "@games/pong/logic";

const config: PongConfig = {
  winningScore: 3,
  paddleHeight: 12,
  paddleSpeed: 3,
  opponentSpeed: 2,
  ballSpeed: 1.2,
  ballSpeedGrowth: 0.1,
};

describe("pong logic", () => {
  test("starts centered and clamps player paddle movement", () => {
    const state = newPongState(config);
    expect(state.playerScore).toBe(0);
    expect(state.opponentScore).toBe(0);
    expect(state.ball.x).toBe(50);
    expect(state.ball.vx).toBeGreaterThan(0);

    expect(movePongPlayer(state, -100).player.y).toBe(0);
    expect(movePongPlayer(state, 999).player.y).toBe(state.height - state.player.height);
  });

  test("moves paddles from input and AI target", () => {
    const state = blankPongState({ ball: { ...blankPongState().ball, x: 80, y: 10, vx: 1 } });
    expect(pongOpponentMove(state, config)).toBe(-1);

    const stepped = stepPong(state, config, { playerMove: 1, opponentMove: -1 });
    expect(stepped.player.y).toBe(state.player.y + config.paddleSpeed);
    expect(stepped.opponent.y).toBe(state.opponent.y - config.opponentSpeed);
  });

  test("bounces off top and bottom walls", () => {
    const top = stepPong(
      blankPongState({ ball: { x: 50, y: 0.8, radius: 1.35, vx: 1, vy: -1 } }),
      config,
    );
    expect(top.ball.y).toBe(top.ball.radius);
    expect(top.ball.vy).toBe(1);

    const bottom = stepPong(
      blankPongState({ ball: { x: 50, y: 59.4, radius: 1.35, vx: 1, vy: 1 } }),
      config,
    );
    expect(bottom.ball.y).toBe(bottom.height - bottom.ball.radius);
    expect(bottom.ball.vy).toBe(-1);
  });

  test("bounces off player paddle and increases rally", () => {
    const state = blankPongState({
      player: { x: 5, y: 24, width: 2.2, height: 12 },
      ball: { x: 7.8, y: 30, radius: 1.35, vx: -1.2, vy: 0 },
    });

    const bounced = stepPong(state, config, { opponentMove: 0 });
    expect(bounced.ball.vx).toBeGreaterThan(0);
    expect(bounced.ball.x).toBeCloseTo(state.player.x + state.player.width + state.ball.radius);
    expect(bounced.rally).toBe(1);
  });

  test("scores points, resets serve, and ends match", () => {
    const playerPoint = stepPong(
      blankPongState({ ball: { x: 102, y: 30, radius: 1.35, vx: 1.2, vy: 0 } }),
      config,
    );
    expect(playerPoint.playerScore).toBe(1);
    expect(playerPoint.opponentScore).toBe(0);
    expect(playerPoint.lastScoredBy).toBe("player");
    expect(playerPoint.ball.x).toBe(50);
    expect(playerPoint.ball.vx).toBeGreaterThan(0);
    expect(playerPoint.won).toBe(false);

    const won = stepPong(
      blankPongState({
        playerScore: 2,
        ball: { x: 102, y: 30, radius: 1.35, vx: 1.2, vy: 0 },
      }),
      config,
    );
    expect(won.playerScore).toBe(3);
    expect(won.won).toBe(true);
    expect(won.lost).toBe(false);

    const lost = stepPong(
      blankPongState({
        opponentScore: 2,
        ball: { x: -2, y: 30, radius: 1.35, vx: -1.2, vy: 0 },
      }),
      config,
    );
    expect(lost.opponentScore).toBe(3);
    expect(lost.lost).toBe(true);
  });
});

function blankPongState(overrides: Partial<PongState> = {}): PongState {
  return {
    width: 100,
    height: 60,
    player: { x: 5, y: 24, width: 2.2, height: 12 },
    opponent: { x: 92.8, y: 24, width: 2.2, height: 12 },
    ball: { x: 50, y: 30, radius: 1.35, vx: 1.2, vy: 0.4 },
    playerScore: 0,
    opponentScore: 0,
    rally: 0,
    tick: 0,
    won: false,
    lost: false,
    lastScoredBy: null,
    ...overrides,
  };
}
