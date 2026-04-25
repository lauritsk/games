import type { MultiplayerRoomSnapshot } from "@features/multiplayer/multiplayer-protocol";
import { playCountdownSound } from "@ui/sound";

export type MultiplayerCountdown = {
  update(room: MultiplayerRoomSnapshot): void;
  cleanup(): void;
};

type CountdownRoom = Pick<MultiplayerRoomSnapshot, "status" | "countdownEndsAt">;
type CountdownTimer = ReturnType<typeof setTimeout>;

type MultiplayerCountdownOptions = {
  now?: () => number;
  monotonicNow?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => CountdownTimer;
  clearTimer?: (timer: CountdownTimer) => void;
  playSound?: (number: number) => void;
};

export function multiplayerCountdownNumber(room: CountdownRoom, now = Date.now()): number | null {
  if (room.status !== "countdown" || typeof room.countdownEndsAt !== "number") return null;
  const remaining = Math.ceil((room.countdownEndsAt - now) / 1000);
  if (remaining < 1) return null;
  return Math.min(5, remaining);
}

export function multiplayerCountdownText(room: CountdownRoom, now?: number): string {
  const number = multiplayerCountdownNumber(room, now);
  return number === null ? "…" : String(number);
}

export function createMultiplayerCountdown(
  onTick: () => void,
  options: MultiplayerCountdownOptions = {},
): MultiplayerCountdown {
  const now = options.now ?? Date.now;
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  const setTimer =
    options.setTimer ?? ((callback: () => void, delayMs: number) => setTimeout(callback, delayMs));
  const clearTimer = options.clearTimer ?? ((nextTimer: CountdownTimer) => clearTimeout(nextTimer));
  const playSound = options.playSound ?? playCountdownSound;

  let room: MultiplayerRoomSnapshot | null = null;
  let countdownKey: string | null = null;
  let lastRevision = -1;
  let lastNumber: number | null = null;
  let nextTickAt: number | null = null;
  let timer: CountdownTimer | null = null;

  function cleanup(): void {
    if (timer) clearTimer(timer);
    timer = null;
    room = null;
    countdownKey = null;
    lastNumber = null;
    nextTickAt = null;
  }

  function schedule(): void {
    if (timer) return;
    if (!room || room.status !== "countdown" || typeof room.countdownEndsAt !== "number") return;
    const number = countdownNumber(room);
    if (number === null) return;
    const currentTime = monotonicNow();
    nextTickAt ??= currentTime + 1000;
    timer = setTimer(tick, Math.max(80, nextTickAt - currentTime));
  }

  function tick(): void {
    timer = null;
    if (!room) return;
    const changed = announce(room);
    if (changed) onTick();

    const number = countdownNumber(room);
    if (number === null) {
      nextTickAt = null;
      return;
    }

    const currentTime = monotonicNow();
    if (!changed) nextTickAt = currentTime + 80;
    else {
      nextTickAt = (nextTickAt ?? currentTime) + 1000;
      if (nextTickAt <= currentTime + 80) nextTickAt = currentTime + 1000;
    }
    schedule();
  }

  function announce(nextRoom: MultiplayerRoomSnapshot): boolean {
    const number = countdownNumber(nextRoom);
    if (number === null) return false;
    if (nextRoom.revision === lastRevision && number === lastNumber) return false;
    lastRevision = nextRoom.revision;
    lastNumber = number;
    playSound(number);
    return true;
  }

  function update(nextRoom: MultiplayerRoomSnapshot): void {
    if (nextRoom.status !== "countdown") {
      cleanup();
      return;
    }

    const key = `${nextRoom.revision}:${nextRoom.countdownEndsAt ?? ""}`;
    const isNewCountdown = key !== countdownKey;
    room = nextRoom;
    countdownKey = key;
    if (isNewCountdown) {
      if (timer) clearTimer(timer);
      timer = null;
      lastNumber = null;
      nextTickAt = monotonicNow() + 1000;
    }

    announce(room);
    schedule();
  }

  function countdownNumber(nextRoom: CountdownRoom): number | null {
    return multiplayerCountdownNumber(nextRoom, now());
  }

  return { update, cleanup };
}
