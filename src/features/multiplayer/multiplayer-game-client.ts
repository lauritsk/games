import { setIconLabel, type GameDefinition } from "@shared/core";
import {
  canRequestMultiplayerRematch,
  canStartMultiplayerMatch,
  multiplayerRematchActionLabel,
  type MultiplayerActionButtons,
} from "@features/multiplayer/multiplayer-actions";
import {
  connectMultiplayerSession,
  type MultiplayerConnection,
  type MultiplayerConnectionStatus,
} from "@features/multiplayer/multiplayer";
import {
  createMultiplayerCountdown,
  multiplayerCountdownText,
} from "@features/multiplayer/multiplayer-countdown";
import { renderMultiplayerPresence } from "@features/multiplayer/multiplayer-presence";
import {
  emptyMultiplayerSeatSnapshots,
  type MultiplayerRoomSnapshot,
  type MultiplayerRoomStatus,
  type MultiplayerSeat,
  type MultiplayerSeatSnapshot,
  type MultiplayerSession,
} from "@features/multiplayer/multiplayer-protocol";

export type MultiplayerGameClient = {
  readonly session: MultiplayerSession | null;
  readonly connection: MultiplayerConnection | null;
  readonly seat: MultiplayerSeat | null;
  readonly revision: number;
  readonly connectionStatus: MultiplayerConnectionStatus;
  readonly roomStatus: MultiplayerRoomStatus;
  readonly countdownEndsAt: number | undefined;
  readonly seats: Record<MultiplayerSeat, MultiplayerSeatSnapshot>;
  error: string;
  resultRecorded: boolean;
  start(session: MultiplayerSession, onStart?: MultiplayerStartHandler): void;
  stop(): void;
  applySnapshot(room: MultiplayerRoomSnapshot, seat: MultiplayerSeat | null): void;
  renderPresence(host: HTMLElement): void;
  syncActionButtons(buttons: MultiplayerActionButtonSet, isFinished: boolean): void;
  requestStart(onInvalidMove: () => void): void;
  requestRematch(isFinished: boolean): void;
  requestSettings(settings: unknown): void;
  canStart(): boolean;
  canRematch(isFinished: boolean): boolean;
  canAdjustSettings(): boolean;
  currentSeatReady(): boolean;
  countdownText(): string;
};

type MultiplayerStartHandler = (session: MultiplayerSession, spectator: boolean) => void;

type MultiplayerActionButtonSet = Pick<
  MultiplayerActionButtons,
  "onlineButton" | "startOnlineButton" | "rematchButton"
>;

export function createMultiplayerGameClient(options: {
  game: GameDefinition;
  render(): void;
  applySnapshot(room: MultiplayerRoomSnapshot, seat: MultiplayerSeat | null): void;
}): MultiplayerGameClient {
  let session: MultiplayerSession | null = null;
  let connection: MultiplayerConnection | null = null;
  let seat: MultiplayerSeat | null = null;
  let revision = 0;
  let connectionStatus: MultiplayerConnectionStatus = "closed";
  let roomStatus: MultiplayerRoomStatus = "lobby";
  let countdownEndsAt: number | undefined;
  let seats = emptyMultiplayerSeatSnapshots();
  let error = "";
  let resultRecorded = false;
  const countdown = createMultiplayerCountdown(options.render);

  const client: MultiplayerGameClient = {
    get session() {
      return session;
    },
    get connection() {
      return connection;
    },
    get seat() {
      return seat;
    },
    get revision() {
      return revision;
    },
    get connectionStatus() {
      return connectionStatus;
    },
    get roomStatus() {
      return roomStatus;
    },
    get countdownEndsAt() {
      return countdownEndsAt;
    },
    get seats() {
      return seats;
    },
    get error() {
      return error;
    },
    set error(value) {
      error = value;
    },
    get resultRecorded() {
      return resultRecorded;
    },
    set resultRecorded(value) {
      resultRecorded = value;
    },
    start(nextSession, onStart) {
      connection?.close();
      const spectator = nextSession.role === "spectator";
      session = nextSession;
      seat = spectator ? null : nextSession.seat;
      revision = 0;
      connectionStatus = "connecting";
      roomStatus = "lobby";
      countdownEndsAt = undefined;
      seats = emptyMultiplayerSeatSnapshots();
      if (!spectator) seats[nextSession.seat] = { joined: true, connected: false };
      resultRecorded = false;
      error = "";
      onStart?.(nextSession, spectator);
      connection = connectMultiplayerSession(nextSession, {
        onSnapshot: (message) =>
          options.applySnapshot(
            message.room,
            message.you.role === "spectator" ? null : message.you.seat,
          ),
        onError: (nextError, room) => {
          error = nextError;
          if (room) options.applySnapshot(room, seat);
          else options.render();
        },
        onStatus: (status) => {
          connectionStatus = status;
          if (status === "connected") error = "";
          options.render();
        },
      });
      options.render();
    },
    stop() {
      connection?.close();
      connection = null;
      session = null;
      seat = null;
      revision = 0;
      connectionStatus = "closed";
      roomStatus = "lobby";
      countdownEndsAt = undefined;
      countdown.cleanup();
      seats = emptyMultiplayerSeatSnapshots();
      error = "";
      resultRecorded = false;
    },
    applySnapshot(room, nextSeat) {
      error = "";
      seat = nextSeat;
      revision = room.revision;
      roomStatus = room.status;
      countdownEndsAt = room.countdownEndsAt;
      seats = room.seats;
      countdown.update(room);
    },
    renderPresence(host) {
      renderMultiplayerPresence(host, {
        gameId: options.game.id,
        session,
        seat,
        status: roomStatus,
        seats,
        countdown: client.countdownText(),
      });
    },
    syncActionButtons({ onlineButton, startOnlineButton, rematchButton }, isFinished) {
      setIconLabel(onlineButton, "🌐", session ? "Online" : "Play online");
      onlineButton.disabled = Boolean(session);
      startOnlineButton.hidden = !session || roomStatus !== "lobby";
      startOnlineButton.disabled = !client.canStart();
      rematchButton.hidden = !isFinished || !seat;
      setIconLabel(
        rematchButton,
        seat === "p1" ? "▶" : "✓",
        multiplayerRematchActionLabel(seat, client.currentSeatReady()),
      );
      rematchButton.disabled = connectionStatus !== "connected" || !client.canRematch(isFinished);
    },
    requestStart(onInvalidMove) {
      if (!session) return;
      if (!client.canStart()) {
        if (roomStatus === "lobby") onInvalidMove();
        return;
      }
      error = "Starting…";
      connection?.requestStart(revision);
      options.render();
    },
    requestRematch(isFinished) {
      if (!client.canRematch(isFinished)) return;
      error = seat === "p1" ? "Starting rematch…" : "Ready for rematch…";
      connection?.requestRematch(revision);
      options.render();
    },
    requestSettings(settings) {
      if (!client.canAdjustSettings()) return;
      error = "Updating settings…";
      connection?.updateSettings(revision, settings);
      options.render();
    },
    canStart() {
      return canStartMultiplayerMatch({
        session,
        seat,
        connectionStatus,
        roomStatus,
        seats,
      });
    },
    canRematch(isFinished) {
      return canRequestMultiplayerRematch(isFinished, seat, client.currentSeatReady());
    },
    canAdjustSettings() {
      return Boolean(
        session && seat === "p1" && connectionStatus === "connected" && roomStatus === "lobby",
      );
    },
    currentSeatReady() {
      return seat ? seats[seat].ready === true : false;
    },
    countdownText() {
      return multiplayerCountdownText({ status: roomStatus, countdownEndsAt });
    },
  };

  return client;
}
