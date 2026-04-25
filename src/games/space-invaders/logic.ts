import { clamp, rectsOverlap, type Rect } from "@games/shared/arcade";
import type { Difficulty } from "@shared/types";

export type InvaderRect = Rect;
export type InvaderPlayerId = "p1" | "p2";
export type InvaderPlayer = InvaderRect & { id: InvaderPlayerId };
export type InvaderAlien = InvaderRect & { alive: boolean };
export type InvaderBarrier = InvaderRect & { hp: number };
export type InvaderShot = {
  x: number;
  y: number;
  vy: number;
  owner: "player" | "alien";
  playerId?: InvaderPlayerId;
};
export type InvaderConfig = {
  alienRows: number;
  alienColumns: number;
  lives: number;
  playerSpeed: number;
  alienStepEvery: number;
  alienShotEvery: number;
};
export type InvaderInput = { move?: -1 | 0 | 1 };
export type InvaderPlayerInput = { playerId: InvaderPlayerId; move?: -1 | 0 | 1 };
export type InvaderState = {
  width: number;
  height: number;
  player: InvaderRect;
  players: InvaderPlayer[];
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
export const invaderShotWidth = 0.7;
export const invaderShotHeight = 2.6;

export const invaderConfigs: Record<Difficulty, InvaderConfig> = {
  Easy: {
    alienRows: 3,
    alienColumns: 7,
    lives: 4,
    playerSpeed: 2.8,
    alienStepEvery: 32,
    alienShotEvery: 62,
  },
  Medium: {
    alienRows: 4,
    alienColumns: 8,
    lives: 3,
    playerSpeed: 2.5,
    alienStepEvery: 26,
    alienShotEvery: 48,
  },
  Hard: {
    alienRows: 5,
    alienColumns: 9,
    lives: 2,
    playerSpeed: 2.2,
    alienStepEvery: 21,
    alienShotEvery: 36,
  },
};

export function scaleInvaderConfigForPlayers(
  config: InvaderConfig,
  playerCount: number,
): InvaderConfig {
  if (playerCount <= 1) return { ...config };
  return {
    ...config,
    alienRows: Math.min(5, config.alienRows + 1),
    alienColumns: Math.min(10, config.alienColumns + 1),
    alienStepEvery: Math.max(14, Math.round(config.alienStepEvery * 0.78)),
    alienShotEvery: Math.max(18, Math.round(config.alienShotEvery * 0.68)),
  };
}

export function newInvaderState(
  config: InvaderConfig,
  wave = 1,
  players = newInvaderPlayers(1),
): InvaderState {
  const normalizedPlayers = players.length > 0 ? players : newInvaderPlayers(1);
  return {
    width: invaderWidth,
    height: invaderHeight,
    player: normalizedPlayers[0]!,
    players: normalizedPlayers,
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
    return {
      x: left + column * (width + gapX),
      y: 12 + row * (height + gapY),
      width,
      height,
      alive: true,
    };
  });
}

export function newBarriers(): InvaderBarrier[] {
  return [16, 38, 60, 82].map((center) => ({ x: center - 5, y: 76, width: 10, height: 5, hp: 3 }));
}

export function newInvaderPlayers(count = 1): InvaderPlayer[] {
  if (count <= 1) return [newInvaderPlayer("p1", 45)];
  return [newInvaderPlayer("p1", 28), newInvaderPlayer("p2", 62)].slice(0, count);
}

export function fireInvaderShot(state: InvaderState): InvaderState {
  return fireInvaderPlayerShot(state, "p1");
}

export function fireInvaderPlayerShot(
  state: InvaderState,
  playerId: InvaderPlayerId,
): InvaderState {
  const players = invaderPlayers(state);
  const player = players.find((candidate) => candidate.id === playerId);
  if (!player || state.won || state.lost) return state;
  if (state.shots.some((shot) => shot.owner === "player" && invaderShotPlayerId(shot) === playerId))
    return state;
  return withInvaderPlayers(
    {
      ...state,
      shots: [
        ...state.shots,
        {
          x: player.x + player.width / 2,
          y: player.y - 1,
          vy: -2.4,
          owner: "player",
          playerId,
        },
      ],
    },
    players,
  );
}

export function aimInvaderPlayer(
  state: InvaderState,
  playerId: InvaderPlayerId,
  centerX: number,
): InvaderState {
  const players = invaderPlayers(state).map((player) =>
    player.id === playerId
      ? { ...player, x: clamp(centerX - player.width / 2, 0, state.width - player.width) }
      : player,
  );
  return withInvaderPlayers(state, players);
}

export function stepInvaders(
  state: InvaderState,
  config: InvaderConfig,
  input: InvaderInput = {},
): InvaderState {
  return stepInvadersWithPlayerInputs(state, config, [{ playerId: "p1", move: input.move }]);
}

export function stepInvadersWithPlayerInputs(
  state: InvaderState,
  config: InvaderConfig,
  inputs: readonly InvaderPlayerInput[] = [],
): InvaderState {
  if (state.won || state.lost) return state;

  const tick = state.tick + 1;
  const players = moveInvaderPlayers(state, config, inputs);
  const activeState = withInvaderPlayers(state, players);
  const { aliens, alienDirection } = advanceAlienFormation(activeState, config, tick);
  const shots = maybeFireAlienShot(
    advanceInvaderShots(activeState),
    aliens,
    state.wave,
    config,
    tick,
  );
  const resolved = resolveInvaderCollisions({
    aliens,
    barriers: state.barriers,
    shots,
    players,
    score: state.score,
    lives: state.lives,
    wave: state.wave,
  });
  const won = resolved.aliens.every((alien) => !alien.alive);
  const lost = !won && (resolved.lives <= 0 || hasInvadedPlayer(resolved.aliens, resolved.players));

  return {
    ...state,
    player: resolved.players[0] ?? state.player,
    players: resolved.players,
    aliens: resolved.aliens,
    barriers: resolved.barriers,
    shots: resolved.shots,
    alienDirection,
    tick,
    score: resolved.score,
    lives: resolved.lives,
    won,
    lost,
  };
}

export function nextInvaderWave(state: InvaderState, config: InvaderConfig): InvaderState {
  const next = newInvaderState(
    config,
    state.wave + 1,
    newInvaderPlayers(invaderPlayers(state).length),
  );
  return { ...next, score: state.score, lives: state.lives };
}

type AlienAdvance = {
  aliens: InvaderAlien[];
  alienDirection: -1 | 1;
};

type InvaderCollisionState = {
  aliens: InvaderAlien[];
  barriers: InvaderBarrier[];
  shots: InvaderShot[];
  players: InvaderPlayer[];
  score: number;
  lives: number;
  wave: number;
};

function newInvaderPlayer(id: InvaderPlayerId, x: number): InvaderPlayer {
  return { id, x, y: 91, width: 10, height: 3 };
}

function moveInvaderPlayers(
  state: InvaderState,
  config: InvaderConfig,
  inputs: readonly InvaderPlayerInput[],
): InvaderPlayer[] {
  const moves = new Map(inputs.map((input) => [input.playerId, input.move ?? 0] as const));
  return invaderPlayers(state).map((player) => ({
    ...player,
    x: clamp(
      player.x + (moves.get(player.id) ?? 0) * config.playerSpeed,
      0,
      state.width - player.width,
    ),
  }));
}

function advanceInvaderShots(state: InvaderState): InvaderShot[] {
  return state.shots
    .map((shot) => ({ ...shot, y: shot.y + shot.vy }))
    .filter((shot) => shot.y > -4 && shot.y < state.height + 4);
}

function advanceAlienFormation(
  state: InvaderState,
  config: InvaderConfig,
  tick: number,
): AlienAdvance {
  let aliens = state.aliens;
  let alienDirection = state.alienDirection;
  if (tick % alienStepInterval(state, config) !== 0) return { aliens, alienDirection };

  const alive = aliens.filter((alien) => alien.alive);
  const edge =
    alienDirection === 1
      ? Math.max(...alive.map((alien) => alien.x + alien.width), 0)
      : Math.min(...alive.map((alien) => alien.x), state.width);
  if ((alienDirection === 1 && edge >= 94) || (alienDirection === -1 && edge <= 6)) {
    alienDirection = alienDirection === 1 ? -1 : 1;
    aliens = aliens.map((alien) => (alien.alive ? { ...alien, y: alien.y + 4 } : alien));
  } else {
    aliens = aliens.map((alien) =>
      alien.alive ? { ...alien, x: alien.x + alienDirection * 2 } : alien,
    );
  }
  return { aliens, alienDirection };
}

function alienStepInterval(state: InvaderState, config: InvaderConfig): number {
  return Math.max(
    5,
    config.alienStepEvery - (state.wave - 1) * 3 - clearedAlienCount(state.aliens),
  );
}

function maybeFireAlienShot(
  shots: InvaderShot[],
  aliens: InvaderAlien[],
  wave: number,
  config: InvaderConfig,
  tick: number,
): InvaderShot[] {
  if (tick % Math.max(12, config.alienShotEvery - wave * 4) !== 0) return shots;
  const shooter = chooseAlienShooter(aliens, tick);
  if (!shooter) return shots;
  return [
    ...shots,
    {
      x: shooter.x + shooter.width / 2,
      y: shooter.y + shooter.height,
      vy: 1.65 + wave * 0.08,
      owner: "alien",
    },
  ];
}

function resolveInvaderCollisions(collision: InvaderCollisionState): InvaderCollisionState {
  let { aliens, barriers, shots, score, lives } = collision;
  shots = resolveShotClashes(shots);
  ({ shots, barriers } = resolveBarrierHits(shots, barriers));

  const alienHit = findAlienShotHit(shots, aliens);
  if (alienHit) {
    aliens = aliens.map((alien, index) =>
      index === alienHit.alienIndex ? { ...alien, alive: false } : alien,
    );
    shots = shots.filter((_, index) => index !== alienHit.shotIndex);
    score += 20 * collision.wave;
  }

  const playerHit = findPlayerHit(shots, collision.players);
  if (playerHit >= 0) {
    shots = shots.filter((_, index) => index !== playerHit);
    lives -= 1;
  }

  return { ...collision, aliens, barriers, shots, score, lives };
}

function findPlayerHit(shots: InvaderShot[], players: readonly InvaderPlayer[]): number {
  return shots.findIndex(
    (shot) =>
      shot.owner === "alien" &&
      players.some((player) => rectsOverlap(shotHitbox(shot), playerHitbox(player))),
  );
}

function hasInvadedPlayer(aliens: InvaderAlien[], players: readonly InvaderPlayer[]): boolean {
  return aliens.some((alien) =>
    players.some((player) => alien.alive && alien.y + alien.height >= player.y),
  );
}

function resolveBarrierHits(
  shots: InvaderShot[],
  barriers: InvaderBarrier[],
): { shots: InvaderShot[]; barriers: InvaderBarrier[] } {
  const nextShots: InvaderShot[] = [];
  let nextBarriers = barriers;
  for (const shot of shots) {
    const hitIndex = firstHitIndex(shot, nextBarriers, barrierHitbox);
    if (hitIndex < 0) nextShots.push(shot);
    else
      nextBarriers = nextBarriers.map((barrier, index) =>
        index === hitIndex ? { ...barrier, hp: barrier.hp - 1 } : barrier,
      );
  }
  return { shots: nextShots, barriers: nextBarriers };
}

function resolveShotClashes(shots: InvaderShot[]): InvaderShot[] {
  const removed = new Set<number>();
  for (const [playerIndex, playerShot] of shots.entries()) {
    if (removed.has(playerIndex) || playerShot.owner !== "player") continue;
    for (const [alienIndex, alienShot] of shots.entries()) {
      if (removed.has(alienIndex) || alienShot.owner !== "alien") continue;
      if (!rectsOverlap(shotHitbox(playerShot), shotHitbox(alienShot))) continue;
      removed.add(playerIndex);
      removed.add(alienIndex);
      break;
    }
  }
  return shots.filter((_, index) => !removed.has(index));
}

function findAlienShotHit(
  shots: InvaderShot[],
  aliens: InvaderAlien[],
): { shotIndex: number; alienIndex: number } | null {
  for (const [shotIndex, shot] of shots.entries()) {
    if (shot.owner !== "player") continue;
    const alienIndex = firstHitIndex(shot, aliens, alienHitbox);
    if (alienIndex >= 0) return { shotIndex, alienIndex };
  }
  return null;
}

function firstHitIndex<T extends Rect>(
  shot: InvaderShot,
  rects: T[],
  hitbox: (rect: T) => Rect,
): number {
  const shotRect = shotHitbox(shot);
  const hits = rects
    .map((rect, index) => ({ index, rect }))
    .filter(({ rect }) => ("hp" in rect ? Number(rect.hp) > 0 : true))
    .filter(({ rect }) => ("alive" in rect ? Boolean(rect.alive) : true))
    .filter(({ rect }) => rectsOverlap(shotRect, hitbox(rect)));
  if (hits.length === 0) return -1;
  hits.sort((a, b) =>
    shot.vy < 0 ? b.rect.y + b.rect.height - (a.rect.y + a.rect.height) : a.rect.y - b.rect.y,
  );
  return hits[0]!.index;
}

function shotHitbox(shot: InvaderShot): Rect {
  const previousY = shot.y - shot.vy;
  const top = Math.min(previousY, shot.y) - invaderShotHeight / 2;
  const bottom = Math.max(previousY, shot.y) + invaderShotHeight / 2;
  return {
    x: shot.x - invaderShotWidth / 2,
    y: top,
    width: invaderShotWidth,
    height: bottom - top,
  };
}

function alienHitbox(alien: InvaderAlien): Rect {
  return insetRect(alien, 0.35, 0.25);
}

function playerHitbox(player: InvaderRect): Rect {
  return insetRect(player, 0.9, 0.2);
}

function barrierHitbox(barrier: InvaderBarrier): Rect {
  return insetRect(barrier, barrier.hp <= 1 ? 1.2 : 0.45, barrier.hp <= 1 ? 0.55 : 0.25);
}

function insetRect(rect: Rect, x: number, y: number): Rect {
  const width = Math.max(0, rect.width - x * 2);
  const height = Math.max(0, rect.height - y * 2);
  return { x: rect.x + x, y: rect.y + y, width, height };
}

function invaderPlayers(state: InvaderState): InvaderPlayer[] {
  if (state.players.length > 0) return state.players;
  return [{ ...state.player, id: "p1" }];
}

function withInvaderPlayers(state: InvaderState, players: InvaderPlayer[]): InvaderState {
  const normalized = players.length > 0 ? players : newInvaderPlayers(1);
  return { ...state, player: normalized[0]!, players: normalized };
}

function invaderShotPlayerId(shot: InvaderShot): InvaderPlayerId {
  return shot.playerId ?? "p1";
}

function chooseAlienShooter(aliens: InvaderAlien[], tick: number): InvaderAlien | undefined {
  const frontline = frontlineAliens(aliens);
  if (frontline.length === 0) return undefined;
  return frontline[tick % frontline.length];
}

function frontlineAliens(aliens: InvaderAlien[]): InvaderAlien[] {
  const byColumn = new Map<string, InvaderAlien>();
  for (const alien of aliens) {
    if (!alien.alive) continue;
    const key = (alien.x + alien.width / 2).toFixed(3);
    const current = byColumn.get(key);
    if (!current || alien.y > current.y) byColumn.set(key, alien);
  }
  return [...byColumn.values()].sort((a, b) => a.x - b.x);
}

function clearedAlienCount(aliens: InvaderAlien[]): number {
  return aliens.filter((alien) => !alien.alive).length;
}
