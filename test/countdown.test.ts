import { describe, expect, test } from "bun:test";
import {
  createMultiplayerCountdown,
  multiplayerCountdownNumber,
  multiplayerCountdownText,
} from "@features/multiplayer/multiplayer-countdown";
import type { MultiplayerRoomSnapshot } from "@features/multiplayer/multiplayer-protocol";

type FakeTimer = {
  callback: () => void;
  delayMs: number;
  cleared: boolean;
};

function countdownRoom(countdownEndsAt: number, revision = 1): MultiplayerRoomSnapshot {
  return {
    code: "ABC234",
    gameId: "tictactoe",
    status: "countdown",
    revision,
    seats: {
      p1: { joined: true, connected: true },
      p2: { joined: true, connected: true },
      p3: { joined: false, connected: false },
      p4: { joined: false, connected: false },
    },
    state: null,
    countdownEndsAt,
  };
}

describe("multiplayer countdown", () => {
  test("formats countdown numbers from an explicit clock", () => {
    const room = countdownRoom(5_000);
    expect(multiplayerCountdownNumber(room, 1)).toBe(5);
    expect(multiplayerCountdownNumber(room, 1_001)).toBe(4);
    expect(multiplayerCountdownText(room, 4_001)).toBe("1");
    expect(multiplayerCountdownText(room, 5_000)).toBe("…");
  });

  test("keeps visible and audible ticks on a one-second local cadence", () => {
    let nowMs = 200;
    let monotonicMs = 1_000;
    const played: number[] = [];
    const ticks: number[] = [];
    const timers: FakeTimer[] = [];
    const countdown = createMultiplayerCountdown(() => ticks.push(nowMs), {
      now: () => nowMs,
      monotonicNow: () => monotonicMs,
      setTimer: (callback, delayMs) => {
        const timer = { callback, delayMs, cleared: false };
        timers.push(timer);
        return timer as ReturnType<typeof setTimeout>;
      },
      clearTimer: (timer) => {
        (timer as unknown as FakeTimer).cleared = true;
      },
      playSound: (number) => played.push(number),
    });

    countdown.update(countdownRoom(5_000));
    expect(played).toEqual([5]);
    expect(timers.at(-1)?.delayMs).toBe(1_000);

    nowMs = 1_200;
    monotonicMs = 2_000;
    timers.at(-1)?.callback();
    expect(played).toEqual([5, 4]);
    expect(ticks).toEqual([1_200]);
    expect(timers.at(-1)?.delayMs).toBe(1_000);

    nowMs = 2_200;
    monotonicMs = 3_000;
    timers.at(-1)?.callback();
    expect(played).toEqual([5, 4, 3]);
    expect(ticks).toEqual([1_200, 2_200]);
    expect(timers.at(-1)?.delayMs).toBe(1_000);
  });

  test("does not restart the cadence for duplicate countdown snapshots", () => {
    let nowMs = 100;
    let monotonicMs = 1_000;
    const timers: FakeTimer[] = [];
    const countdown = createMultiplayerCountdown(() => undefined, {
      now: () => nowMs,
      monotonicNow: () => monotonicMs,
      setTimer: (callback, delayMs) => {
        const timer = { callback, delayMs, cleared: false };
        timers.push(timer);
        return timer as ReturnType<typeof setTimeout>;
      },
      clearTimer: (timer) => {
        (timer as unknown as FakeTimer).cleared = true;
      },
      playSound: () => undefined,
    });

    countdown.update(countdownRoom(5_000));
    monotonicMs = 1_250;
    nowMs = 350;
    countdown.update(countdownRoom(5_000));

    expect(timers).toHaveLength(1);
    expect(timers[0]?.cleared).toBe(false);
    expect(timers[0]?.delayMs).toBe(1_000);
  });
});
