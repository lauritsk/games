export type MultiplayerSeat = "p1" | "p2";
export type MultiplayerRoomStatus = "lobby" | "playing" | "finished";

export const multiplayerCodeAlphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const multiplayerCodeLength = 6;
export const multiplayerSeats = ["p1", "p2"] as const satisfies readonly MultiplayerSeat[];

export type MultiplayerSession = {
  code: string;
  gameId: string;
  playerId: string;
  playerToken: string;
  seat: MultiplayerSeat;
};

export type MultiplayerSeatSnapshot = {
  joined: boolean;
  connected: boolean;
};

export type MultiplayerRoomSnapshot = {
  code: string;
  gameId: string;
  status: MultiplayerRoomStatus;
  revision: number;
  seats: Record<MultiplayerSeat, MultiplayerSeatSnapshot>;
  state: unknown;
};

export type MultiplayerSnapshotMessage = {
  type: "snapshot";
  you: { playerId: string; seat: MultiplayerSeat };
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

export type MultiplayerClientMessage = MultiplayerActionMessage;

export type MultiplayerCreateResponse =
  | { ok: true; session: MultiplayerSession }
  | MultiplayerApiError;
export type MultiplayerJoinResponse =
  | { ok: true; session: MultiplayerSession }
  | MultiplayerApiError;
export type MultiplayerStatusResponse = { ok: true } | MultiplayerApiError;

export type MultiplayerApiError = { ok: false; error: string };

export function normalizeMultiplayerCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function isMultiplayerSeat(value: unknown): value is MultiplayerSeat {
  return typeof value === "string" && multiplayerSeats.includes(value as MultiplayerSeat);
}

export function parseMultiplayerSeat(value: unknown): MultiplayerSeat | null {
  return isMultiplayerSeat(value) ? value : null;
}

export function isMultiplayerRoomStatus(value: unknown): value is MultiplayerRoomStatus {
  return value === "lobby" || value === "playing" || value === "finished";
}

export function parseMultiplayerRoomStatus(value: unknown): MultiplayerRoomStatus | null {
  return isMultiplayerRoomStatus(value) ? value : null;
}

export function oppositeMultiplayerSeat(seat: MultiplayerSeat): MultiplayerSeat {
  return seat === "p1" ? "p2" : "p1";
}
