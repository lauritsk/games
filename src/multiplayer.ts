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
  type MultiplayerStatusResponse,
} from "./multiplayer-protocol";
import { isRecord } from "./validation";

export type MultiplayerConnectionStatus = "connecting" | "connected" | "reconnecting" | "closed";

export type MultiplayerConnection = {
  sendAction(revision: number, action: unknown): void;
  requestRematch(revision: number): void;
  close(): void;
};

export type MultiplayerConnectionHandlers = {
  onSnapshot(message: MultiplayerSnapshotMessage): void;
  onError(error: string, room?: MultiplayerRoomSnapshot): void;
  onStatus(status: MultiplayerConnectionStatus): void;
};

export async function fetchMultiplayerStatus(): Promise<MultiplayerStatusResponse> {
  return requestJson<MultiplayerStatusResponse>("/api/multiplayer/status");
}

export async function createMultiplayerRoom(gameId: string): Promise<MultiplayerCreateResponse> {
  return requestJson<MultiplayerCreateResponse>("/api/multiplayer/rooms", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ gameId }),
  });
}

export async function joinMultiplayerRoom(code: string): Promise<MultiplayerJoinResponse> {
  return requestJson<MultiplayerJoinResponse>("/api/multiplayer/rooms/join", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: normalizeMultiplayerCode(code) }),
  });
}

export function connectMultiplayerSession(
  session: MultiplayerSession,
  handlers: MultiplayerConnectionHandlers,
): MultiplayerConnection {
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
          : { playerId: session.playerId, seat: session.seat },
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
    requestRematch(revision) {
      sendClientMessage({ type: "rematch", revision });
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

async function requestJson<T extends { ok: boolean; error?: string }>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  try {
    const response = await fetch(input, { cache: "no-store", ...init });
    const value = (await response.json()) as unknown;
    if (isApiResponse(value)) return value as T;
    return { ok: false, error: "Online multiplayer unavailable." } as T;
  } catch {
    return { ok: false, error: "Online multiplayer unavailable." } as T;
  }
}

function parseServerMessage(value: unknown): MultiplayerServerMessage | null {
  try {
    const parsed = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
    if (!isRecord(parsed) || typeof parsed.type !== "string") return null;
    if (parsed.type === "error" && typeof parsed.error === "string") {
      return { type: "error", error: parsed.error, room: parseRoom(parsed.room) ?? undefined };
    }
    if (parsed.type === "snapshot") {
      const room = parseRoom(parsed.room);
      if (!room) return null;
      const you = isRecord(parsed.you)
        ? {
            playerId: typeof parsed.you.playerId === "string" ? parsed.you.playerId : "",
            seat: parseMultiplayerSeat(parsed.you.seat) ?? "p1",
          }
        : undefined;
      return { type: "snapshot", room, you: you ?? { playerId: "", seat: "p1" } };
    }
    return null;
  } catch {
    return null;
  }
}

function parseRoom(value: unknown): MultiplayerRoomSnapshot | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.code !== "string" ||
    typeof value.gameId !== "string" ||
    typeof value.status !== "string" ||
    typeof value.revision !== "number" ||
    !isRecord(value.seats)
  ) {
    return null;
  }
  const p1 = parseSeat(value.seats.p1);
  const p2 = parseSeat(value.seats.p2);
  if (!p1 || !p2) return null;
  return {
    code: value.code,
    gameId: value.gameId,
    status: parseMultiplayerRoomStatus(value.status) ?? "lobby",
    revision: value.revision,
    seats: { p1, p2 },
    state: value.state,
  };
}

function parseSeat(value: unknown): { joined: boolean; connected: boolean } | null {
  if (!isRecord(value)) return null;
  return { joined: value.joined === true, connected: value.connected === true };
}

function isApiResponse(value: unknown): value is { ok: boolean; error?: string } {
  return isRecord(value) && typeof value.ok === "boolean";
}
