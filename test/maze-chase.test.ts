import { describe, expect, test } from "bun:test";
import {
  mazeChaseCellAt,
  mazeChaseColumns,
  mazeChasePlayerStart,
  mazeChaseRows,
  newMazeChaseState,
  queueMazeChaseDirection,
  stepMazeChase,
  type MazeChaseConfig,
  type MazeChaseState,
} from "@games/maze-chase/logic";

const config: MazeChaseConfig = {
  lives: 3,
  powerTicks: 10,
  ghostMoveInterval: 2,
  dotScore: 10,
  powerScore: 50,
  ghostScore: 200,
  levelScore: 1_000,
  maxLevel: 2,
};

describe("maze chase logic", () => {
  test("starts with a fixed maze, player, ghosts, and collectibles", () => {
    const state = newMazeChaseState(config);
    expect(state.columns).toBe(mazeChaseColumns);
    expect(state.rows).toBe(mazeChaseRows);
    expect(state.cells).toHaveLength(mazeChaseColumns * mazeChaseRows);
    expect(state.player).toEqual(mazeChasePlayerStart);
    expect(state.ghosts).toHaveLength(3);
    expect(state.dotsRemaining).toBeGreaterThan(0);
    expect(mazeChaseCellAt(state, { row: 0, column: 0 })).toBe("wall");
  });

  test("queues direction, moves through corridors, and eats dots", () => {
    const state = queueMazeChaseDirection(newMazeChaseState(config), "left");
    const moved = stepMazeChase(state, config);
    expect(moved.player).toEqual({
      row: mazeChasePlayerStart.row,
      column: mazeChasePlayerStart.column - 1,
    });
    expect(moved.score).toBe(config.dotScore);
    expect(moved.dotsRemaining).toBe(state.dotsRemaining - 1);
    expect(mazeChaseCellAt(moved, moved.player)).toBe("empty");
  });

  test("blocks walls without consuming queued direction", () => {
    const state: MazeChaseState = {
      ...newMazeChaseState(config),
      player: { row: 1, column: 1 },
      direction: null,
      queuedDirection: "up",
    };
    const blocked = stepMazeChase(state, config);
    expect(blocked.player).toEqual({ row: 1, column: 1 });
    expect(blocked.direction).toBeNull();
  });

  test("power pellets frighten ghosts and let the player score a ghost", () => {
    const powered = stepMazeChase(
      queueMazeChaseDirection(
        { ...newMazeChaseState(config), player: { row: 13, column: 2 } },
        "left",
      ),
      config,
    );
    expect(powered.score).toBe(config.powerScore);
    expect(powered.powerTicks).toBe(config.powerTicks - 1);

    const hunted = stepMazeChase(
      {
        ...powered,
        player: { row: 5, column: 5 },
        direction: null,
        queuedDirection: null,
        powerTicks: 3,
        tick: 2,
        ghosts: [
          { ...powered.ghosts[0]!, start: { row: 7, column: 7 }, position: { row: 5, column: 5 } },
        ],
      },
      config,
    );
    expect(hunted.score).toBe(powered.score + config.ghostScore);
    expect(hunted.ghosts[0]?.position).toEqual({ row: 7, column: 7 });
  });

  test("normal ghost collisions cost lives and reset actors", () => {
    const state: MazeChaseState = {
      ...newMazeChaseState(config),
      player: { row: 5, column: 5 },
      ghosts: [
        { id: 1, start: { row: 7, column: 7 }, position: { row: 5, column: 5 }, direction: "left" },
      ],
    };
    const hit = stepMazeChase(state, config);
    expect(hit.lives).toBe(2);
    expect(hit.player).toEqual(mazeChasePlayerStart);
    expect(hit.lost).toBe(false);

    const lost = stepMazeChase({ ...state, lives: 1 }, config);
    expect(lost.lost).toBe(true);
  });

  test("clearing the final dot advances levels and then wins", () => {
    const almostClear = stateWithSingleDot(newMazeChaseState(config), 11, 6);
    const advanced = stepMazeChase(queueMazeChaseDirection(almostClear, "left"), config);
    expect(advanced.level).toBe(2);
    expect(advanced.score).toBe(config.dotScore + config.levelScore);
    expect(advanced.won).toBe(false);

    const almostWon = stateWithSingleDot(advanced, 11, 6);
    const won = stepMazeChase(queueMazeChaseDirection(almostWon, "left"), config);
    expect(won.won).toBe(true);
    expect(won.score).toBe(advanced.score + config.dotScore + 2 * config.levelScore);
  });
});

function stateWithSingleDot(state: MazeChaseState, row: number, column: number): MazeChaseState {
  const cells = state.cells.map((cell) => (cell === "wall" ? "wall" : "empty"));
  cells[row * state.columns + column] = "dot";
  return {
    ...state,
    cells,
    player: { row, column: column + 1 },
    direction: null,
    queuedDirection: null,
    ghosts: [],
    dotsRemaining: 1,
  };
}
