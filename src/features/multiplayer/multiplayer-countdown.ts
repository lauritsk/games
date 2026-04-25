import type { MultiplayerRoomSnapshot } from "@features/multiplayer/multiplayer-protocol";
import { playCountdownSound } from "@ui/sound";

export type MultiplayerCountdown = {
  update(room: MultiplayerRoomSnapshot): void;
  cleanup(): void;
};

export function multiplayerCountdownNumber(room: MultiplayerRoomSnapshot): number | null {
  if (room.status !== "countdown" || typeof room.countdownEndsAt !== "number") return null;
  const remaining = Math.ceil((room.countdownEndsAt - Date.now()) / 1000);
  if (remaining < 1) return null;
  return Math.min(5, remaining);
}

export function createMultiplayerCountdown(onTick: () => void): MultiplayerCountdown {
  let room: MultiplayerRoomSnapshot | null = null;
  let lastRevision = -1;
  let lastNumber: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function cleanup(): void {
    if (timer) clearTimeout(timer);
    timer = null;
    room = null;
    lastNumber = null;
  }

  function schedule(): void {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!room || room.status !== "countdown" || typeof room.countdownEndsAt !== "number") return;
    const number = multiplayerCountdownNumber(room);
    if (number === null) return;
    const remaining = room.countdownEndsAt - Date.now();
    const untilNext = Math.max(80, remaining - (number - 1) * 1000 + 8);
    timer = setTimeout(tick, untilNext);
  }

  function tick(): void {
    timer = null;
    if (!room) return;
    announce(room);
    onTick();
    schedule();
  }

  function announce(nextRoom: MultiplayerRoomSnapshot): void {
    const number = multiplayerCountdownNumber(nextRoom);
    if (number === null) return;
    if (nextRoom.revision === lastRevision && number === lastNumber) return;
    lastRevision = nextRoom.revision;
    lastNumber = number;
    playCountdownSound(number);
  }

  function update(nextRoom: MultiplayerRoomSnapshot): void {
    room = nextRoom.status === "countdown" ? nextRoom : null;
    if (!room) {
      cleanup();
      return;
    }
    announce(room);
    schedule();
  }

  return { update, cleanup };
}
