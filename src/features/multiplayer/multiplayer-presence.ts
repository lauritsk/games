import { clearNode, el } from "@shared/core";
import {
  multiplayerSeats,
  type MultiplayerRoomStatus,
  type MultiplayerSeat,
  type MultiplayerSeatSnapshot,
  type MultiplayerSession,
} from "@features/multiplayer/multiplayer-protocol";

export type MultiplayerPresenceOptions = {
  gameId: string;
  session: MultiplayerSession | null;
  seat: MultiplayerSeat | null;
  status: MultiplayerRoomStatus;
  seats: Record<MultiplayerSeat, MultiplayerSeatSnapshot>;
  countdown: string | null;
};

export type MultiplayerPlayerDescriptor = {
  seat: MultiplayerSeat;
  label: string;
  colorName: string;
  color: string;
};

const defaultColors = {
  p1: { name: "Green", value: "#a7f06d" },
  p2: { name: "Blue", value: "#67d8ff" },
  p3: { name: "Gold", value: "#ffd766" },
  p4: { name: "Pink", value: "#ff8bd1" },
} satisfies Record<MultiplayerSeat, { name: string; value: string }>;

const connect4Colors = {
  p1: { name: "Red", value: "#ff6262" },
  p2: { name: "Gold", value: "#ffd766" },
  p3: defaultColors.p3,
  p4: defaultColors.p4,
} satisfies Record<MultiplayerSeat, { name: string; value: string }>;

const maxSeatsByGame: Record<string, number> = {
  snake: 4,
  tictactoe: 2,
  connect4: 2,
  memory: 2,
};

export function renderMultiplayerPresence(
  container: HTMLElement,
  options: MultiplayerPresenceOptions,
): void {
  const session = options.session;
  const shouldShow =
    Boolean(session) && (options.status === "lobby" || options.status === "countdown");
  container.hidden = !shouldShow;
  clearNode(container);
  if (!session || !shouldShow) return;

  const localSeat = options.seat ?? session.seat;
  const seats = joinedSeatsWithLocalFallback(options.seats, session.seat);
  const countdownText = options.status === "countdown" ? (options.countdown ?? "…") : null;
  container.setAttribute("aria-live", options.status === "countdown" ? "assertive" : "polite");
  container.dataset.status = options.status;

  const panel = el("div", { className: "online-presence" });
  const headline = el("div", { className: "online-presence__headline" });

  if (countdownText) {
    const countdown = el("div", {
      className: "online-presence__countdown",
      ariaLabel: `Match starts in ${countdownText}`,
    });
    countdown.dataset.value = countdownText;
    countdown.textContent = countdownText;
    headline.append(countdown);
  }

  const you = multiplayerPlayerDescriptor(options.gameId, localSeat);
  const summary = el("div", { className: "online-presence__summary" });
  summary.append(
    el("span", {
      className: "online-presence__kicker",
      text: countdownText ? "Starting" : `Room ${session.code}`,
    }),
    playerLine(you, options.status === "lobby" ? "You joined as" : "You are"),
  );
  headline.append(summary);

  const list = el("div", { className: "online-presence__seats" });
  list.setAttribute("role", "list");
  for (const seat of multiplayerSeats.slice(0, maxSeats(options.gameId))) {
    const descriptor = multiplayerPlayerDescriptor(options.gameId, seat);
    const seatState = seats[seat];
    const item = el("div", { className: "online-presence__seat" });
    item.setAttribute("role", "listitem");
    item.style.setProperty("--player-color", descriptor.color);
    item.dataset.joined = String(seatState.joined);
    item.dataset.you = String(seat === localSeat);
    item.append(
      el("span", { className: "online-presence__swatch", ariaLabel: descriptor.colorName }),
      el("span", { className: "online-presence__seat-main", text: seatTitle(descriptor) }),
      el("span", {
        className: "online-presence__seat-meta",
        text: seatMeta(seatState.joined, seat, localSeat),
      }),
    );
    list.append(item);
  }

  panel.append(headline, list);
  container.append(panel);
}

function joinedSeatsWithLocalFallback(
  seats: Record<MultiplayerSeat, MultiplayerSeatSnapshot>,
  localSeat: MultiplayerSeat,
): Record<MultiplayerSeat, MultiplayerSeatSnapshot> {
  return {
    ...seats,
    [localSeat]: { ...seats[localSeat], joined: true },
  };
}

function maxSeats(gameId: string): number {
  return maxSeatsByGame[gameId] ?? 2;
}

export function multiplayerPlayerDescriptor(
  gameId: string,
  seat: MultiplayerSeat,
): MultiplayerPlayerDescriptor {
  const colors = gameId === "connect4" ? connect4Colors : defaultColors;
  const color = colors[seat];
  return {
    seat,
    label: seat.toUpperCase(),
    colorName: color.name,
    color: color.value,
  };
}

function playerLine(descriptor: MultiplayerPlayerDescriptor, prefix: string): HTMLElement {
  const line = el("div", { className: "online-presence__you" });
  line.style.setProperty("--player-color", descriptor.color);
  line.append(
    el("span", { className: "online-presence__swatch", ariaLabel: descriptor.colorName }),
    el("span", {
      className: "online-presence__you-text",
      text: `${prefix} ${seatTitle(descriptor)}`,
    }),
  );
  return line;
}

function seatTitle(descriptor: MultiplayerPlayerDescriptor): string {
  return `${descriptor.label} · ${descriptor.colorName}`;
}

function seatMeta(joined: boolean, seat: MultiplayerSeat, localSeat: MultiplayerSeat): string {
  if (!joined) return "Waiting";
  if (seat === localSeat) return "You";
  if (seat === "p1") return "Host";
  return "Joined";
}
