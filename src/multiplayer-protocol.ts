export type MultiplayerSeat = "p1" | "p2";
export type MultiplayerRoomStatus = "lobby" | "playing" | "finished";

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
