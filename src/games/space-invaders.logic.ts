export type InvaderRect = { x: number; y: number; width: number; height: number };
export type InvaderAlien = InvaderRect & { alive: boolean };
export type InvaderBarrier = InvaderRect & { hp: number };
export type InvaderShot = { x: number; y: number; vy: number; owner: "player" | "alien" };
export type InvaderConfig = {
  alienRows: number;
  alienColumns: number;
  lives: number;
  playerSpeed: number;
  alienStepEvery: number;
  alienShotEvery: number;
};
export type InvaderInput = { move?: -1 | 0 | 1 };
export type InvaderState = {
  width: number;
  height: number;
  player: InvaderRect;
  aliens: InvaderAlien[];
  barriers: InvaderBarrier[];
  shots: InvaderShot[];
  alienDirection: -1 | 1;
  tick: number;
  score: number;
  lives: number;
  wave: number;
  won: boolean;
  lost: boolean;
};

export const invaderWidth = 100;
export const invaderHeight = 100;

export function newInvaderState(config: InvaderConfig, wave = 1): InvaderState {
  return {
    width: invaderWidth,
    height: invaderHeight,
    player: { x: 45, y: 91, width: 10, height: 3 },
    aliens: newAliens(config.alienRows, config.alienColumns),
    barriers: newBarriers(),
    shots: [],
    alienDirection: 1,
    tick: 0,
    score: 0,
    lives: config.lives,
    wave,
    won: false,
    lost: false,
  };
}

export function newAliens(rows: number, columns: number): InvaderAlien[] {
  const gapX = 3.2;
  const gapY = 3.3;
  const width = 6.2;
  const height = 3.8;
  const totalWidth = columns * width + (columns - 1) * gapX;
  const left = (invaderWidth - totalWidth) / 2;
  return Array.from({ length: rows * columns }, (_, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    return { x: left + column * (width + gapX), y: 12 + row * (height + gapY), width, height, alive: true };
  });
}

export function newBarriers(): InvaderBarrier[] {
  return [16, 38, 60, 82].map((center) => ({ x: center - 5, y: 76, width: 10, height: 5, hp: 3 }));
}

export function fireInvaderShot(state: InvaderState): InvaderState {
  if (state.won || state.lost || state.shots.some((shot) => shot.owner === "player")) return state;
  return {
    ...state,
    shots: [...state.shots, { x: state.player.x + state.player.width / 2, y: state.player.y - 1, vy: -2.4, owner: "player" }],
  };
}

export function stepInvaders(state: InvaderState, config: InvaderConfig, input: InvaderInput = {}): InvaderState {
  if (state.won || state.lost) return state;
  let player = { ...state.player, x: clamp(state.player.x + (input.move ?? 0) * config.playerSpeed, 0, state.width - state.player.width) };
  let shots = state.shots.map((shot) => ({ ...shot, y: shot.y + shot.vy })).filter((shot) => shot.y > -4 && shot.y < state.height + 4);
  let aliens = state.aliens;
  let barriers = state.barriers;
  let score = state.score;
  let lives = state.lives;
  const tick = state.tick + 1;
  let alienDirection = state.alienDirection;

  const stepEvery = Math.max(5, config.alienStepEvery - (state.wave - 1) * 3 - clearedAlienCount(aliens));
  if (tick % stepEvery === 0) {
    const alive = aliens.filter((alien) => alien.alive);
    const edge = alienDirection === 1
      ? Math.max(...alive.map((alien) => alien.x + alien.width), 0)
      : Math.min(...alive.map((alien) => alien.x), state.width);
    if ((alienDirection === 1 && edge >= 94) || (alienDirection === -1 && edge <= 6)) {
      alienDirection = alienDirection === 1 ? -1 : 1;
      aliens = aliens.map((alien) => alien.alive ? { ...alien, y: alien.y + 4 } : alien);
    } else {
      aliens = aliens.map((alien) => alien.alive ? { ...alien, x: alien.x + alienDirection * 2 } : alien);
    }
  }

  if (tick % Math.max(12, config.alienShotEvery - state.wave * 4) === 0) {
    const shooter = chooseAlienShooter(aliens, tick);
    if (shooter) shots.push({ x: shooter.x + shooter.width / 2, y: shooter.y + shooter.height, vy: 1.65 + state.wave * 0.08, owner: "alien" });
  }

  ({ shots, barriers } = resolveBarrierHits(shots, barriers));
  const alienHit = shots.findIndex((shot) => shot.owner === "player" && aliens.some((alien) => alien.alive && pointInRect(shot.x, shot.y, alien)));
  if (alienHit >= 0) {
    const shot = shots[alienHit]!;
    aliens = aliens.map((alien) => alien.alive && pointInRect(shot.x, shot.y, alien) ? { ...alien, alive: false } : alien);
    shots = shots.filter((_, index) => index !== alienHit);
    score += 20 * state.wave;
  }

  const playerHit = shots.findIndex((shot) => shot.owner === "alien" && pointInRect(shot.x, shot.y, player));
  if (playerHit >= 0) {
    shots = shots.filter((_, index) => index !== playerHit);
    lives -= 1;
  }

  const won = aliens.every((alien) => !alien.alive);
  const invaded = aliens.some((alien) => alien.alive && alien.y + alien.height >= player.y);
  const lost = !won && (lives <= 0 || invaded);
  return { ...state, player, aliens, barriers, shots, alienDirection, tick, score, lives, won, lost };
}

export function nextInvaderWave(state: InvaderState, config: InvaderConfig): InvaderState {
  const next = newInvaderState(config, state.wave + 1);
  return { ...next, score: state.score, lives: state.lives };
}

function resolveBarrierHits(shots: InvaderShot[], barriers: InvaderBarrier[]): { shots: InvaderShot[]; barriers: InvaderBarrier[] } {
  const nextShots: InvaderShot[] = [];
  let nextBarriers = barriers;
  for (const shot of shots) {
    const hitIndex = nextBarriers.findIndex((barrier) => barrier.hp > 0 && pointInRect(shot.x, shot.y, barrier));
    if (hitIndex < 0) nextShots.push(shot);
    else nextBarriers = nextBarriers.map((barrier, index) => index === hitIndex ? { ...barrier, hp: barrier.hp - 1 } : barrier);
  }
  return { shots: nextShots, barriers: nextBarriers };
}

function chooseAlienShooter(aliens: InvaderAlien[], tick: number): InvaderAlien | undefined {
  const alive = aliens.filter((alien) => alien.alive);
  if (alive.length === 0) return undefined;
  return alive[tick % alive.length];
}

function clearedAlienCount(aliens: InvaderAlien[]): number {
  return aliens.filter((alien) => !alien.alive).length;
}

function pointInRect(x: number, y: number, rect: InvaderRect): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
