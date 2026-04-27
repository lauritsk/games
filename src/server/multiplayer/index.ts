import type { ServerWebSocket } from "bun";
import {
  mapMultiplayerSeats,
  multiplayerCodeAlphabet,
  multiplayerCodeLength,
  multiplayerSeats,
  normalizeMultiplayerCode,
  type MultiplayerActionMessage,
  type MultiplayerClientMessage,
  type MultiplayerRoomSnapshot,
  type MultiplayerSeat,
  type MultiplayerSession,
  type MultiplayerSessionRole,
} from "@features/multiplayer/multiplayer-protocol";
import { parseJsonSafely } from "@shared/json";
import { parseWithSchema } from "@shared/validation";
import { readLimitedJson } from "@server/http";
import { checkRateLimit, checkRequestRateLimit } from "@server/rate-limit";
import {
  apiError,
  apiJson,
  clientMessageSchema,
  createMultiplayerRoomRequestSchema,
  multiplayerSessionResponseSchema,
  multiplayerStatusResponseSchema,
  roomCodeRequestSchema,
  tooManyRequests,
} from "@server/api-contract";
import {
  multiplayerAdapterForGame,
  type MultiplayerAdapter,
  type MultiplayerApplyResult,
} from "@server/multiplayer/games";

export type MultiplayerSocketData = {
  code: string;
  playerId: string;
  seat: MultiplayerSeat;
  role?: MultiplayerSessionRole;
};

type ParticipantState = {
  id: string;
  tokenHash: string;
  connectedCount: number;
};

type PlayerState = ParticipantState;
type SpectatorState = ParticipantState;

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
  spectators: Map<string, SpectatorState>;
  rematchReady: Partial<Record<MultiplayerSeat, boolean>>;
  sockets: Set<ServerWebSocket<MultiplayerSocketData>>;
  tickTimer: ReturnType<typeof setInterval> | null;
  countdownTimer: ReturnType<typeof setTimeout> | null;
  startSeats: MultiplayerSeat[] | null;
  state: unknown;
  settings: unknown;
};

type UpgradePreparation =
  | { ok: true; data: MultiplayerSocketData }
  | { ok: false; response: Response };

type MultiplayerSessionResult =
  | { ok: true; session: MultiplayerSession }
  | { ok: false; error: string };

const maxRooms = 500;
const maxSpectatorsPerRoom = 32;
const lobbyTtlMs = 10 * 60_000;
const disconnectedTtlMs = 2 * 60_000;
const hardTtlMs = 24 * 60 * 60_000;
const maxRequestBytes = 10_000;
const defaultCountdownMs = 3000;

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
        return apiJson(multiplayerStatusResponseSchema, { ok: true });
      }
      if (url.pathname === "/api/multiplayer/rooms" && request.method === "POST") {
        return this.handleCreateRoomRequest(request);
      }
      if (url.pathname === "/api/multiplayer/rooms/join" && request.method === "POST") {
        return this.handleJoinRoomRequest(request);
      }
      if (url.pathname === "/api/multiplayer/rooms/spectate" && request.method === "POST") {
        return this.handleSpectateRoomRequest(request);
      }
      if (url.pathname === "/api/multiplayer/socket") {
        return apiError("Upgrade required", 426);
      }
      return apiError("Not found", 404);
    } catch {
      return apiError("Request failed", 500);
    }
  }

  private async handleCreateRoomRequest(request: Request): Promise<Response> {
    if (!checkRequestRateLimit(request, "multiplayer-create", { windowMs: 60_000, max: 12 })) {
      return tooManyRequests();
    }
    const body = parseWithSchema(createMultiplayerRoomRequestSchema, await readSmallJson(request));
    if (!body) return apiError("Invalid room request", 400);
    return multiplayerSessionJson(await this.createRoom(body.gameId, body.settings));
  }

  private handleJoinRoomRequest(request: Request): Promise<Response> {
    return this.handleRoomCodeRequest(request, "multiplayer-join", 20, (code) =>
      this.joinRoom(code),
    );
  }

  private handleSpectateRoomRequest(request: Request): Promise<Response> {
    return this.handleRoomCodeRequest(request, "multiplayer-spectate", 30, (code) =>
      this.spectateRoom(code),
    );
  }

  private async handleRoomCodeRequest(
    request: Request,
    rateLimitPrefix: string,
    rateLimitMax: number,
    enterRoom: (code: string) => Promise<MultiplayerSessionResult>,
  ): Promise<Response> {
    const body = parseWithSchema(roomCodeRequestSchema, await readSmallJson(request));
    const normalized = normalizeMultiplayerCode(body?.code ?? "");
    if (
      !checkRequestRateLimit(request, `${rateLimitPrefix}:${normalized}`, {
        windowMs: 60_000,
        max: rateLimitMax,
      })
    ) {
      return tooManyRequests();
    }
    return multiplayerSessionJson(await enterRoom(normalized));
  }

  async createRoom(gameId: string, requestedSettings?: unknown): Promise<MultiplayerSessionResult> {
    this.cleanup();
    if (this.rooms.size >= maxRooms) return { ok: false, error: "Too many active rooms" };
    const adapter = multiplayerAdapterForGame(gameId);
    if (!adapter) return { ok: false, error: "Game does not support online play" };
    const settings = resolveAdapterSettings(adapter, requestedSettings);
    if (!settings.ok) return { ok: false, error: settings.error };
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
        p1: await this.createParticipantState(session),
      },
      spectators: new Map(),
      rematchReady: {},
      sockets: new Set(),
      tickTimer: null,
      countdownTimer: null,
      startSeats: null,
      state: adapter.newState(settings.value),
      settings: settings.value,
    });
    return { ok: true, session };
  }

  async joinRoom(code: string): Promise<MultiplayerSessionResult> {
    this.cleanup();
    const room = this.rooms.get(normalizeMultiplayerCode(code));
    if (!room || room.status !== "lobby") {
      return { ok: false, error: "Room not found or unavailable" };
    }
    const seat = nextOpenSeat(room);
    if (!seat) return { ok: false, error: "Room not found or unavailable" };

    const session = await this.createPlayerSession(room.code, room.gameId, seat);
    room.players[seat] = await this.createParticipantState(session);
    room.lastActivityAt = Date.now();
    room.revision += 1;

    return { ok: true, session };
  }

  async spectateRoom(code: string): Promise<MultiplayerSessionResult> {
    this.cleanup();
    const room = this.rooms.get(normalizeMultiplayerCode(code));
    if (!room) return { ok: false, error: "Room not found or unavailable" };
    if (room.spectators.size >= maxSpectatorsPerRoom) {
      return { ok: false, error: "Room has too many spectators" };
    }

    const session = await this.createPlayerSession(room.code, room.gameId, "p1", "spectator");
    room.spectators.set(session.playerId, await this.createParticipantState(session));
    room.lastActivityAt = Date.now();

    return { ok: true, session };
  }

  async prepareUpgrade(request: Request): Promise<UpgradePreparation> {
    const url = new URL(request.url);
    if (url.pathname !== "/api/multiplayer/socket") {
      return { ok: false, response: apiError("Not found", 404) };
    }
    if (!checkRequestRateLimit(request, "multiplayer-ws-auth", { windowMs: 60_000, max: 60 })) {
      return { ok: false, response: tooManyRequests() };
    }
    const code = normalizeMultiplayerCode(url.searchParams.get("code") ?? "");
    const playerId = url.searchParams.get("playerId") ?? "";
    const token = url.searchParams.get("token") ?? "";
    const room = this.rooms.get(code);
    if (!room) return { ok: false, response: apiError("Room not found", 404) };
    const seat = findSeat(room, playerId);
    if (seat) {
      const player = room.players[seat];
      if (!player || player.tokenHash !== (await hashToken(token))) {
        return { ok: false, response: apiError("Unauthorized", 401) };
      }
      room.lastActivityAt = Date.now();
      return { ok: true, data: { code, playerId, seat, role: "player" } };
    }
    const spectator = room.spectators.get(playerId);
    if (!spectator || spectator.tokenHash !== (await hashToken(token))) {
      return { ok: false, response: apiError("Unauthorized", 401) };
    }
    room.lastActivityAt = Date.now();
    return { ok: true, data: { code, playerId, seat: "p1", role: "spectator" } };
  }

  onOpen(ws: ServerWebSocket<MultiplayerSocketData>): void {
    const room = this.rooms.get(ws.data.code);
    if (!room) {
      ws.close(1008, "Room unavailable");
      return;
    }
    const participant = participantState(room, ws.data);
    if (!participant) {
      ws.close(1008, "Room unavailable");
      return;
    }
    participant.connectedCount += 1;
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
    if (!this.canAcceptPlayerMessage(ws, room)) return;

    const parsed = parseClientMessage(message);
    if (!parsed) {
      this.sendError(ws, "Invalid message", room);
      return;
    }
    if (!isRevisionAccepted(room, parsed)) {
      this.sendError(ws, "Stale game state", room);
      return;
    }
    this.handleClientMessage(ws, room, parsed);
  }

  private canAcceptPlayerMessage(ws: ServerWebSocket<MultiplayerSocketData>, room: Room): boolean {
    if (
      !checkRateLimit(`multiplayer-action:${room.code}:${ws.data.playerId}`, {
        windowMs: 10_000,
        max: 50,
      })
    ) {
      this.sendError(ws, "Too many actions");
      return false;
    }
    if (ws.data.role === "spectator") {
      this.sendError(ws, "Spectators cannot act", room);
      return false;
    }
    return true;
  }

  private handleClientMessage(
    ws: ServerWebSocket<MultiplayerSocketData>,
    room: Room,
    message: MultiplayerClientMessage,
  ): void {
    if (message.type === "start") {
      this.handleStart(ws, room);
      return;
    }
    if (message.type === "rematch") {
      this.handleRematch(ws, room);
      return;
    }
    if (message.type === "settings") {
      this.handleSettings(ws, room, message.settings);
      return;
    }
    this.handleAction(ws, room, message);
  }

  private handleAction(
    ws: ServerWebSocket<MultiplayerSocketData>,
    room: Room,
    message: MultiplayerActionMessage,
  ): void {
    if (room.status !== "playing") {
      this.sendError(ws, "Room is not ready", room);
      return;
    }
    const action = room.adapter.parseAction(message.action);
    if (!action) {
      this.sendError(ws, "Invalid action", room);
      return;
    }
    const result = room.adapter.applyAction(room.state, ws.data.seat, action);
    if (!result.ok) {
      this.sendError(ws, result.error, room);
      return;
    }
    this.applyRoomResult(room, result);
    this.broadcastRoom(room, ws);
  }

  onClose(ws: ServerWebSocket<MultiplayerSocketData>): void {
    const room = this.rooms.get(ws.data.code);
    if (!room) return;
    const participant = participantState(room, ws.data);
    if (!participant) return;
    room.sockets.delete(ws);
    participant.connectedCount = Math.max(0, participant.connectedCount - 1);
    if (ws.data.role === "spectator" && participant.connectedCount === 0) {
      room.spectators.delete(ws.data.playerId);
    }
    room.lastActivityAt = Date.now();
    this.broadcastRoom(room);
  }

  private async createPlayerSession(
    code: string,
    gameId: string,
    seat: MultiplayerSeat,
    role: MultiplayerSessionRole = "player",
  ): Promise<MultiplayerSession> {
    return {
      code,
      gameId,
      seat,
      playerId: crypto.randomUUID(),
      playerToken: randomToken(),
      ...(role === "spectator" ? { role } : {}),
    };
  }

  private async createParticipantState(
    session: Pick<MultiplayerSession, "playerId" | "playerToken">,
  ): Promise<ParticipantState> {
    return {
      id: session.playerId,
      tokenHash: await hashToken(session.playerToken),
      connectedCount: 0,
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
      seats: roomSeatSnapshots(room),
      state: room.adapter.publicSnapshot(room.state),
      settings: room.settings,
      spectatorCount: connectedSpectatorCount(room),
      ...(room.countdownEndsAt ? { countdownEndsAt: room.countdownEndsAt } : {}),
    };
  }

  private snapshotMessage(room: Room, data?: MultiplayerSocketData) {
    return {
      type: "snapshot" as const,
      ...(data
        ? { you: { playerId: data.playerId, seat: data.seat, role: data.role ?? "player" } }
        : {}),
      room: this.publicRoom(room),
    };
  }

  private broadcastRoom(room: Room, fallback?: ServerWebSocket<MultiplayerSocketData>): void {
    const publisher = fallback ?? room.sockets.values().next().value;
    if (publisher && canPublishTopic(publisher)) {
      publisher.publishText(roomTopic(room.code), JSON.stringify(this.snapshotMessage(room)));
      return;
    }

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
    this.broadcastRoom(room, ws);
  }

  private handleSettings(
    ws: ServerWebSocket<MultiplayerSocketData>,
    room: Room,
    requestedSettings: unknown,
  ): void {
    if (ws.data.seat !== "p1") {
      this.sendError(ws, "Only the host can change settings", room);
      return;
    }
    if (room.status !== "lobby") {
      this.sendError(ws, "Settings can only change in the lobby", room);
      return;
    }
    const settings = resolveAdapterSettings(room.adapter, requestedSettings);
    if (!settings.ok) {
      this.sendError(ws, settings.error, room);
      return;
    }
    room.settings = settings.value;
    room.state = room.adapter.newState(settings.value);
    room.rematchReady = {};
    room.revision += 1;
    room.lastActivityAt = Date.now();
    this.broadcastRoom(room, ws);
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
      this.broadcastRoom(room, ws);
      return;
    }
    if (readySeats.length < minPlayers(room)) {
      if (!alreadyReady) room.revision += 1;
      this.broadcastRoom(room);
      this.sendError(ws, "Waiting for another player to ready", room);
      return;
    }

    room.state = room.adapter.newState(room.settings);
    const started = this.beginRoomCountdown(room, readySeats);
    if (!started.ok) {
      this.sendError(ws, started.error, room);
      return;
    }
    this.broadcastRoom(room, ws);
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
      ? room.adapter.start(room.state, seats, room.settings)
      : ({ ok: true, state: room.adapter.newState(room.settings) } as const);
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
    if (!room.adapter.tick) return;
    const tickMs = room.adapter.tickIntervalMs?.(room.state) ?? room.adapter.tickMs;
    if (!tickMs) return;
    room.tickTimer = setInterval(() => this.tickRoom(room.code), tickMs);
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
    this.applyRoomResult(room, result);
    this.broadcastRoom(room);
  }

  private applyRoomResult(
    room: Room,
    result: Extract<MultiplayerApplyResult<unknown>, { ok: true }>,
  ): void {
    room.state = result.state;
    room.revision += 1;
    room.lastActivityAt = Date.now();
    if (result.finished) this.finishRoom(room);
  }

  private finishRoom(room: Room): void {
    room.status = "finished";
    room.countdownEndsAt = null;
    this.stopRoomTicker(room);
  }

  private cleanup(now = Date.now()): void {
    for (const [code, room] of this.rooms) {
      const age = now - room.createdAt;
      const idle = now - room.lastActivityAt;
      const connected =
        Object.values(room.players).some((player) => (player?.connectedCount ?? 0) > 0) ||
        connectedSpectatorCount(room) > 0;
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

function multiplayerSessionJson(result: MultiplayerSessionResult): Response {
  return apiJson(multiplayerSessionResponseSchema, result, result.ok ? 200 : 400);
}

function parseClientMessage(message: string | Buffer): MultiplayerClientMessage | null {
  const parsedJson = parseJsonSafely(typeof message === "string" ? message : message.toString());
  return parsedJson.ok ? parseWithSchema(clientMessageSchema, parsedJson.value) : null;
}

function isRevisionAccepted(room: Room, message: MultiplayerClientMessage): boolean {
  if (message.type === "action" && room.adapter.acceptStaleActions)
    return message.revision <= room.revision;
  return message.revision === room.revision;
}

function resolveAdapterSettings(
  adapter: MultiplayerAdapter,
  requestedSettings: unknown,
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (requestedSettings === undefined) return { ok: true, value: adapter.defaultSettings?.() };
  if (!adapter.parseSettings) return { ok: false, error: "Game does not support settings" };
  const settings = adapter.parseSettings(requestedSettings);
  if (!settings) return { ok: false, error: "Invalid game settings" };
  return { ok: true, value: settings };
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

function participantState(
  room: Room,
  data: MultiplayerSocketData,
): PlayerState | SpectatorState | undefined {
  if (data.role === "spectator") return room.spectators.get(data.playerId);
  return room.players[data.seat];
}

function connectedSpectatorCount(room: Room): number {
  return [...room.spectators.values()].filter((spectator) => spectator.connectedCount > 0).length;
}

function roomSeatSnapshots(room: Room): MultiplayerRoomSnapshot["seats"] {
  return mapMultiplayerSeats((seat) => seatSnapshot(room.players[seat], room.rematchReady[seat]));
}

function seatSnapshot(player: PlayerState | undefined, ready = false) {
  return { joined: Boolean(player), connected: (player?.connectedCount ?? 0) > 0, ready };
}

function roomTopic(code: string): string {
  return `multiplayer:${code}`;
}

function canPublishTopic(ws: ServerWebSocket<MultiplayerSocketData>): boolean {
  return Array.isArray(ws.subscriptions) && ws.isSubscribed(roomTopic(ws.data.code));
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
  return readLimitedJson(request, maxRequestBytes);
}
