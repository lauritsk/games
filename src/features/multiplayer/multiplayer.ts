import * as v from "valibot";
import {
  normalizeMultiplayerCode,
  parseMultiplayerRoomStatus,
  parseMultiplayerSeat,
  type MultiplayerCreateResponse,
  type MultiplayerJoinResponse,
  type MultiplayerRoomSnapshot,
  type MultiplayerServerMessage,
  type MultiplayerSession,
  type MultiplayerSnapshotMessage,
  type MultiplayerSpectateResponse,
  type MultiplayerStatusResponse,
} from "@features/multiplayer/multiplayer-protocol";
import { requestApiJson } from "@shared/api-client";
import { onlineFeaturesEnabled } from "@shared/bundle-flags";
import { parseJsonSafely } from "@shared/json";
import {
  finiteNumberSchema,
  integerSchema,
  parseWithSchema,
  unknownRecordSchema,
} from "@shared/validation";

export type MultiplayerConnectionStatus = "connecting" | "connected" | "reconnecting" | "closed";

export type MultiplayerConnection = {
  sendAction(revision: number, action: unknown): void;
  requestStart(revision: number): void;
  requestRematch(revision: number): void;
  updateSettings(revision: number, settings: unknown): void;
  close(): void;
};

export type MultiplayerConnectionHandlers = {
  onSnapshot(message: MultiplayerSnapshotMessage): void;
  onError(error: string, room?: MultiplayerRoomSnapshot): void;
  onStatus(status: MultiplayerConnectionStatus): void;
};

const serverMessageBaseSchema = v.looseObject({ type: v.string() });
const roomBaseSchema = v.looseObject({
  code: v.string(),
  gameId: v.string(),
  status: v.unknown(),
  revision: integerSchema,
  seats: unknownRecordSchema,
  state: v.optional(v.unknown()),
  settings: v.optional(v.unknown()),
  countdownEndsAt: v.optional(v.unknown()),
  spectatorCount: v.optional(v.unknown()),
});
const seatBaseSchema = v.looseObject({
  joined: v.optional(v.unknown()),
  connected: v.optional(v.unknown()),
  ready: v.optional(v.unknown()),
});
const snapshotYouSchema = v.looseObject({
  playerId: v.optional(v.string(), ""),
  seat: v.optional(v.unknown()),
  role: v.optional(v.unknown()),
});

export async function fetchMultiplayerStatus(): Promise<MultiplayerStatusResponse> {
  if (!onlineFeaturesEnabled())
    return { ok: false, error: "Online features disabled in this build." };
  return requestApiJson<MultiplayerStatusResponse>(
    "/api/multiplayer/status",
    "Online multiplayer unavailable.",
  );
}

export async function createMultiplayerRoom(
  gameId: string,
  settings?: unknown,
): Promise<MultiplayerCreateResponse> {
  if (!onlineFeaturesEnabled())
    return { ok: false, error: "Online features disabled in this build." };
  return requestApiJson<MultiplayerCreateResponse>(
    "/api/multiplayer/rooms",
    "Online multiplayer unavailable.",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ gameId, ...(settings === undefined ? {} : { settings }) }),
    },
  );
}

export async function joinMultiplayerRoom(code: string): Promise<MultiplayerJoinResponse> {
  if (!onlineFeaturesEnabled())
    return { ok: false, error: "Online features disabled in this build." };
  return requestRoomCode<MultiplayerJoinResponse>("/api/multiplayer/rooms/join", code);
}

export async function spectateMultiplayerRoom(code: string): Promise<MultiplayerSpectateResponse> {
  if (!onlineFeaturesEnabled())
    return { ok: false, error: "Online features disabled in this build." };
  return requestRoomCode<MultiplayerSpectateResponse>("/api/multiplayer/rooms/spectate", code);
}

export function connectMultiplayerSession(
  session: MultiplayerSession,
  handlers: MultiplayerConnectionHandlers,
): MultiplayerConnection {
  if (!onlineFeaturesEnabled()) {
    handlers.onError("Online features disabled in this build.");
    handlers.onStatus("closed");
    const noop = (): void => undefined;
    return {
      sendAction: noop,
      requestStart: noop,
      requestRematch: noop,
      updateSettings: noop,
      close: noop,
    };
  }

  let socket: WebSocket | null = null;
  let closed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let attempts = 0;

  const clearReconnect = (): void => {
    if (reconnectTimer === null) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  };

  const connect = (): void => {
    clearReconnect();
    if (closed) return;
    handlers.onStatus(attempts === 0 ? "connecting" : "reconnecting");
    const url = socketUrl(session);
    socket = new WebSocket(url);
    socket.addEventListener("open", () => {
      attempts = 0;
      handlers.onStatus("connected");
    });
    socket.addEventListener("message", (event) => {
      const message = parseServerMessage(event.data);
      if (!message) {
        handlers.onError("Invalid server message");
        return;
      }
      if (message.type === "error") {
        handlers.onError(message.error, message.room);
        return;
      }
      handlers.onSnapshot({
        ...message,
        you: message.you.playerId
          ? message.you
          : { playerId: session.playerId, seat: session.seat, role: session.role },
      });
    });
    socket.addEventListener("close", () => {
      socket = null;
      if (closed) {
        handlers.onStatus("closed");
        return;
      }
      attempts += 1;
      handlers.onStatus("reconnecting");
      reconnectTimer = setTimeout(connect, Math.min(3000, 250 * attempts));
    });
    socket.addEventListener("error", () => {
      handlers.onError("Connection failed");
    });
  };

  const sendClientMessage = (message: unknown): void => {
    if (socket?.readyState !== WebSocket.OPEN) {
      handlers.onError("Not connected");
      return;
    }
    socket.send(JSON.stringify(message));
  };

  connect();

  return {
    sendAction(revision, action) {
      sendClientMessage({ type: "action", revision, action });
    },
    requestStart(revision) {
      sendClientMessage({ type: "start", revision });
    },
    requestRematch(revision) {
      sendClientMessage({ type: "rematch", revision });
    },
    updateSettings(revision, settings) {
      sendClientMessage({ type: "settings", revision, settings });
    },
    close() {
      closed = true;
      clearReconnect();
      socket?.close(1000, "Closed");
      socket = null;
      handlers.onStatus("closed");
    },
  };
}

function socketUrl(session: MultiplayerSession): string {
  const url = new URL("/api/multiplayer/socket", window.location.href);
  url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("code", session.code);
  url.searchParams.set("playerId", session.playerId);
  url.searchParams.set("token", session.playerToken);
  return url.toString();
}

function requestRoomCode<T extends { ok: boolean; error?: string }>(
  path: string,
  code: string,
): Promise<T> {
  return requestApiJson<T>(path, "Online multiplayer unavailable.", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: normalizeMultiplayerCode(code) }),
  });
}

function parseServerMessage(value: unknown): MultiplayerServerMessage | null {
  try {
    const parsedJson =
      typeof value === "string" ? parseJsonSafely(value) : { ok: true as const, value };
    if (!parsedJson.ok) return null;
    const message = parseWithSchema(serverMessageBaseSchema, parsedJson.value);
    if (!message) return null;
    if (message.type === "error" && typeof message.error === "string") {
      return { type: "error", error: message.error, room: parseRoom(message.room) ?? undefined };
    }
    if (message.type === "snapshot") {
      const room = parseRoom(message.room);
      if (!room) return null;
      return { type: "snapshot", room, you: parseSnapshotYou(message.you) };
    }
    return null;
  } catch {
    return null;
  }
}

function parseSnapshotYou(value: unknown): MultiplayerSnapshotMessage["you"] {
  const parsed = parseWithSchema(snapshotYouSchema, value);
  if (!parsed) return { playerId: "", seat: "p1" };
  return {
    playerId: parsed.playerId,
    seat: parseMultiplayerSeat(parsed.seat) ?? "p1",
    role: parsed.role === "spectator" ? "spectator" : "player",
  };
}

function parseRoom(value: unknown): MultiplayerRoomSnapshot | null {
  const parsed = parseWithSchema(roomBaseSchema, value);
  if (!parsed) return null;
  const p1 = parseSeat(parsed.seats.p1);
  const p2 = parseSeat(parsed.seats.p2);
  const p3 = parseSeat(parsed.seats.p3);
  const p4 = parseSeat(parsed.seats.p4);
  if (!p1 || !p2 || !p3 || !p4) return null;
  const countdownEndsAt = parseWithSchema(finiteNumberSchema, parsed.countdownEndsAt);
  const spectatorCount = parseWithSchema(integerSchema, parsed.spectatorCount);
  return {
    code: parsed.code,
    gameId: parsed.gameId,
    status: parseMultiplayerRoomStatus(parsed.status) ?? "lobby",
    revision: parsed.revision,
    seats: { p1, p2, p3, p4 },
    state: parsed.state,
    ...("settings" in parsed ? { settings: parsed.settings } : {}),
    ...(countdownEndsAt !== null ? { countdownEndsAt } : {}),
    ...(spectatorCount !== null ? { spectatorCount: Math.max(0, spectatorCount) } : {}),
  };
}

function parseSeat(value: unknown): { joined: boolean; connected: boolean; ready: boolean } | null {
  const parsed = parseWithSchema(seatBaseSchema, value);
  if (!parsed) return null;
  return {
    joined: parsed.joined === true,
    connected: parsed.connected === true,
    ready: parsed.ready === true,
  };
}
