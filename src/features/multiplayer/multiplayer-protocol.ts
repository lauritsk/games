import { parseWithSchema, picklistSchema } from "@shared/validation";

export type MultiplayerSeat = "p1" | "p2" | "p3" | "p4";
export type MultiplayerSessionRole = "player" | "spectator";
export type MultiplayerRoomStatus = "lobby" | "countdown" | "playing" | "finished";

export const multiplayerCodeAlphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const multiplayerCodeLength = 6;
export const multiplayerSeats = [
  "p1",
  "p2",
  "p3",
  "p4",
] as const satisfies readonly MultiplayerSeat[];

const multiplayerSeatSchema = picklistSchema(multiplayerSeats);
const multiplayerRoomStatusSchema = picklistSchema([
  "lobby",
  "countdown",
  "playing",
  "finished",
] as const);

export type MultiplayerSession = {
  code: string;
  gameId: string;
  playerId: string;
  playerToken: string;
  seat: MultiplayerSeat;
  role?: MultiplayerSessionRole;
};

export type MultiplayerSeatSnapshot = {
  joined: boolean;
  connected: boolean;
  ready?: boolean;
};

export type MultiplayerRoomSnapshot = {
  code: string;
  gameId: string;
  status: MultiplayerRoomStatus;
  revision: number;
  seats: Record<MultiplayerSeat, MultiplayerSeatSnapshot>;
  state: unknown;
  settings?: unknown;
  countdownEndsAt?: number;
  spectatorCount?: number;
};

export type MultiplayerSnapshotMessage = {
  type: "snapshot";
  you: { playerId: string; seat: MultiplayerSeat; role?: MultiplayerSessionRole };
  room: MultiplayerRoomSnapshot;
};

export type MultiplayerErrorMessage = {
  type: "error";
  error: string;
  room?: MultiplayerRoomSnapshot;
};

export type MultiplayerServerMessage = MultiplayerSnapshotMessage | MultiplayerErrorMessage;

export type MultiplayerActionMessage = {
  type: "action";
  revision: number;
  action: unknown;
};

export type MultiplayerRematchMessage = {
  type: "rematch";
  revision: number;
};

export type MultiplayerStartMessage = {
  type: "start";
  revision: number;
};

export type MultiplayerSettingsMessage = {
  type: "settings";
  revision: number;
  settings: unknown;
};

export type MultiplayerClientMessage =
  | MultiplayerActionMessage
  | MultiplayerRematchMessage
  | MultiplayerStartMessage
  | MultiplayerSettingsMessage;

export type MultiplayerCreateResponse =
  | { ok: true; session: MultiplayerSession }
  | MultiplayerApiError;
export type MultiplayerJoinResponse =
  | { ok: true; session: MultiplayerSession }
  | MultiplayerApiError;
export type MultiplayerSpectateResponse =
  | { ok: true; session: MultiplayerSession }
  | MultiplayerApiError;
export type MultiplayerStatusResponse = { ok: true } | MultiplayerApiError;

export type MultiplayerApiError = { ok: false; error: string };

export function normalizeMultiplayerCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function parseMultiplayerSeat(value: unknown): MultiplayerSeat | null {
  return parseWithSchema(multiplayerSeatSchema, value);
}

export function parseMultiplayerRoomStatus(value: unknown): MultiplayerRoomStatus | null {
  return parseWithSchema(multiplayerRoomStatusSchema, value);
}

export function emptyMultiplayerSeatSnapshots(): Record<MultiplayerSeat, MultiplayerSeatSnapshot> {
  return {
    p1: { joined: false, connected: false, ready: false },
    p2: { joined: false, connected: false, ready: false },
    p3: { joined: false, connected: false, ready: false },
    p4: { joined: false, connected: false, ready: false },
  };
}

export function multiplayerJoinedSeatCount(
  seats: Record<MultiplayerSeat, MultiplayerSeatSnapshot>,
): number {
  return multiplayerSeats.filter((seat) => seats[seat].joined).length;
}

export function multiplayerReadySeatCount(
  seats: Record<MultiplayerSeat, MultiplayerSeatSnapshot>,
): number {
  return multiplayerSeats.filter((seat) => seats[seat].joined && seats[seat].ready).length;
}

export function multiplayerRematchStatusText({
  result,
  localSeat,
  seats,
  minPlayers = 2,
  maxPlayers = 2,
}: {
  result: string;
  localSeat: MultiplayerSeat | null;
  seats: Record<MultiplayerSeat, MultiplayerSeatSnapshot>;
  minPlayers?: number;
  maxPlayers?: number;
}): string {
  const ready = multiplayerReadySeatCount(seats);
  if (localSeat !== "p1") return `${result} · ${ready} ready`;

  const activeSeats = multiplayerSeats.slice(0, maxPlayers);
  const joined = activeSeats.filter((seat) => seats[seat].joined).length;
  if (joined < minPlayers) return `${result} · Waiting for another player to join`;

  const connected = activeSeats.filter(
    (seat) => seats[seat].joined && seats[seat].connected,
  ).length;
  if (connected < minPlayers) return `${result} · Waiting for another player to reconnect`;

  const readyOthers = activeSeats.filter(
    (seat) => seat !== "p1" && seats[seat].joined && seats[seat].connected && seats[seat].ready,
  ).length;
  if (readyOthers < minPlayers - 1) {
    return `${result} · Waiting for another player to press rematch`;
  }

  return `${result} · Ready to start rematch`;
}

export function oppositeMultiplayerSeat(seat: MultiplayerSeat): MultiplayerSeat {
  if (seat === "p1") return "p2";
  if (seat === "p2") return "p1";
  return seat === "p3" ? "p4" : "p3";
}
