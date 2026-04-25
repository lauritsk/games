import { actionButton, type GameDefinition } from "@shared/core";
import type { MultiplayerConnectionStatus } from "@features/multiplayer/multiplayer";
import { createMultiplayerDialog } from "@features/multiplayer/multiplayer-dialog";
import {
  multiplayerJoinedSeatCount,
  type MultiplayerRoomStatus,
  type MultiplayerSeat,
  type MultiplayerSeatSnapshot,
  type MultiplayerSession,
} from "@features/multiplayer/multiplayer-protocol";

export type MultiplayerActionButtons = {
  onlineButton: HTMLButtonElement;
  startOnlineButton: HTMLButtonElement;
  rematchButton: HTMLButtonElement;
  closeDialog(): void;
};

type CreateMultiplayerActionButtonsOptions = {
  game: GameDefinition;
  getSession(): MultiplayerSession | null;
  onSession(session: MultiplayerSession): void;
  onStart(): void;
  onRematch(): void;
};

export function createMultiplayerActionButtons(
  actions: HTMLElement,
  options: CreateMultiplayerActionButtonsOptions,
): MultiplayerActionButtons {
  const dialog = createMultiplayerDialog();
  const onlineButton = actionButton("Play online");
  onlineButton.addEventListener("click", () => {
    if (!options.getSession()) dialog.show(options.game, options.onSession);
  });

  const startOnlineButton = actionButton("Start");
  startOnlineButton.addEventListener("click", options.onStart);

  const rematchButton = actionButton("Rematch");
  rematchButton.addEventListener("click", options.onRematch);

  actions.append(onlineButton, startOnlineButton, rematchButton);
  return {
    onlineButton,
    startOnlineButton,
    rematchButton,
    closeDialog: dialog.close,
  };
}

export function canStartMultiplayerMatch({
  session,
  seat,
  connectionStatus,
  roomStatus,
  seats,
  minPlayers = 2,
}: {
  session: MultiplayerSession | null;
  seat: MultiplayerSeat | null;
  connectionStatus: MultiplayerConnectionStatus;
  roomStatus: MultiplayerRoomStatus;
  seats: Record<MultiplayerSeat, MultiplayerSeatSnapshot>;
  minPlayers?: number;
}): boolean {
  return Boolean(
    session &&
    seat === "p1" &&
    connectionStatus === "connected" &&
    roomStatus === "lobby" &&
    multiplayerJoinedSeatCount(seats) >= minPlayers,
  );
}

export function canRequestMultiplayerRematch(
  isFinished: boolean,
  seat: MultiplayerSeat | null,
  isSeatReady: boolean,
): boolean {
  return isFinished && (seat === "p1" || !isSeatReady);
}

export function multiplayerRematchActionLabel(
  seat: MultiplayerSeat | null,
  isSeatReady: boolean,
): string {
  if (seat === "p1") return "Start rematch";
  return isSeatReady ? "Ready" : "Ready rematch";
}
