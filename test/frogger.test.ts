import { describe, expect, test } from "bun:test";
import {
  froggerHomeColumns,
  froggerHomeScore,
  froggerLevelScore,
  froggerRowScore,
  froggerStart,
  froggerTimeScoreMultiplier,
  froggerWinScore,
  froggerLaneAt,
  moveFrogger,
  newFroggerState,
  stepFrogger,
  type FroggerConfig,
  type FroggerLaneProfile,
  type FroggerState,
} from "@games/frogger/logic";

const safeProfiles: FroggerLaneProfile[] = Array.from({ length: 13 }, (_, row) => ({
  row,
  kind: row === 0 ? "goal" : "safe",
}));

const safeConfig: FroggerConfig = {
  lives: 3,
  timeLimitTicks: 10,
  speedMultiplier: 1,
  levelSpeedGrowth: 0.5,
  maxLevel: 2,
  laneProfiles: safeProfiles,
};

describe("frogger logic", () => {
  test("starts deterministic lanes and scales lane speed by level", () => {
    const config = configWith([
      { row: 5, kind: "water", objectKind: "log", length: 2, speed: 1, offsets: [0, 4] },
    ]);

    const state = newFroggerState(config);
    const lane = froggerLaneAt(state, 5)!;
    expect(lane.objects).toEqual([
      { id: 1, kind: "log", x: 0, length: 2, speed: 1 },
      { id: 2, kind: "log", x: 4, length: 2, speed: 1 },
    ]);
    expect(state.frog).toEqual(froggerStart);
    expect(state.homes).toEqual(froggerHomeColumns.map(() => false));

    const harder = newFroggerState(config, 2);
    expect(froggerLaneAt(harder, 5)!.objects[0]!.speed).toBe(1.5);
  });

  test("moves one tile, clamps board edges, and scores new upward progress", () => {
    const state = newFroggerState(safeConfig);
    const moved = moveFrogger(state, "up", safeConfig);
    expect(moved.frog).toEqual({ row: 11, column: 6 });
    expect(moved.score).toBe(froggerRowScore);
    expect(moved.reachedRow).toBe(11);

    const edgeState: FroggerState = { ...state, frog: { row: 12, column: 0 } };
    expect(moveFrogger(edgeState, "left", safeConfig)).toBe(edgeState);
  });

  test("loses a life when landing on a road hazard", () => {
    const config = configWith([
      { row: 11, kind: "road", objectKind: "car", length: 1, speed: 0, offsets: [6] },
    ]);

    const hit = moveFrogger(newFroggerState(config), "up", config);
    expect(hit.lives).toBe(2);
    expect(hit.frog).toEqual(froggerStart);
    expect(hit.lost).toBe(false);
  });

  test("requires a water ride and carries the frog with it", () => {
    const noRideConfig = configWith([{ row: 11, kind: "water", objectKind: "log", offsets: [] }]);
    const drowned = moveFrogger(newFroggerState(noRideConfig), "up", noRideConfig);
    expect(drowned.lives).toBe(2);
    expect(drowned.frog).toEqual(froggerStart);

    const rideConfig = configWith([
      { row: 11, kind: "water", objectKind: "log", length: 1, speed: 1, offsets: [6] },
    ]);
    const riding = moveFrogger(newFroggerState(rideConfig), "up", rideConfig);
    expect(riding.lives).toBe(3);
    expect(riding.frog).toEqual({ row: 11, column: 6 });

    const carried = stepFrogger(riding, rideConfig);
    expect(carried.frog.column).toBe(7);
    expect(froggerLaneAt(carried, 11)!.objects[0]!.x).toBe(7);
  });

  test("fills homes, rejects duplicate homes, and rejects misses", () => {
    const homeStart = atRowBeforeGoal(newFroggerState(safeConfig), 1);
    const settled = moveFrogger(homeStart, "up", safeConfig);
    expect(settled.homes[0]).toBe(true);
    expect(settled.frog).toEqual(froggerStart);
    expect(settled.score).toBe(
      froggerRowScore + froggerHomeScore + safeConfig.timeLimitTicks * froggerTimeScoreMultiplier,
    );

    const duplicateAttempt = atRowBeforeGoal(settled, 1);
    const duplicate = moveFrogger(duplicateAttempt, "up", safeConfig);
    expect(duplicate.lives).toBe(2);
    expect(duplicate.homes[0]).toBe(true);

    const miss = moveFrogger(atRowBeforeGoal(newFroggerState(safeConfig), 2), "up", safeConfig);
    expect(miss.lives).toBe(2);
    expect(miss.homes.some(Boolean)).toBe(false);
  });

  test("advances levels after all homes and wins after the final level", () => {
    const almostClear = {
      ...atRowBeforeGoal(newFroggerState(safeConfig), 11),
      homes: [true, true, true, true, false],
    } satisfies FroggerState;
    const advanced = moveFrogger(almostClear, "up", safeConfig);
    const homePoints = froggerRowScore + froggerHomeScore + 10 * froggerTimeScoreMultiplier;
    expect(advanced.level).toBe(2);
    expect(advanced.won).toBe(false);
    expect(advanced.homes).toEqual([false, false, false, false, false]);
    expect(advanced.score).toBe(homePoints + froggerLevelScore);

    const almostWon = {
      ...atRowBeforeGoal(advanced, 11),
      homes: [true, true, true, true, false],
    } satisfies FroggerState;
    const won = moveFrogger(almostWon, "up", safeConfig);
    expect(won.won).toBe(true);
    expect(won.level).toBe(2);
    expect(won.score).toBe(advanced.score + homePoints + 2 * froggerLevelScore + froggerWinScore);
  });

  test("timer expiry costs a life and resets the frog", () => {
    const state = { ...newFroggerState(safeConfig), ticksRemaining: 1 } satisfies FroggerState;
    const expired = stepFrogger(state, safeConfig);
    expect(expired.lives).toBe(2);
    expect(expired.ticksRemaining).toBe(safeConfig.timeLimitTicks);
    expect(expired.frog).toEqual(froggerStart);
  });
});

function configWith(overrides: FroggerLaneProfile[]): FroggerConfig {
  const byRow = new Map(overrides.map((profile) => [profile.row, profile]));
  return {
    ...safeConfig,
    laneProfiles: safeProfiles.map((profile) => byRow.get(profile.row) ?? profile),
  };
}

function atRowBeforeGoal(state: FroggerState, column: number): FroggerState {
  return { ...state, frog: { row: 1, column }, reachedRow: 1 };
}
