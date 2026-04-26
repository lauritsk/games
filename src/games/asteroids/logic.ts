import { wrap, type Circle, type Vector } from "@games/shared/arcade";
import type { RandomSource } from "@shared/types";

export type AsteroidSize = 1 | 2 | 3;
export type AsteroidsVector = Vector;
export type AsteroidsShip = Circle & {
  angle: number;
  vx: number;
  vy: number;
  invulnerable: number;
  thrusting: boolean;
};
export type AsteroidRock = Circle & {
  id: number;
  size: AsteroidSize;
  vx: number;
  vy: number;
  rotation: number;
  spin: number;
};
export type AsteroidBullet = Circle & {
  id: number;
  vx: number;
  vy: number;
  ttl: number;
};
export type AsteroidsState = {
  width: number;
  height: number;
  ship: AsteroidsShip;
  asteroids: AsteroidRock[];
  bullets: AsteroidBullet[];
  score: number;
  lives: number;
  wave: number;
  tick: number;
  bulletCooldown: number;
  won: boolean;
  lost: boolean;
  nextId: number;
};
export type AsteroidsConfig = {
  lives: number;
  startingAsteroids: number;
  asteroidGrowth: number;
  maxAsteroids: number;
  asteroidSpeed: number;
  shipTurnSpeed: number;
  shipThrust: number;
  shipFriction: number;
  maxShipSpeed: number;
  bulletSpeed: number;
  bulletTtl: number;
  bulletCooldown: number;
  respawnInvulnerableTicks: number;
};
export type AsteroidsInput = {
  rotate?: -1 | 0 | 1;
  thrust?: boolean;
  fire?: boolean;
};

export const asteroidsWidth = 100;
export const asteroidsHeight = 100;
export const asteroidShipRadius = 2.9;
export const asteroidBulletRadius = 0.65;

export function newAsteroidsState(
  config: AsteroidsConfig,
  wave = 1,
  random: RandomSource = Math.random,
): AsteroidsState {
  const spawned = spawnAsteroidWave(asteroidCountForWave(config, wave), wave, config, random, 1);
  return {
    width: asteroidsWidth,
    height: asteroidsHeight,
    ship: newAsteroidsShip(config.respawnInvulnerableTicks),
    asteroids: spawned.asteroids,
    bullets: [],
    score: 0,
    lives: config.lives,
    wave,
    tick: 0,
    bulletCooldown: 0,
    won: false,
    lost: false,
    nextId: spawned.nextId,
  };
}

export function nextAsteroidsWave(
  state: AsteroidsState,
  config: AsteroidsConfig,
  random: RandomSource = Math.random,
): AsteroidsState {
  const wave = state.wave + 1;
  const spawned = spawnAsteroidWave(
    asteroidCountForWave(config, wave),
    wave,
    config,
    random,
    state.nextId,
  );
  return {
    ...state,
    ship: newAsteroidsShip(config.respawnInvulnerableTicks),
    asteroids: spawned.asteroids,
    bullets: [],
    lives: state.lives,
    wave,
    tick: 0,
    bulletCooldown: 0,
    won: false,
    lost: false,
    nextId: spawned.nextId,
  };
}

export function rotateAsteroidsShip(
  state: AsteroidsState,
  direction: -1 | 0 | 1,
  config: Pick<AsteroidsConfig, "shipTurnSpeed">,
): AsteroidsState {
  if (direction === 0 || state.won || state.lost) return state;
  return {
    ...state,
    ship: {
      ...state.ship,
      angle: normalizeAngle(state.ship.angle + direction * config.shipTurnSpeed),
    },
  };
}

export function thrustAsteroidsShip(
  state: AsteroidsState,
  config: Pick<AsteroidsConfig, "shipThrust" | "maxShipSpeed">,
): AsteroidsState {
  if (state.won || state.lost) return state;
  const velocity = clampVectorMagnitude(
    {
      x: state.ship.vx + Math.cos(state.ship.angle) * config.shipThrust,
      y: state.ship.vy + Math.sin(state.ship.angle) * config.shipThrust,
    },
    config.maxShipSpeed,
  );
  return {
    ...state,
    ship: { ...state.ship, vx: velocity.x, vy: velocity.y, thrusting: true },
  };
}

export function fireAsteroidBullet(
  state: AsteroidsState,
  config: Pick<AsteroidsConfig, "bulletSpeed" | "bulletTtl" | "bulletCooldown">,
): AsteroidsState {
  if (state.won || state.lost || state.bulletCooldown > 0) return state;
  const direction = { x: Math.cos(state.ship.angle), y: Math.sin(state.ship.angle) };
  const nose = state.ship.radius + asteroidBulletRadius + 0.6;
  return {
    ...state,
    bullets: [
      ...state.bullets,
      {
        id: state.nextId,
        x: wrap(state.ship.x + direction.x * nose, 0, state.width),
        y: wrap(state.ship.y + direction.y * nose, 0, state.height),
        vx: state.ship.vx + direction.x * config.bulletSpeed,
        vy: state.ship.vy + direction.y * config.bulletSpeed,
        radius: asteroidBulletRadius,
        ttl: config.bulletTtl,
      },
    ],
    bulletCooldown: config.bulletCooldown,
    nextId: state.nextId + 1,
  };
}

export function stepAsteroids(
  state: AsteroidsState,
  config: AsteroidsConfig,
  input: AsteroidsInput = {},
): AsteroidsState {
  if (state.won || state.lost) return state;

  let next = input.fire ? fireAsteroidBullet(state, config) : state;
  next = rotateAsteroidsShip(next, input.rotate ?? 0, config);
  next = input.thrust ? thrustAsteroidsShip(next, config) : withShipThrust(next, false);

  const advanced = {
    ...next,
    ship: advanceShip(next.ship, next, config),
    asteroids: next.asteroids.map((asteroid) => advanceAsteroid(asteroid, next)),
    bullets: next.bullets.map((bullet) => advanceBullet(bullet, next)).filter(isLiveBullet),
    bulletCooldown: Math.max(0, next.bulletCooldown - 1),
    tick: next.tick + 1,
  };

  const resolved = resolveBulletAsteroidCollisions(advanced);
  const shipHit =
    resolved.ship.invulnerable <= 0 &&
    resolved.asteroids.some((asteroid) => circlesOverlap(resolved.ship, asteroid));

  if (shipHit) return damageShip(resolved, config);

  return {
    ...resolved,
    won: resolved.asteroids.length === 0,
  };
}

export function asteroidRadius(size: AsteroidSize): number {
  if (size === 3) return 8.2;
  if (size === 2) return 5.4;
  return 3.2;
}

export function asteroidScore(size: AsteroidSize): number {
  if (size === 3) return 20;
  if (size === 2) return 50;
  return 100;
}

function newAsteroidsShip(invulnerable: number): AsteroidsShip {
  return {
    x: asteroidsWidth / 2,
    y: asteroidsHeight / 2,
    radius: asteroidShipRadius,
    angle: -Math.PI / 2,
    vx: 0,
    vy: 0,
    invulnerable,
    thrusting: false,
  };
}

function withShipThrust(state: AsteroidsState, thrusting: boolean): AsteroidsState {
  return { ...state, ship: { ...state.ship, thrusting } };
}

function advanceShip(
  ship: AsteroidsShip,
  state: Pick<AsteroidsState, "width" | "height">,
  config: Pick<AsteroidsConfig, "shipFriction" | "maxShipSpeed">,
): AsteroidsShip {
  const velocity = clampVectorMagnitude(
    { x: ship.vx * config.shipFriction, y: ship.vy * config.shipFriction },
    config.maxShipSpeed,
  );
  return {
    ...ship,
    x: wrap(ship.x + velocity.x, 0, state.width),
    y: wrap(ship.y + velocity.y, 0, state.height),
    vx: velocity.x,
    vy: velocity.y,
    invulnerable: Math.max(0, ship.invulnerable - 1),
  };
}

function advanceAsteroid(
  asteroid: AsteroidRock,
  state: Pick<AsteroidsState, "width" | "height">,
): AsteroidRock {
  return {
    ...asteroid,
    x: wrap(asteroid.x + asteroid.vx, 0, state.width),
    y: wrap(asteroid.y + asteroid.vy, 0, state.height),
    rotation: wrap(asteroid.rotation + asteroid.spin, 0, 360),
  };
}

function advanceBullet(
  bullet: AsteroidBullet,
  state: Pick<AsteroidsState, "width" | "height">,
): AsteroidBullet {
  return {
    ...bullet,
    x: wrap(bullet.x + bullet.vx, 0, state.width),
    y: wrap(bullet.y + bullet.vy, 0, state.height),
    ttl: bullet.ttl - 1,
  };
}

function isLiveBullet(bullet: AsteroidBullet): boolean {
  return bullet.ttl > 0;
}

function resolveBulletAsteroidCollisions(state: AsteroidsState): AsteroidsState {
  let asteroids = state.asteroids;
  let score = state.score;
  let nextId = state.nextId;
  const bullets: AsteroidBullet[] = [];

  for (const bullet of state.bullets) {
    const hitIndex = asteroids.findIndex((asteroid) => circlesOverlap(bullet, asteroid));
    if (hitIndex < 0) {
      bullets.push(bullet);
      continue;
    }

    const hit = asteroids[hitIndex];
    if (!hit) continue;
    asteroids = asteroids.filter((_, index) => index !== hitIndex);
    score += asteroidScore(hit.size) * state.wave;
    const split = splitAsteroid(hit, bullet, state, nextId);
    nextId += split.length;
    asteroids = [...asteroids, ...split];
  }

  return { ...state, asteroids, bullets, score, nextId };
}

function splitAsteroid(
  asteroid: AsteroidRock,
  bullet: AsteroidBullet,
  state: Pick<AsteroidsState, "width" | "height">,
  nextId: number,
): AsteroidRock[] {
  if (asteroid.size === 1) return [];
  const size = (asteroid.size - 1) as AsteroidSize;
  const radius = asteroidRadius(size);
  const incoming = Math.atan2(bullet.vy, bullet.vx);
  const baseSpeed = Math.max(0.45, Math.hypot(asteroid.vx, asteroid.vy) * 1.13);
  return [incoming + Math.PI * 0.56, incoming - Math.PI * 0.56].map((angle, index) => ({
    id: nextId + index,
    size,
    radius,
    x: wrap(asteroid.x + Math.cos(angle) * radius * 0.75, 0, state.width),
    y: wrap(asteroid.y + Math.sin(angle) * radius * 0.75, 0, state.height),
    vx: asteroid.vx * 0.35 + Math.cos(angle) * baseSpeed,
    vy: asteroid.vy * 0.35 + Math.sin(angle) * baseSpeed,
    rotation: asteroid.rotation + index * 43,
    spin: -asteroid.spin + (index === 0 ? 1.4 : -1.4),
  }));
}

function damageShip(state: AsteroidsState, config: AsteroidsConfig): AsteroidsState {
  const lives = state.lives - 1;
  if (lives <= 0) {
    return {
      ...state,
      lives,
      bullets: [],
      lost: true,
      won: false,
      ship: { ...state.ship, thrusting: false },
    };
  }
  return {
    ...state,
    ship: newAsteroidsShip(config.respawnInvulnerableTicks),
    bullets: [],
    lives,
    won: false,
  };
}

function spawnAsteroidWave(
  count: number,
  wave: number,
  config: Pick<AsteroidsConfig, "asteroidSpeed">,
  random: RandomSource,
  startId: number,
): { asteroids: AsteroidRock[]; nextId: number } {
  const asteroids: AsteroidRock[] = [];
  let nextId = startId;
  for (let index = 0; index < count; index += 1) {
    asteroids.push(spawnAsteroid(nextId, wave, config, random));
    nextId += 1;
  }
  return { asteroids, nextId };
}

function spawnAsteroid(
  id: number,
  wave: number,
  config: Pick<AsteroidsConfig, "asteroidSpeed">,
  random: RandomSource,
): AsteroidRock {
  const size: AsteroidSize = 3;
  const radius = asteroidRadius(size);
  const edge = Math.floor(random() * 4);
  const offset = random() * asteroidsWidth;
  const position = edgePosition(edge, offset, radius);
  const centerAngle = Math.atan2(asteroidsHeight / 2 - position.y, asteroidsWidth / 2 - position.x);
  const angle = centerAngle + (random() - 0.5) * Math.PI * 0.72;
  const speed = (config.asteroidSpeed + (wave - 1) * 0.055) * (0.82 + random() * 0.42);
  return {
    id,
    size,
    radius,
    x: position.x,
    y: position.y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    rotation: random() * 360,
    spin: (random() - 0.5) * 4.2,
  };
}

function edgePosition(edge: number, offset: number, radius: number): { x: number; y: number } {
  if (edge === 0) return { x: offset, y: radius };
  if (edge === 1) return { x: asteroidsWidth - radius, y: offset };
  if (edge === 2) return { x: offset, y: asteroidsHeight - radius };
  return { x: radius, y: offset };
}

function asteroidCountForWave(config: AsteroidsConfig, wave: number): number {
  return Math.min(
    config.maxAsteroids,
    config.startingAsteroids + (wave - 1) * config.asteroidGrowth,
  );
}

function circlesOverlap(a: Circle, b: Circle): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= a.radius + b.radius;
}

function clampVectorMagnitude(vector: Vector, max: number): Vector {
  const length = Math.hypot(vector.x, vector.y);
  if (length <= max || length === 0) return vector;
  const scale = max / length;
  return { x: vector.x * scale, y: vector.y * scale };
}

function normalizeAngle(angle: number): number {
  return wrap(angle + Math.PI, 0, Math.PI * 2) - Math.PI;
}

export { circlesOverlap as asteroidsCirclesOverlap };
