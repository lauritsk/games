import { describe, expect, test } from "bun:test";
import {
  asteroidRadius,
  fireAsteroidBullet,
  newAsteroidsState,
  nextAsteroidsWave,
  rotateAsteroidsShip,
  stepAsteroids,
  thrustAsteroidsShip,
  type AsteroidRock,
  type AsteroidsConfig,
  type AsteroidsState,
} from "@games/asteroids/logic";

const config: AsteroidsConfig = {
  lives: 3,
  startingAsteroids: 2,
  asteroidGrowth: 1,
  maxAsteroids: 4,
  asteroidSpeed: 0.4,
  shipTurnSpeed: Math.PI / 2,
  shipThrust: 1,
  shipFriction: 1,
  maxShipSpeed: 2,
  bulletSpeed: 3,
  bulletTtl: 3,
  bulletCooldown: 2,
  respawnInvulnerableTicks: 5,
};

describe("asteroids logic", () => {
  test("starts deterministic waves and advances to the next wave", () => {
    const state = newAsteroidsState(config, 1, () => 0);
    expect(state.asteroids).toHaveLength(2);
    expect(state.lives).toBe(3);
    expect(state.wave).toBe(1);
    expect(state.ship.invulnerable).toBe(config.respawnInvulnerableTicks);

    const next = nextAsteroidsWave(
      { ...state, asteroids: [], won: true, score: 120, lives: 2 },
      config,
      () => 0,
    );
    expect(next.wave).toBe(2);
    expect(next.score).toBe(120);
    expect(next.lives).toBe(2);
    expect(next.asteroids).toHaveLength(3);
    expect(next.won).toBe(false);
  });

  test("rotates, thrusts, clamps speed, and wraps the ship", () => {
    const rotated = rotateAsteroidsShip(blankAsteroidsState(), 1, config);
    expect(rotated.ship.angle).toBeCloseTo(0);

    const thrust = thrustAsteroidsShip(rotated, config);
    expect(thrust.ship.vx).toBeCloseTo(1);
    expect(thrust.ship.vy).toBeCloseTo(0);
    expect(thrust.ship.thrusting).toBe(true);

    const wrapped = stepAsteroids(
      blankAsteroidsState({
        ship: { ...thrust.ship, x: 99, y: 50, vx: 3, vy: 0 },
        asteroids: [rock({ x: 20, y: 20, size: 1 })],
      }),
      config,
    );
    expect(wrapped.ship.x).toBeCloseTo(1);
    expect(Math.hypot(wrapped.ship.vx, wrapped.ship.vy)).toBeLessThanOrEqual(config.maxShipSpeed);
  });

  test("fires bullets with cooldown and expires them by ttl", () => {
    const state = blankAsteroidsState({ asteroids: [rock({ x: 10, y: 10, size: 1 })] });
    const fired = fireAsteroidBullet(state, config);
    expect(fired.bullets).toHaveLength(1);
    expect(fired.bullets[0]?.y).toBeLessThan(state.ship.y);
    expect(fireAsteroidBullet(fired, config).bullets).toHaveLength(1);

    const one = stepAsteroids(fired, config);
    expect(one.bulletCooldown).toBe(1);
    const two = stepAsteroids(one, config);
    const three = stepAsteroids(two, config);
    expect(three.bullets).toHaveLength(0);
  });

  test("splits large asteroids and scores by rock size", () => {
    const hit = stepAsteroids(
      blankAsteroidsState({
        asteroids: [rock({ id: 1, x: 40, y: 40, size: 3, vx: 0.2 })],
        bullets: [{ id: 2, x: 40, y: 40, radius: 0.65, vx: 0, vy: 0, ttl: 10 }],
        nextId: 3,
      }),
      config,
    );

    expect(hit.score).toBe(20);
    expect(hit.bullets).toHaveLength(0);
    expect(hit.asteroids.map((asteroid) => asteroid.size)).toEqual([2, 2]);
    expect(hit.won).toBe(false);
  });

  test("clears small asteroids and marks the wave won", () => {
    const cleared = stepAsteroids(
      blankAsteroidsState({
        asteroids: [rock({ id: 1, x: 40, y: 40, size: 1 })],
        bullets: [{ id: 2, x: 40, y: 40, radius: 0.65, vx: 0, vy: 0, ttl: 10 }],
        nextId: 3,
      }),
      config,
    );

    expect(cleared.score).toBe(100);
    expect(cleared.asteroids).toHaveLength(0);
    expect(cleared.won).toBe(true);
  });

  test("loses lives on ship collisions and ends at zero lives", () => {
    const damaged = stepAsteroids(
      blankAsteroidsState({
        lives: 2,
        ship: { ...blankAsteroidsState().ship, x: 20, y: 20, invulnerable: 0 },
        asteroids: [rock({ x: 20, y: 20, size: 1 })],
      }),
      config,
    );
    expect(damaged.lives).toBe(1);
    expect(damaged.lost).toBe(false);
    expect(damaged.ship.invulnerable).toBe(config.respawnInvulnerableTicks);

    const lost = stepAsteroids(
      blankAsteroidsState({
        lives: 1,
        ship: { ...blankAsteroidsState().ship, x: 20, y: 20, invulnerable: 0 },
        asteroids: [rock({ x: 20, y: 20, size: 1 })],
      }),
      config,
    );
    expect(lost.lives).toBe(0);
    expect(lost.lost).toBe(true);
  });
});

function blankAsteroidsState(overrides: Partial<AsteroidsState> = {}): AsteroidsState {
  return {
    width: 100,
    height: 100,
    ship: {
      x: 50,
      y: 50,
      radius: 2.9,
      angle: -Math.PI / 2,
      vx: 0,
      vy: 0,
      invulnerable: 0,
      thrusting: false,
    },
    asteroids: [],
    bullets: [],
    score: 0,
    lives: config.lives,
    wave: 1,
    tick: 0,
    bulletCooldown: 0,
    won: false,
    lost: false,
    nextId: 1,
    ...overrides,
  };
}

function rock(overrides: Partial<AsteroidRock> = {}): AsteroidRock {
  const size = overrides.size ?? 2;
  return {
    id: 1,
    x: 30,
    y: 30,
    radius: asteroidRadius(size),
    size,
    vx: 0,
    vy: 0,
    rotation: 0,
    spin: 0,
    ...overrides,
  };
}
