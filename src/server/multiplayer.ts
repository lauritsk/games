import type { ServerWebSocket } from "bun";
import {
  multiplayerCodeAlphabet,
  multiplayerCodeLength,
  multiplayerSeats,
  normalizeMultiplayerCode,
  type MultiplayerClientMessage,
  type MultiplayerRoomSnapshot,
  type MultiplayerSeat,
  type MultiplayerSession,
} from "../multiplayer-protocol";
import { isRecord } from "../validation";
import { checkRateLimit, rateLimitKey } from "./rate-limit";
import { multiplayerAdapterForGame, type MultiplayerAdapter } from "./multiplayer-games";

export type MultiplayerSocketData = {
  code: string;
  playerId: string;
  seat: MultiplayerSeat;
};

type PlayerState = {
  id: string;
  tokenHash: string;
  connectedCount: number;
};

type Room = {
  code: string;
  gameId: string;
  adapter: MultiplayerAdapter;
  status: "lobby" | "countdown" | "playing" | "finished";
  revision: number;
  countdownEndsAt: number | null;
  createdAt: number;
  lastActivityAt: number;
  players: Partial<Record<MultiplayerSeat, PlayerState>>;
  rematchReady: Partial<Record<MultiplayerSeat, boolean>>;
  sockets: Set<ServerWebSocket<MultiplayerSocketData>>;
  tickTimer: ReturnType<typeof setInterval> | null;
  countdownTimer: ReturnType<typeof setTimeout> | null;
  startSeats: MultiplayerSeat[] | null;
  state: unknown;
};

type UpgradePreparation =
  | { ok: true; data: MultiplayerSocketData }
  | { ok: false; response: Response };

const maxRooms = 500;
const lobbyTtlMs = 10 * 60_000;
const disconnectedTtlMs = 2 * 60_000;
const hardTtlMs = 24 * 60 * 60_000;
const maxRequestBytes = 10_000;
const defaultCountdownMs = 5000;

export type MultiplayerHubOptions = {
  countdownMs?: number;
};

export class MultiplayerHub {
  private readonly rooms = new Map<string, Room>();
  private readonly cleanupTimer: ReturnType<typeof setInterval>;
  private readonly countdownMs: number;

  constructor(options: MultiplayerHubOptions = {}) {
    this.countdownMs = options.countdownMs ?? defaultCountdownMs;
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
    this.cleanupTimer.unref?.();
  }

  dispose(): void {
    clearInterval(this.cleanupTimer);
    for (const room of this.rooms.values()) {
      this.stopRoomTicker(room);
      this.stopRoomCountdown(room);
    }
    this.rooms.clear();
  }

  async handleHttp(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/multiplayer")) return null;

    try {
      if (url.pathname === "/api/multiplayer/status" && request.method === "GET") {
        return json({ ok: true });
      }
      if (url.pathname === "/api/multiplayer/rooms" && request.method === "POST") {
        return this.handleCreateRoomRequest(request);
      }
      if (url.pathname === "/api/multiplayer/rooms/join" && request.method === "POST") {
        return this.handleJoinRoomRequest(request);
      }
      if (url.pathname === "/api/multiplayer/socket") {
        return json({ ok: false, error: "Upgrade required" }, 426);
      }
      return json({ ok: false, error: "Not found" }, 404);
    } catch {
      return json({ ok: false, error: "Request failed" }, 500);
    }
  }

  private async handleCreateRoomRequest(request: Request): Promise<Response> {
    if (
      !checkRateLimit(rateLimitKey(request, "multiplayer-create"), {
        windowMs: 60_000,
        max: 12,
      })
    ) {
      return json({ ok: false, error: "Too many requests" }, 429);
    }
    const body = await readSmallJson(request);
    const gameId = isRecord(body) && typeof body.gameId === "string" ? body.gameId : null;
    if (!gameId) return json({ ok: false, error: "Invalid room request" }, 400);
    const result = await this.createRoom(gameId);
    return json(result, result.ok ? 200 : 400);
  }

  private async handleJoinRoomRequest(request: Request): Promise<Response> {
    const body = await readSmallJson(request);
    const code = isRecord(body) && typeof body.code === "string" ? body.code : "";
    const normalized = normalizeMultiplayerCode(code);
    if (
      !checkRateLimit(rateLimitKey(request, `multiplayer-join:${normalized}`), {
        windowMs: 60_000,
        max: 20,
      })
    ) {
      return json({ ok: false, error: "Too many requests" }, 429);
    }
    const result = await this.joinRoom(normalized);
    return json(result, result.ok ? 200 : 400);
  }

  async createRoom(
    gameId: string,
  ): Promise<{ ok: true; session: MultiplayerSession } | { ok: false; error: string }> {
    this.cleanup();
    if (this.rooms.size >= maxRooms) return { ok: false, error: "Too many active rooms" };
    const adapter = multiplayerAdapterForGame(gameId);
    if (!adapter) return { ok: false, error: "Game does not support online play" };
    const code = this.createUniqueCode();
    if (!code) return { ok: false, error: "Could not create room" };
    const session = await this.createPlayerSession(code, gameId, "p1");
    const now = Date.now();
    this.rooms.set(code, {
      code,
      gameId,
      adapter,
      status: "lobby",
      revision: 0,
      countdownEndsAt: null,
      createdAt: now,
      lastActivityAt: now,
      players: {
        p1: {
          id: session.playerId,
          tokenHash: await hashToken(session.playerToken),
          connectedCount: 0,
        },
      },
      rematchReady: {},
      sockets: new Set(),
      tickTimer: null,
      countdownTimer: null,
      startSeats: null,
      state: adapter.newState(),
    });
    return { ok: true, session };
  }

  async joinRoom(
    code: string,
  ): Promise<{ ok: true; session: MultiplayerSession } | { ok: false; error: string }> {
    this.cleanup();
    const room = this.rooms.get(normalizeMultiplayerCode(code));
    if (!room || room.status !== "lobby") {
      return { ok: false, error: "Room not found or unavailable" };
    }
    const seat = nextOpenSeat(room);
    if (!seat) return { ok: false, error: "Room not found or unavailable" };

    const session = await this.createPlayerSession(room.code, room.gameId, seat);
    room.players[seat] = {
      id: session.playerId,
      tokenHash: await hashToken(session.playerToken),
      connectedCount: 0,
    };
    room.lastActivityAt = Date.now();

    if (room.adapter.autoStart !== false && joinedSeats(room).length >= minPlayers(room)) {
      const started = this.beginRoomCountdown(room);
      if (!started.ok) {
        delete room.players[seat];
        return { ok: false, error: started.error };
      }
    } else {
      room.revision += 1;
    }

    return { ok: true, session };
  }

  async prepareUpgrade(request: Request): Promise<UpgradePreparation> {
    const url = new URL(request.url);
    if (url.pathname !== "/api/multiplayer/socket") {
      return { ok: false, response: json({ ok: false, error: "Not found" }, 404) };
    }
    if (
      !checkRateLimit(rateLimitKey(request, "multiplayer-ws-auth"), { windowMs: 60_000, max: 60 })
    ) {
      return { ok: false, response: json({ ok: false, error: "Too many requests" }, 429) };
    }
    const code = normalizeMultiplayerCode(url.searchParams.get("code") ?? "");
    const playerId = url.searchParams.get("playerId") ?? "";
    const token = url.searchParams.get("token") ?? "";
    const room = this.rooms.get(code);
    if (!room) return { ok: false, response: json({ ok: false, error: "Room not found" }, 404) };
    const seat = findSeat(room, playerId);
    if (!seat) return { ok: false, response: json({ ok: false, error: "Unauthorized" }, 401) };
    const player = room.players[seat];
    if (!player || player.tokenHash !== (await hashToken(token))) {
      return { ok: false, response: json({ ok: false, error: "Unauthorized" }, 401) };
    }
    room.lastActivityAt = Date.now();
    return { ok: true, data: { code, playerId, seat } };
  }

  onOpen(ws: ServerWebSocket<MultiplayerSocketData>): void {
    const room = this.rooms.get(ws.data.code);
    const player = room?.players[ws.data.seat];
    if (!room || !player) {
      ws.close(1008, "Room unavailable");
      return;
    }
    player.connectedCount += 1;
    room.lastActivityAt = Date.now();
    room.sockets.add(ws);
    ws.subscribe(roomTopic(room.code));
    this.broadcastRoom(room, ws);
  }

  onMessage(ws: ServerWebSocket<MultiplayerSocketData>, message: string | Buffer): void {
    const room = this.rooms.get(ws.data.code);
    if (!room) {
      ws.close(1008, "Room unavailable");
      return;
    }
    if (
      !checkRateLimit(`multiplayer-action:${room.code}:${ws.data.playerId}`, {
        windowMs: 10_000,
        max: 50,
      })
    ) {
      this.sendError(ws, "Too many actions");
      return;
    }
    const parsed = parseClientMessage(message);
    if (!parsed) {
      this.sendError(ws, "Invalid message", room);
      return;
    }
    if (!isRevisionAccepted(room, parsed)) {
      this.sendError(ws, "Stale game state", room);
      return;
    }
    if (parsed.type === "start") {
      this.handleStart(ws, room);
      return;
    }
    if (parsed.type === "rematch") {
      this.handleRematch(ws, room);
      return;
    }
    if (room.status !== "playing") {
      this.sendError(ws, "Room is not ready", room);
      return;
    }
    const action = room.adapter.parseAction(parsed.action);
    if (!action) {
      this.sendError(ws, "Invalid action", room);
      return;
    }
    const result = room.adapter.applyAction(room.state, ws.data.seat, action);
    if (!result.ok) {
      this.sendError(ws, result.error, room);
      return;
    }
    room.state = result.state;
    room.revision += 1;
    room.lastActivityAt = Date.now();
    if (result.finished) {
      room.status = "finished";
      room.countdownEndsAt = null;
      this.stopRoomTicker(room);
    }
    this.publishRoom(ws, room);
  }

  onClose(ws: ServerWebSocket<MultiplayerSocketData>): void {
    const room = this.rooms.get(ws.data.code);
    const player = room?.players[ws.data.seat];
    if (!room || !player) return;
    room.sockets.delete(ws);
    player.connectedCount = Math.max(0, player.connectedCount - 1);
    room.lastActivityAt = Date.now();
    this.broadcastRoom(room);
  }

  private async createPlayerSession(
    code: string,
    gameId: string,
    seat: MultiplayerSeat,
  ): Promise<MultiplayerSession> {
    return {
      code,
      gameId,
      seat,
      playerId: crypto.randomUUID(),
      playerToken: randomToken(),
    };
  }

  private createUniqueCode(): string | null {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const code = randomCode();
      if (!this.rooms.has(code)) return code;
    }
    return null;
  }

  private publicRoom(room: Room): MultiplayerRoomSnapshot {
    return {
      code: room.code,
      gameId: room.gameId,
      status: room.status,
      revision: room.revision,
      seats: {
        p1: seatSnapshot(room.players.p1, room.rematchReady.p1),
        p2: seatSnapshot(room.players.p2, room.rematchReady.p2),
        p3: seatSnapshot(room.players.p3, room.rematchReady.p3),
        p4: seatSnapshot(room.players.p4, room.rematchReady.p4),
      },
      state: room.adapter.publicSnapshot(room.state),
      ...(room.countdownEndsAt ? { countdownEndsAt: room.countdownEndsAt } : {}),
    };
  }

  private snapshotMessage(room: Room, data: MultiplayerSocketData) {
    return {
      type: "snapshot" as const,
      you: { playerId: data.playerId, seat: data.seat },
      room: this.publicRoom(room),
    };
  }

  private publishRoom(ws: ServerWebSocket<MultiplayerSocketData>, room: Room): void {
    this.broadcastRoom(room, ws);
  }

  private broadcastRoom(room: Room, fallback?: ServerWebSocket<MultiplayerSocketData>): void {
    const sent = new Set<ServerWebSocket<MultiplayerSocketData>>();
    for (const socket of room.sockets) {
      socket.send(JSON.stringify(this.snapshotMessage(room, socket.data)));
      sent.add(socket);
    }
    if (fallback && !sent.has(fallback)) {
      fallback.send(JSON.stringify(this.snapshotMessage(room, fallback.data)));
    }
  }

  private sendError(ws: ServerWebSocket<MultiplayerSocketData>, error: string, room?: Room): void {
    ws.send(
      JSON.stringify({ type: "error", error, ...(room ? { room: this.publicRoom(room) } : {}) }),
    );
  }

  private handleStart(ws: ServerWebSocket<MultiplayerSocketData>, room: Room): void {
    if (ws.data.seat !== "p1") {
      this.sendError(ws, "Only the host can start", room);
      return;
    }
    if (room.status !== "lobby") {
      this.sendError(ws, "Room is not in the lobby", room);
      return;
    }
    const started = this.beginRoomCountdown(room);
    if (!started.ok) {
      this.sendError(ws, started.error, room);
      return;
    }
    this.publishRoom(ws, room);
  }

  private handleRematch(ws: ServerWebSocket<MultiplayerSocketData>, room: Room): void {
    if (room.status !== "finished") {
      this.sendError(ws, "Rematch is available after the game ends", room);
      return;
    }

    const alreadyReady = room.rematchReady[ws.data.seat] === true;
    room.rematchReady[ws.data.seat] = true;
    room.lastActivityAt = Date.now();

    const readySeats = connectedReadySeats(room);
    if (ws.data.seat !== "p1") {
      if (!alreadyReady) room.revision += 1;
      this.publishRoom(ws, room);
      return;
    }
    if (readySeats.length < minPlayers(room)) {
      if (!alreadyReady) room.revision += 1;
      this.broadcastRoom(room);
      this.sendError(ws, "Waiting for another player to ready", room);
      return;
    }

    room.state = room.adapter.newState();
    const started = this.beginRoomCountdown(room, readySeats);
    if (!started.ok) {
      this.sendError(ws, started.error, room);
      return;
    }
    this.publishRoom(ws, room);
  }

  private beginRoomCountdown(
    room: Room,
    startSeats = joinedSeats(room),
  ): { ok: true } | { ok: false; error: string } {
    if (startSeats.length < minPlayers(room)) return { ok: false, error: "Need more players" };
    this.stopRoomTicker(room);
    this.stopRoomCountdown(room);
    room.startSeats = [...startSeats];
    if (this.countdownMs <= 0) return this.startRoom(room);
    room.status = "countdown";
    room.countdownEndsAt = Date.now() + this.countdownMs;
    room.revision += 1;
    room.lastActivityAt = Date.now();
    room.countdownTimer = setTimeout(() => this.completeRoomStart(room.code), this.countdownMs);
    room.countdownTimer.unref?.();
    return { ok: true };
  }

  private completeRoomStart(code: string): void {
    const room = this.rooms.get(code);
    if (!room || room.status !== "countdown") return;
    const result = this.startRoom(room);
    if (!result.ok) {
      room.status = "lobby";
      room.countdownEndsAt = null;
      room.startSeats = null;
      room.revision += 1;
      room.lastActivityAt = Date.now();
    }
    this.broadcastRoom(room);
  }

  private startRoom(room: Room): { ok: true } | { ok: false; error: string } {
    const seats = room.startSeats ?? joinedSeats(room);
    if (seats.length < minPlayers(room)) {
      room.startSeats = null;
      return { ok: false, error: "Need more players" };
    }
    const result = room.adapter.start
      ? room.adapter.start(room.state, seats)
      : ({ ok: true, state: room.adapter.newState() } as const);
    if (!result.ok) {
      room.startSeats = null;
      return { ok: false, error: result.error };
    }
    room.state = result.state;
    room.status = "playing";
    room.countdownEndsAt = null;
    room.countdownTimer = null;
    room.startSeats = null;
    room.rematchReady = {};
    room.revision += 1;
    room.lastActivityAt = Date.now();
    this.startRoomTicker(room);
    return { ok: true };
  }

  private startRoomTicker(room: Room): void {
    this.stopRoomTicker(room);
    if (!room.adapter.tick || !room.adapter.tickMs) return;
    room.tickTimer = setInterval(() => this.tickRoom(room.code), room.adapter.tickMs);
    room.tickTimer.unref?.();
  }

  private stopRoomTicker(room: Room): void {
    if (!room.tickTimer) return;
    clearInterval(room.tickTimer);
    room.tickTimer = null;
  }

  private stopRoomCountdown(room: Room): void {
    if (!room.countdownTimer) return;
    clearTimeout(room.countdownTimer);
    room.countdownTimer = null;
    room.countdownEndsAt = null;
    room.startSeats = null;
  }

  private tickRoom(code: string): void {
    const room = this.rooms.get(code);
    if (!room || room.status !== "playing" || !room.adapter.tick) return;
    const result = room.adapter.tick(room.state);
    if (!result) return;
    if (!result.ok) {
      this.stopRoomTicker(room);
      return;
    }
    room.state = result.state;
    room.revision += 1;
    room.lastActivityAt = Date.now();
    if (result.finished) {
      room.status = "finished";
      room.countdownEndsAt = null;
      this.stopRoomTicker(room);
    }
    this.broadcastRoom(room);
  }

  private cleanup(now = Date.now()): void {
    for (const [code, room] of this.rooms) {
      const age = now - room.createdAt;
      const idle = now - room.lastActivityAt;
      const connected = Object.values(room.players).some(
        (player) => (player?.connectedCount ?? 0) > 0,
      );
      if (age > hardTtlMs) this.deleteRoom(code);
      else if (room.status === "lobby" && idle > lobbyTtlMs) this.deleteRoom(code);
      else if (!connected && idle > disconnectedTtlMs) this.deleteRoom(code);
    }
  }

  private deleteRoom(code: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    this.stopRoomTicker(room);
    this.stopRoomCountdown(room);
    this.rooms.delete(code);
  }
}

function parseClientMessage(message: string | Buffer): MultiplayerClientMessage | null {
  try {
    const value = JSON.parse(typeof message === "string" ? message : message.toString()) as unknown;
    if (!isRecord(value) || typeof value.revision !== "number") return null;
    if (!Number.isInteger(value.revision)) return null;
    if (value.type === "start") return { type: "start", revision: value.revision };
    if (value.type === "rematch") return { type: "rematch", revision: value.revision };
    if (value.type === "action") {
      return { type: "action", revision: value.revision, action: value.action };
    }
    return null;
  } catch {
    return null;
  }
}

function isRevisionAccepted(room: Room, message: MultiplayerClientMessage): boolean {
  if (message.type === "action" && room.adapter.acceptStaleActions)
    return message.revision <= room.revision;
  return message.revision === room.revision;
}

function findSeat(room: Room, playerId: string): MultiplayerSeat | null {
  return multiplayerSeats.find((seat) => room.players[seat]?.id === playerId) ?? null;
}

function joinedSeats(room: Room): MultiplayerSeat[] {
  return multiplayerSeats.slice(0, maxPlayers(room)).filter((seat) => Boolean(room.players[seat]));
}

function nextOpenSeat(room: Room): MultiplayerSeat | null {
  return multiplayerSeats.slice(0, maxPlayers(room)).find((seat) => !room.players[seat]) ?? null;
}

function minPlayers(room: Room): number {
  return Math.max(2, Math.min(maxPlayers(room), room.adapter.minPlayers ?? 2));
}

function maxPlayers(room: Room): number {
  return Math.max(2, Math.min(multiplayerSeats.length, room.adapter.maxPlayers ?? 2));
}

function connectedReadySeats(room: Room): MultiplayerSeat[] {
  return joinedSeats(room).filter(
    (seat) => room.rematchReady[seat] === true && (room.players[seat]?.connectedCount ?? 0) > 0,
  );
}

function seatSnapshot(player: PlayerState | undefined, ready = false) {
  return { joined: Boolean(player), connected: (player?.connectedCount ?? 0) > 0, ready };
}

function roomTopic(code: string): string {
  return `multiplayer:${code}`;
}

function randomCode(): string {
  const bytes = new Uint8Array(multiplayerCodeLength);
  crypto.getRandomValues(bytes);
  return Array.from(
    bytes,
    (byte) => multiplayerCodeAlphabet[byte % multiplayerCodeAlphabet.length],
  ).join("");
}

function randomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readSmallJson(request: Request): Promise<unknown> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > maxRequestBytes) return null;
  try {
    return (await request.json()) as unknown;
  } catch {
    return null;
  }
}

function json(value: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json;charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}
