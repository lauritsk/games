import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  addRandom2048Tile,
  canMove2048,
  empty2048Board,
  merge2048Line,
  slide2048,
  type Board2048,
} from "@games/2048/logic";
import {
  asteroidsCirclesOverlap,
  fireAsteroidBullet,
  newAsteroidsState,
  rotateAsteroidsShip,
  stepAsteroids,
  thrustAsteroidsShip,
  type AsteroidsConfig,
  type AsteroidsState,
} from "@games/asteroids/logic";
import {
  ballzAimVector,
  ballzBrickHp,
  ballzBrickWidth,
  clampBallzAim,
  newBallzState,
  rotateBallzAim,
  spawnBallzRow,
  type BallzConfig,
  type BallzState,
} from "@games/ballz/logic";
import {
  circleIntersectsRect,
  moveBreakoutPaddle,
  newBreakoutState,
  stepBreakout,
  type BreakoutConfig,
  type BreakoutState,
} from "@games/breakout/logic";
import {
  cloneConnect4Board,
  connect4Bot,
  connect4Columns,
  connect4Human,
  connect4Rows,
  dropConnect4DiscInPlace,
  findConnect4TacticalMove,
  findConnect4Win,
  newConnect4Board,
  playableConnect4Columns,
  type Connect4Cell,
  type Connect4Player,
} from "@games/connect4/logic";
import {
  baseFroggerLaneProfiles,
  froggerColumns,
  froggerHomeColumns,
  froggerHomeIndexForColumn,
  froggerObjectCoversColumn,
  moveFrogger,
  newFroggerLanes,
  newFroggerState,
  stepFrogger,
  type FroggerConfig,
  type FroggerLaneObject,
} from "@games/frogger/logic";
import { clamp, rectsOverlap, wrap } from "@games/shared/arcade";
import { allMemoryMatched, memorySymbols, newMemoryDeck } from "@games/memory/logic";
import {
  minesweeperNeighbors,
  minesweeperShape,
  newMinesweeperBoard,
  openSafeMinesweeperCount,
  seededMinesweeperBoard,
  type MinesweeperConfig,
} from "@games/minesweeper/logic";
import {
  moveSnakePoint,
  nextSnakeDirection,
  oppositeSnakeDirection,
  randomSnakeFood,
  snakeOutOfBounds,
  snakePointKey,
  startSnakeBody,
  wrapSnakePoint,
} from "@games/snake/logic";
import {
  aimInvaderPlayer,
  fireInvaderPlayerShot,
  newInvaderPlayers,
  newInvaderState,
  scaleInvaderConfigForPlayers,
  stepInvaders,
  stepInvadersWithPlayerInputs,
  type InvaderConfig,
  type InvaderState,
} from "@games/space-invaders/logic";
import {
  canPlaceTetrisPiece,
  clearTetrisLines,
  drawFromBag,
  lockTetrisPiece,
  moveTetrisPiece,
  newTetrisBag,
  newTetrisBoard,
  rotateTetrisPiece,
  spawnTetrisPiece,
  tetrisColumns,
  tetrisGhostPiece,
  tetrisHardDrop,
  tetrisLineScore,
  tetrisPieceCells,
  tetrisRows,
  tetrominoes,
  type TetrisBoard,
  type TetrisCell,
  type TetrisPiece,
  type Tetromino,
} from "@games/tetris/logic";
import {
  botMark,
  chooseTicTacToeBotMove,
  getTicTacToeWinner,
  humanMark,
  newTicTacToeBoard,
  openTicTacToeCells,
  winningTicTacToeMove,
  type Mark,
  type TicTacToeCell,
} from "@games/tictactoe/logic";
import {
  directionFromSwipeDelta,
  moveGridIndex,
  moveGridPoint,
  parseArray,
  parseFixedArray,
  parseFixedGrid,
  shuffleInPlace,
  takeGroupedItems,
  type Difficulty,
  type Direction,
  type RandomSource,
} from "@shared/core";

const propertyOptions = { numRuns: 80 };
const shortPropertyOptions = { numRuns: 40 };
const directions = ["up", "right", "down", "left"] as const satisfies readonly Direction[];
const difficulties = ["Easy", "Medium", "Hard"] as const satisfies readonly Difficulty[];
const rngValuesArb = fc.array(fc.double({ min: 0, max: 0.999_999, noNaN: true }), {
  minLength: 1,
  maxLength: 64,
});
const directionArb = fc.constantFrom(...directions);
const difficultyArb = fc.constantFrom(...difficulties);
const finitePercentArb = fc.double({ min: -250, max: 250, noNaN: true, noDefaultInfinity: true });
const nonNegativeFiniteArb = fc.double({ min: 0, max: 250, noNaN: true, noDefaultInfinity: true });
const positiveFiniteArb = fc.double({ min: 0.001, max: 50, noNaN: true, noDefaultInfinity: true });

function rngFrom(values: readonly number[]): RandomSource {
  let index = 0;
  return () => {
    const value = values[index % values.length] ?? 0;
    index += 1;
    return Math.min(0.999_999, Math.max(0, value));
  };
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function boardSum(board: readonly (readonly number[])[]): number {
  return sum(board.flat());
}

function boardsEqual<T>(a: readonly (readonly T[])[], b: readonly (readonly T[])[]): boolean {
  return a.length === b.length && a.every((row, r) => row.every((value, c) => value === b[r]?.[c]));
}

function countBy<T>(items: readonly T[], key: (item: T) => string = String): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return counts;
}

function expectSameMultiset<T>(actual: readonly T[], expected: readonly T[]): void {
  expect(countBy(actual)).toEqual(countBy(expected));
}

function countTruthyGrid<T>(grid: readonly (readonly T[])[]): number {
  return grid.flat().filter(Boolean).length;
}

function expectGridShape<T>(grid: readonly (readonly T[])[], rows: number, columns: number): void {
  expect(grid).toHaveLength(rows);
  for (const row of grid) expect(row).toHaveLength(columns);
}

function sortedPoints(points: readonly { row: number; column: number }[]): string[] {
  return points.map((point) => `${point.row}:${point.column}`).sort();
}

function sortTetrisCells(piece: TetrisPiece): string[] {
  return sortedPoints(tetrisPieceCells(piece));
}

function filledTetrisCells(board: TetrisBoard): number {
  return board.flat().filter((cell) => cell !== "").length;
}

function validTetrisBoardArb(): fc.Arbitrary<TetrisBoard> {
  const cellArb = fc.constantFrom<TetrisCell>("", ...tetrominoes);
  return fc.array(fc.array(cellArb, { minLength: tetrisColumns, maxLength: tetrisColumns }), {
    minLength: tetrisRows,
    maxLength: tetrisRows,
  });
}

const tile2048Arb = fc.constantFrom(0, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048);
const board2048Arb: fc.Arbitrary<Board2048> = fc.integer({ min: 2, max: 6 }).chain((size) =>
  fc.array(fc.array(tile2048Arb, { minLength: size, maxLength: size }), {
    minLength: size,
    maxLength: size,
  }),
);

function ticTacToeBoardFromMoves(moves: readonly number[]): TicTacToeCell[] {
  const board = newTicTacToeBoard();
  let mark: Mark = humanMark;
  for (const move of moves) {
    if (board[move] || getTicTacToeWinner(board)) continue;
    board[move] = mark;
    mark = mark === humanMark ? botMark : humanMark;
  }
  return board;
}

const ticTacToeBoardArb = fc
  .array(fc.integer({ min: 0, max: 8 }), { minLength: 0, maxLength: 9 })
  .map(ticTacToeBoardFromMoves);

function connect4BoardFromColumns(columns: readonly number[]): {
  board: Connect4Cell[][];
  last: { row: number; column: number; player: Connect4Player } | null;
} {
  const board = newConnect4Board();
  let player: Connect4Player = connect4Human;
  let last: { row: number; column: number; player: Connect4Player } | null = null;
  for (const column of columns) {
    const row = dropConnect4DiscInPlace(board, column, player);
    if (row === null) continue;
    last = { row, column, player };
    player = player === connect4Human ? connect4Bot : connect4Human;
  }
  return { board, last };
}

const connect4CaseArb = fc
  .array(fc.integer({ min: 0, max: connect4Columns - 1 }), { minLength: 0, maxLength: 42 })
  .map(connect4BoardFromColumns);

const minesweeperCaseArb = fc
  .record({ rows: fc.integer({ min: 2, max: 8 }), columns: fc.integer({ min: 2, max: 8 }) })
  .chain(({ rows, columns }) =>
    fc
      .record({
        safeRow: fc.integer({ min: 0, max: rows - 1 }),
        safeColumn: fc.integer({ min: 0, max: columns - 1 }),
      })
      .chain(({ safeRow, safeColumn }) => {
        const baseConfig: MinesweeperConfig = { rows, columns, mines: 0 };
        const blocked = new Set(
          [...minesweeperNeighbors(baseConfig, safeRow, safeColumn), [safeRow, safeColumn]].map(
            ([row, column]) => `${row}:${column}`,
          ),
        );
        const maxMines = rows * columns - blocked.size;
        return fc.record({
          config: fc.constant<MinesweeperConfig>({ rows, columns, mines: 0 }),
          safeRow: fc.constant(safeRow),
          safeColumn: fc.constant(safeColumn),
          mines: fc.integer({ min: 0, max: maxMines }),
        });
      }),
  );

const snakePointArb = fc.record({
  row: fc.integer({ min: -100, max: 100 }),
  column: fc.integer({ min: -100, max: 100 }),
});

const tetrominoArb = fc.constantFrom<Tetromino>(...tetrominoes);

const ballzConfigArb: fc.Arbitrary<BallzConfig> = fc.record({
  columns: fc.integer({ min: 2, max: 10 }),
  startingBalls: fc.integer({ min: 1, max: 20 }),
  ballSpeed: fc.double({ min: 0.5, max: 4, noNaN: true, noDefaultInfinity: true }),
  launchInterval: fc.integer({ min: 0, max: 6 }),
  spawnDensity: fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
  pickupChance: fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
  hpScale: fc.double({ min: 0.1, max: 4, noNaN: true, noDefaultInfinity: true }),
  hpVariance: fc.integer({ min: 0, max: 10 }),
  dangerY: fc.double({ min: 65, max: 95, noNaN: true, noDefaultInfinity: true }),
  rowStep: fc.double({ min: 2, max: 12, noNaN: true, noDefaultInfinity: true }),
  brickGap: fc.double({ min: 0, max: 2, noNaN: true, noDefaultInfinity: true }),
  horizontalMargin: fc.double({ min: 2, max: 10, noNaN: true, noDefaultInfinity: true }),
  topMargin: fc.double({ min: 4, max: 16, noNaN: true, noDefaultInfinity: true }),
  brickHeight: fc.double({ min: 3, max: 9, noNaN: true, noDefaultInfinity: true }),
});

const breakoutConfigArb: fc.Arbitrary<BreakoutConfig> = fc.record({
  brickRows: fc.integer({ min: 1, max: 6 }),
  brickColumns: fc.integer({ min: 1, max: 10 }),
  lives: fc.integer({ min: 1, max: 5 }),
  ballSpeed: fc.double({ min: 0.5, max: 4, noNaN: true, noDefaultInfinity: true }),
  paddleWidth: fc.double({ min: 8, max: 60, noNaN: true, noDefaultInfinity: true }),
});

const asteroidsConfigArb: fc.Arbitrary<AsteroidsConfig> = fc.record({
  lives: fc.integer({ min: 1, max: 5 }),
  startingAsteroids: fc.integer({ min: 1, max: 5 }),
  asteroidGrowth: fc.integer({ min: 0, max: 3 }),
  maxAsteroids: fc.integer({ min: 1, max: 9 }),
  asteroidSpeed: fc.double({ min: 0.2, max: 2, noNaN: true, noDefaultInfinity: true }),
  shipTurnSpeed: fc.double({ min: 0.05, max: 0.8, noNaN: true, noDefaultInfinity: true }),
  shipThrust: fc.double({ min: 0.02, max: 0.7, noNaN: true, noDefaultInfinity: true }),
  shipFriction: fc.double({ min: 0.85, max: 1, noNaN: true, noDefaultInfinity: true }),
  maxShipSpeed: fc.double({ min: 0.5, max: 5, noNaN: true, noDefaultInfinity: true }),
  bulletSpeed: fc.double({ min: 1, max: 6, noNaN: true, noDefaultInfinity: true }),
  bulletTtl: fc.integer({ min: 1, max: 120 }),
  bulletCooldown: fc.integer({ min: 1, max: 40 }),
  respawnInvulnerableTicks: fc.integer({ min: 0, max: 120 }),
});

const froggerConfig: FroggerConfig = {
  lives: 3,
  timeLimitTicks: 900,
  speedMultiplier: 1,
  levelSpeedGrowth: 0.12,
  maxLevel: 3,
  laneProfiles: baseFroggerLaneProfiles,
};

const invaderConfigArb: fc.Arbitrary<InvaderConfig> = fc.record({
  alienRows: fc.integer({ min: 1, max: 5 }),
  alienColumns: fc.integer({ min: 1, max: 10 }),
  lives: fc.integer({ min: 1, max: 5 }),
  playerSpeed: fc.double({ min: 0.5, max: 6, noNaN: true, noDefaultInfinity: true }),
  alienStepEvery: fc.integer({ min: 12, max: 80 }),
  alienShotEvery: fc.integer({ min: 12, max: 120 }),
});

describe("fast-check shared helper properties", () => {
  test("shuffleInPlace preserves every item", () => {
    fc.assert(
      fc.property(fc.array(fc.integer(), { maxLength: 40 }), rngValuesArb, (items, values) => {
        const copy = [...items];
        const shuffled = shuffleInPlace(copy, rngFrom(values));
        expect(shuffled).toBe(copy);
        expectSameMultiset(shuffled, items);
      }),
      propertyOptions,
    );
  });

  test("takeGroupedItems respects total limit, per-group limit, and source order", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ id: fc.nat(1_000), group: fc.string({ maxLength: 3 }) }), {
          maxLength: 80,
        }),
        fc.integer({ min: 0, max: 30 }),
        fc.integer({ min: 0, max: 8 }),
        (items, maxTotal, maxPerGroup) => {
          const selected = takeGroupedItems(items, {
            maxTotal,
            maxPerGroup,
            groupKey: (item) => item.group,
          });
          expect(selected.length).toBeLessThanOrEqual(maxTotal);
          for (const count of countBy(selected, (item) => item.group).values()) {
            expect(count).toBeLessThanOrEqual(maxPerGroup);
          }
          let searchFrom = 0;
          for (const item of selected) {
            const nextIndex = items.indexOf(item, searchFrom);
            expect(nextIndex).toBeGreaterThanOrEqual(searchFrom);
            searchFrom = nextIndex + 1;
          }
        },
      ),
      propertyOptions,
    );
  });

  test("clamp and wrap keep finite values in expected bounds", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -10_000, max: 10_000, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: -1_000, max: 999, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.001, max: 1_000, noNaN: true, noDefaultInfinity: true }),
        (value, min, width) => {
          const max = min + width;
          const clamped = clamp(value, min, max);
          expect(clamped).toBeGreaterThanOrEqual(min);
          expect(clamped).toBeLessThanOrEqual(max);
          if (value >= min && value <= max) expect(clamped).toBe(value);

          const wrapped = wrap(value, min, max);
          expect(wrapped).toBeGreaterThanOrEqual(min);
          expect(wrapped).toBeLessThan(max);
          expect(Math.abs(wrap(wrapped, min, max) - wrapped)).toBeLessThan(1e-9);
        },
      ),
      propertyOptions,
    );
  });

  test("grid movement helpers never leave configured bounds", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 1, max: 20 }),
        directionArb,
        fc.nat(399),
        (rows, columns, direction, rawIndex) => {
          const length = rows * columns;
          const index = rawIndex % length;
          const movedIndex = moveGridIndex(index, direction, columns, length);
          expect(movedIndex).toBeGreaterThanOrEqual(0);
          expect(movedIndex).toBeLessThan(length);

          const point = { row: Math.floor(index / columns), column: index % columns };
          const movedPoint = moveGridPoint(point, direction, rows, columns);
          expect(movedPoint.row).toBeGreaterThanOrEqual(0);
          expect(movedPoint.row).toBeLessThan(rows);
          expect(movedPoint.column).toBeGreaterThanOrEqual(0);
          expect(movedPoint.column).toBeLessThan(columns);
        },
      ),
      propertyOptions,
    );
  });

  test("array parsers accept valid arrays and reject wrong fixed dimensions", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer(), { maxLength: 20 }),
        fc.integer({ min: 0, max: 8 }),
        fc.integer({ min: 0, max: 8 }),
        (items, rows, columns) => {
          const parseNumber = (value: unknown): number | null =>
            typeof value === "number" ? value : null;
          expect(parseArray(items, parseNumber)).toEqual(items);
          expect(parseFixedArray(items, items.length, parseNumber)).toEqual(items);

          const grid = Array.from({ length: rows }, (_, row) =>
            Array.from({ length: columns }, (_, column) => row * columns + column),
          );
          expect(parseFixedGrid(grid, rows, columns, parseNumber)).toEqual(grid);
          expect(parseFixedGrid([...grid, []], rows, columns, parseNumber)).toBeNull();
        },
      ),
      propertyOptions,
    );
  });

  test("swipe classification follows dominant axis past threshold", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: -200, max: 200 }),
        fc.integer({ min: -200, max: 200 }),
        (threshold, x, y) => {
          const direction = directionFromSwipeDelta(x, y, threshold);
          if (Math.max(Math.abs(x), Math.abs(y)) < threshold) {
            expect(direction).toBeNull();
          } else if (Math.abs(x) > Math.abs(y)) {
            expect(direction).toBe(x > 0 ? "right" : "left");
          } else {
            expect(direction).toBe(y > 0 ? "down" : "up");
          }
        },
      ),
      propertyOptions,
    );
  });

  test("rectangle and circle collision predicates catch contained points and separated boxes", () => {
    fc.assert(
      fc.property(
        fc.record({
          x: finitePercentArb,
          y: finitePercentArb,
          width: positiveFiniteArb,
          height: positiveFiniteArb,
        }),
        positiveFiniteArb,
        (rect, radius) => {
          expect(circleIntersectsRect({ x: rect.x, y: rect.y, radius }, rect)).toBe(true);
          expect(
            circleIntersectsRect(
              { x: rect.x + rect.width + radius + 1, y: rect.y + rect.height + radius + 1, radius },
              rect,
            ),
          ).toBe(false);
          expect(rectsOverlap(rect, { ...rect })).toBe(true);
          expect(rectsOverlap(rect, { ...rect, x: rect.x + rect.width + 1 })).toBe(false);
        },
      ),
      propertyOptions,
    );
  });
});

describe("fast-check 2048 properties", () => {
  test("merge2048Line preserves tile sum and compacts zeros to the end", () => {
    fc.assert(
      fc.property(fc.array(tile2048Arb, { minLength: 1, maxLength: 8 }), (line) => {
        const merged = merge2048Line(line);
        expect(merged.line).toHaveLength(line.length);
        expect(sum(merged.line)).toBe(sum(line));
        expect(merged.score).toBeGreaterThanOrEqual(0);

        const firstZero = merged.line.findIndex((value) => value === 0);
        if (firstZero >= 0)
          expect(merged.line.slice(firstZero).every((value) => value === 0)).toBe(true);
      }),
      propertyOptions,
    );
  });

  test("slide2048 keeps board shape and tile sum in every direction", () => {
    fc.assert(
      fc.property(board2048Arb, directionArb, (board, direction) => {
        const result = slide2048(board, direction);
        expectGridShape(result.board, board.length, board.length);
        expect(boardSum(result.board)).toBe(boardSum(board));
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.changed).toBe(!boardsEqual(board, result.board));
      }),
      propertyOptions,
    );
  });

  test("addRandom2048Tile adds one 2-or-4 tile when space exists and never mutates input", () => {
    fc.assert(
      fc.property(board2048Arb, rngValuesArb, (board, values) => {
        const before = board.map((row) => [...row]);
        const next = addRandom2048Tile(board, rngFrom(values));
        expect(board).toEqual(before);
        expectGridShape(next, board.length, board.length);

        const emptyCount = board.flat().filter((value) => value === 0).length;
        if (emptyCount === 0) {
          expect(next).toEqual(board);
        } else {
          expect(countTruthyGrid(next)).toBe(countTruthyGrid(board) + 1);
          expect([2, 4]).toContain(boardSum(next) - boardSum(board));
        }
      }),
      propertyOptions,
    );
  });

  test("canMove2048 agrees with zeros or direction-changing slides", () => {
    fc.assert(
      fc.property(board2048Arb, (board) => {
        const expected =
          board.flat().includes(0) ||
          directions.some((direction) => slide2048(board, direction).changed);
        expect(canMove2048(board)).toBe(expected);
      }),
      propertyOptions,
    );
  });

  test("empty2048Board always creates independent square rows", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 12 }), (size) => {
        const board = empty2048Board(size);
        expectGridShape(board, size, size);
        board[0]![0] = 2;
        expect(board.slice(1).every((row) => row[0] === 0)).toBe(true);
      }),
      propertyOptions,
    );
  });
});

describe("fast-check Tic-Tac-Toe properties", () => {
  test("openTicTacToeCells returns exactly blank indexes", () => {
    fc.assert(
      fc.property(ticTacToeBoardArb, (board) => {
        const open = openTicTacToeCells(board);
        expect(open).toEqual(board.flatMap((cell, index) => (cell === "" ? [index] : [])));
      }),
      propertyOptions,
    );
  });

  test("winningTicTacToeMove returns an open winning index when one exists", () => {
    fc.assert(
      fc.property(ticTacToeBoardArb, fc.constantFrom<Mark>(humanMark, botMark), (board, mark) => {
        const move = winningTicTacToeMove(board, mark);
        if (move === null) return;
        expect(board[move]).toBe("");
        const next = [...board];
        next[move] = mark;
        expect(getTicTacToeWinner(next)?.winner).toBe(mark);
      }),
      propertyOptions,
    );
  });

  test("chooseTicTacToeBotMove always picks an open cell on playable boards", () => {
    fc.assert(
      fc.property(ticTacToeBoardArb, difficultyArb, rngValuesArb, (board, difficulty, values) => {
        fc.pre(openTicTacToeCells(board).length > 0);
        fc.pre(openTicTacToeCells(board).length <= 6 || difficulty !== "Hard");
        const move = chooseTicTacToeBotMove(board, difficulty, rngFrom(values));
        expect(openTicTacToeCells(board)).toContain(move);
      }),
      shortPropertyOptions,
    );
  });

  test("getTicTacToeWinner only reports full same-mark lines", () => {
    fc.assert(
      fc.property(ticTacToeBoardArb, (board) => {
        const result = getTicTacToeWinner(board);
        if (!result) return;
        expect(result.line).toHaveLength(3);
        for (const index of result.line) expect(board[index]).toBe(result.winner);
      }),
      propertyOptions,
    );
  });
});

describe("fast-check Connect 4 properties", () => {
  test("legal move sequences always keep gravity and board shape", () => {
    fc.assert(
      fc.property(connect4CaseArb, ({ board }) => {
        expectGridShape(board, connect4Rows, connect4Columns);
        for (let column = 0; column < connect4Columns; column += 1) {
          let seenEmpty = false;
          for (let row = connect4Rows - 1; row >= 0; row -= 1) {
            const cell = board[row]![column];
            if (cell === 0) seenEmpty = true;
            else expect(seenEmpty).toBe(false);
          }
        }
      }),
      propertyOptions,
    );
  });

  test("playableConnect4Columns exactly matches columns with open top cells", () => {
    fc.assert(
      fc.property(connect4CaseArb, ({ board }) => {
        expect(playableConnect4Columns(board)).toEqual(
          Array.from({ length: connect4Columns }, (_, column) => column).filter(
            (column) => board[0]![column] === 0,
          ),
        );
      }),
      propertyOptions,
    );
  });

  test("dropConnect4DiscInPlace fills the lowest available slot or returns null", () => {
    fc.assert(
      fc.property(
        connect4CaseArb,
        fc.integer({ min: 0, max: connect4Columns - 1 }),
        ({ board }, column) => {
          const before = cloneConnect4Board(board);
          const beforeFilled = countTruthyGrid(before);
          const row = dropConnect4DiscInPlace(board, column, connect4Human);
          const wasFull = before[0]![column] !== 0;
          if (wasFull) {
            expect(row).toBeNull();
            expect(board).toEqual(before);
          } else {
            expect(row).not.toBeNull();
            expect(countTruthyGrid(board)).toBe(beforeFilled + 1);
            expect(board[row!]![column]).toBe(connect4Human);
            expect(board.slice(row! + 1).every((candidate) => candidate[column] !== 0)).toBe(true);
          }
        },
      ),
      propertyOptions,
    );
  });

  test("findConnect4TacticalMove produces an immediate win for the requested player", () => {
    fc.assert(
      fc.property(
        connect4CaseArb,
        fc.constantFrom<Connect4Player>(connect4Human, connect4Bot),
        ({ board }, player) => {
          const column = findConnect4TacticalMove(board, player);
          if (column === null) return;
          expect(playableConnect4Columns(board)).toContain(column);
          const testBoard = cloneConnect4Board(board);
          const row = dropConnect4DiscInPlace(testBoard, column, player);
          expect(row).not.toBeNull();
          expect(findConnect4Win(testBoard, row!, column, player)).not.toBeNull();
        },
      ),
      propertyOptions,
    );
  });

  test("findConnect4Win reports only cells owned by the winning player", () => {
    fc.assert(
      fc.property(connect4CaseArb, ({ board, last }) => {
        if (!last) return;
        const line = findConnect4Win(board, last.row, last.column, last.player);
        if (!line) return;
        expect(line.length).toBeGreaterThanOrEqual(4);
        for (const [row, column] of line) expect(board[row]![column]).toBe(last.player);
      }),
      propertyOptions,
    );
  });
});

describe("fast-check Minesweeper properties", () => {
  test("neighbors stay in bounds, exclude self, and are symmetric", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 12 }),
        fc.nat(143),
        fc.nat(143),
        (rows, columns, rawRow, rawColumn) => {
          const config: MinesweeperConfig = { rows, columns, mines: 0 };
          const row = rawRow % rows;
          const column = rawColumn % columns;
          const neighbors = minesweeperNeighbors(config, row, column);
          expect(neighbors.length).toBeLessThanOrEqual(8);
          for (const [r, c] of neighbors) {
            expect(r).toBeGreaterThanOrEqual(0);
            expect(r).toBeLessThan(rows);
            expect(c).toBeGreaterThanOrEqual(0);
            expect(c).toBeLessThan(columns);
            expect(r === row && c === column).toBe(false);
            expect(minesweeperNeighbors(config, r, c)).toContainEqual([row, column]);
          }
        },
      ),
      propertyOptions,
    );
  });

  test("seededMinesweeperBoard honors safe zone, mine count, and nearby counts", () => {
    fc.assert(
      fc.property(
        minesweeperCaseArb,
        rngValuesArb,
        ({ config, safeRow, safeColumn, mines }, values) => {
          const seededConfig = { ...config, mines };
          const board = seededMinesweeperBoard(seededConfig, safeRow, safeColumn, rngFrom(values));
          const shape = minesweeperShape(seededConfig);
          expectGridShape(board, shape.rows, shape.columns);
          expect(board.flat().filter((cell) => cell.mine)).toHaveLength(mines);

          for (const [row, column] of [
            ...minesweeperNeighbors(seededConfig, safeRow, safeColumn),
            [safeRow, safeColumn] as [number, number],
          ]) {
            expect(board[row]![column]!.mine).toBe(false);
          }

          for (let row = 0; row < shape.rows; row += 1) {
            for (let column = 0; column < shape.columns; column += 1) {
              const nearby = minesweeperNeighbors(seededConfig, row, column).filter(
                ([r, c]) => board[r]![c]!.mine,
              ).length;
              expect(board[row]![column]!.nearby).toBe(nearby);
            }
          }
        },
      ),
      propertyOptions,
    );
  });

  test("newMinesweeperBoard creates closed, unflagged, mine-free grids", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 12 }),
        (rows, columns) => {
          const board = newMinesweeperBoard({ rows, columns, mines: 0 });
          expectGridShape(board, rows, columns);
          expect(openSafeMinesweeperCount(board)).toBe(0);
          expect(
            board
              .flat()
              .every((cell) => !cell.mine && !cell.open && !cell.flag && cell.nearby === 0),
          ).toBe(true);
        },
      ),
      propertyOptions,
    );
  });
});

describe("fast-check Snake properties", () => {
  test("moving a snake point changes exactly one axis by one cell", () => {
    fc.assert(
      fc.property(snakePointArb, directionArb, (point, direction) => {
        const moved = moveSnakePoint(point, direction);
        const manhattan = Math.abs(moved.row - point.row) + Math.abs(moved.column - point.column);
        expect(manhattan).toBe(1);
      }),
      propertyOptions,
    );
  });

  test("wrapSnakePoint returns an in-bounds equivalent point", () => {
    fc.assert(
      fc.property(snakePointArb, fc.integer({ min: 1, max: 60 }), (point, size) => {
        const wrapped = wrapSnakePoint(point, size);
        expect(snakeOutOfBounds(wrapped, size)).toBe(false);
        expect(wrapSnakePoint(wrapped, size)).toEqual(wrapped);
      }),
      propertyOptions,
    );
  });

  test("nextSnakeDirection rejects reversals and duplicate queued directions", () => {
    fc.assert(
      fc.property(directionArb, directionArb, directionArb, (current, queued, next) => {
        const chosen = nextSnakeDirection(current, queued, next);
        if (next === oppositeSnakeDirection[current] || next === queued)
          expect(chosen).toBe(queued);
        else expect(chosen).toBe(next);
      }),
      propertyOptions,
    );
  });

  test("startSnakeBody and randomSnakeFood stay in bounds and avoid occupied cells", () => {
    fc.assert(
      fc.property(fc.integer({ min: 4, max: 25 }), rngValuesArb, (size, values) => {
        const snake = startSnakeBody(size);
        expect(snake).toHaveLength(3);
        for (const point of snake) expect(snakeOutOfBounds(point, size)).toBe(false);

        const food = randomSnakeFood(size, snake, rngFrom(values));
        expect(snakeOutOfBounds(food, size)).toBe(false);
        expect(new Set(snake.map(snakePointKey)).has(snakePointKey(food))).toBe(false);
      }),
      propertyOptions,
    );
  });
});

describe("fast-check Memory properties", () => {
  test("newMemoryDeck creates exactly two closed cards per symbol", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: memorySymbols.length }),
        rngValuesArb,
        (pairs, values) => {
          const deck = newMemoryDeck(pairs, rngFrom(values));
          expect(deck).toHaveLength(pairs * 2);
          expect(new Set(deck.map((card) => card.id)).size).toBe(pairs * 2);
          for (const count of countBy(deck, (card) => card.symbol).values()) expect(count).toBe(2);
          expect(deck.every((card) => !card.open && !card.matched)).toBe(true);
        },
      ),
      propertyOptions,
    );
  });

  test("allMemoryMatched is equivalent to every card being matched", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.nat(),
            symbol: fc.string({ maxLength: 2 }),
            open: fc.boolean(),
            matched: fc.boolean(),
          }),
          { maxLength: 30 },
        ),
        (cards) => {
          expect(allMemoryMatched(cards)).toBe(cards.every((card) => card.matched));
        },
      ),
      propertyOptions,
    );
  });
});

describe("fast-check Tetris properties", () => {
  test("newTetrisBoard has fixed empty dimensions", () => {
    const board = newTetrisBoard();
    expectGridShape(board, tetrisRows, tetrisColumns);
    expect(filledTetrisCells(board)).toBe(0);
  });

  test("every tetromino rotation has four cells and O rotation is stable", () => {
    fc.assert(
      fc.property(tetrominoArb, fc.integer({ min: -8, max: 8 }), (type, rotation) => {
        const piece = { ...spawnTetrisPiece(type), rotation };
        expect(tetrisPieceCells(piece)).toHaveLength(4);
        if (type === "O")
          expect(sortTetrisCells(piece)).toEqual(
            sortTetrisCells({ ...piece, rotation: rotation + 1 }),
          );
      }),
      propertyOptions,
    );
  });

  test("piece moves and rotations either stay put or remain placeable", () => {
    fc.assert(
      fc.property(
        tetrominoArb,
        fc.array(directionArb, { maxLength: 40 }),
        fc.array(fc.boolean(), { maxLength: 12 }),
        (type, moves, rotations) => {
          const board = newTetrisBoard();
          let piece = spawnTetrisPiece(type);
          for (const direction of moves) {
            if (direction === "up") continue;
            piece = moveTetrisPiece(board, piece, direction);
            expect(canPlaceTetrisPiece(board, piece)).toBe(true);
          }
          for (const shouldRotate of rotations) {
            if (shouldRotate) piece = rotateTetrisPiece(board, piece);
            expect(canPlaceTetrisPiece(board, piece)).toBe(true);
          }
        },
      ),
      propertyOptions,
    );
  });

  test("four rotations on an empty board restore spawned piece cells", () => {
    fc.assert(
      fc.property(tetrominoArb, (type) => {
        const board = newTetrisBoard();
        let piece = spawnTetrisPiece(type);
        const original = sortTetrisCells(piece);
        for (let index = 0; index < 4; index += 1) piece = rotateTetrisPiece(board, piece);
        expect(sortTetrisCells(piece)).toEqual(original);
      }),
      propertyOptions,
    );
  });

  test("locking a placeable piece does not mutate the source board", () => {
    fc.assert(
      fc.property(tetrominoArb, fc.array(directionArb, { maxLength: 30 }), (type, moves) => {
        const board = newTetrisBoard();
        const before = board.map((row) => [...row]);
        let piece = spawnTetrisPiece(type);
        for (const direction of moves)
          if (direction !== "up") piece = moveTetrisPiece(board, piece, direction);
        const locked = lockTetrisPiece(board, piece);
        expect(board).toEqual(before);
        expect(filledTetrisCells(locked)).toBe(4);
      }),
      propertyOptions,
    );
  });

  test("clearTetrisLines preserves dimensions and removes exactly full rows", () => {
    fc.assert(
      fc.property(validTetrisBoardArb(), (board) => {
        const fullRows = board.filter((row) => row.every((cell) => cell !== "")).length;
        const nonFullRows = board.filter((row) => row.some((cell) => cell === ""));
        const result = clearTetrisLines(board);
        expect(result.cleared).toBe(fullRows);
        expectGridShape(result.board, tetrisRows, tetrisColumns);
        expect(result.board.slice(fullRows)).toEqual(nonFullRows);
        expect(result.board.every((row) => row.some((cell) => cell === ""))).toBe(true);
      }),
      propertyOptions,
    );
  });

  test("ghost pieces cannot move farther down", () => {
    fc.assert(
      fc.property(tetrominoArb, (type) => {
        const board = newTetrisBoard();
        const ghost = tetrisGhostPiece(board, spawnTetrisPiece(type));
        expect(moveTetrisPiece(board, ghost, "down")).toBe(ghost);
      }),
      propertyOptions,
    );
  });

  test("tetrisLineScore and bags stay inside expected domains", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 8 }),
        fc.integer({ min: 1, max: 40 }),
        rngValuesArb,
        (lines, level, values) => {
          const expected = ([0, 100, 300, 500, 800][lines] ?? 0) * level;
          expect(tetrisLineScore(lines, level)).toBe(expected);

          const rng = rngFrom(values);
          const bag = newTetrisBag(rng);
          expectSameMultiset(bag, tetrominoes);
          const drawn = drawFromBag(bag, rng);
          expect(tetrominoes).toContain(drawn);
          expect(bag.length).toBe(6);
        },
      ),
      propertyOptions,
    );
  });

  test("hard drops settle pieces and never reduce score", () => {
    fc.assert(
      fc.property(tetrominoArb, rngValuesArb, (type, values) => {
        const state = {
          board: newTetrisBoard(),
          piece: spawnTetrisPiece(type),
          next: "I" as const,
          bag: ["T" as const],
          score: 10,
          lines: 0,
          level: 1,
          over: false,
        };
        const dropped = tetrisHardDrop(state, rngFrom(values));
        expect(dropped.score).toBeGreaterThanOrEqual(state.score);
        expectGridShape(dropped.board, tetrisRows, tetrisColumns);
      }),
      propertyOptions,
    );
  });
});

describe("fast-check Ballz properties", () => {
  test("clampBallzAim and ballzAimVector always produce upward vectors with requested speed", () => {
    fc.assert(
      fc.property(
        fc.record({ x: finitePercentArb, y: finitePercentArb }),
        fc.record({ x: finitePercentArb, y: finitePercentArb }),
        fc.double({ min: 0.25, max: 10, noNaN: true, noDefaultInfinity: true }),
        (from, to, speed) => {
          for (const vector of [clampBallzAim(to, speed), ballzAimVector(from, to, speed)]) {
            expect(Math.hypot(vector.x, vector.y)).toBeCloseTo(speed, 8);
            expect(vector.y).toBeLessThan(0);
          }
        },
      ),
      propertyOptions,
    );
  });

  test("rotateBallzAim preserves speed and upward constraint", () => {
    fc.assert(
      fc.property(
        fc.record({ x: finitePercentArb, y: finitePercentArb }),
        fc.double({ min: -Math.PI, max: Math.PI, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.25, max: 10, noNaN: true, noDefaultInfinity: true }),
        (vector, radians, speed) => {
          const rotated = rotateBallzAim(vector, radians, speed);
          expect(Math.hypot(rotated.x, rotated.y)).toBeCloseTo(speed, 8);
          expect(rotated.y).toBeLessThan(0);
        },
      ),
      propertyOptions,
    );
  });

  test("ballzBrickHp stays within scaled round and configured variance", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000 }),
        fc.double({ min: 0, max: 5, noNaN: true, noDefaultInfinity: true }),
        fc.integer({ min: 0, max: 25 }),
        rngValuesArb,
        (round, hpScale, hpVariance, values) => {
          const hp = ballzBrickHp(round, { hpScale, hpVariance }, rngFrom(values));
          const base = Math.max(1, Math.floor(round * hpScale));
          expect(hp).toBeGreaterThanOrEqual(base);
          expect(hp).toBeLessThanOrEqual(base + Math.floor(hpVariance));
        },
      ),
      propertyOptions,
    );
  });

  test("newBallzState and spawnBallzRow create bounded rows with unique ids", () => {
    fc.assert(
      fc.property(ballzConfigArb, rngValuesArb, (config, values) => {
        fc.pre(ballzBrickWidth(config) > 0);
        const state = newBallzState(config, rngFrom(values));
        expect(state.phase).toBe("aiming");
        expect(state.bricks.length).toBeGreaterThanOrEqual(1);
        expect(state.ballCount).toBe(config.startingBalls);
        expect(new Set([...state.bricks, ...state.pickups].map((item) => item.id)).size).toBe(
          state.bricks.length + state.pickups.length,
        );
        for (const brick of state.bricks) {
          expect(brick.width).toBeGreaterThan(0);
          expect(brick.x).toBeGreaterThanOrEqual(config.horizontalMargin - 1e-9);
          expect(brick.x + brick.width).toBeLessThanOrEqual(100 - config.horizontalMargin + 1e-9);
        }

        const empty: BallzState = { ...state, bricks: [], pickups: [], nextId: 1 };
        const spawned = spawnBallzRow(empty, config, rngFrom(values));
        expect(spawned.bricks.length).toBeGreaterThanOrEqual(1);
      }),
      propertyOptions,
    );
  });
});

describe("fast-check Breakout properties", () => {
  test("newBreakoutState creates bricks and clamps paddle movement", () => {
    fc.assert(
      fc.property(breakoutConfigArb, finitePercentArb, (config, centerX) => {
        const state = newBreakoutState(config);
        expect(state.bricks).toHaveLength(config.brickRows * config.brickColumns);
        expect(state.lives).toBe(config.lives);
        const moved = moveBreakoutPaddle(state, centerX);
        expect(moved.paddle.x).toBeGreaterThanOrEqual(0);
        expect(moved.paddle.x + moved.paddle.width).toBeLessThanOrEqual(moved.width);
      }),
      propertyOptions,
    );
  });

  test("stepBreakout leaves terminal states unchanged and keeps counters monotonic from active states", () => {
    fc.assert(
      fc.property(breakoutConfigArb, (config) => {
        const state = newBreakoutState(config);
        const won: BreakoutState = { ...state, won: true };
        const lost: BreakoutState = { ...state, lost: true };
        expect(stepBreakout(won)).toBe(won);
        expect(stepBreakout(lost)).toBe(lost);

        const next = stepBreakout(state);
        expect(next.score).toBeGreaterThanOrEqual(state.score);
        expect(next.lives).toBeLessThanOrEqual(state.lives);
      }),
      propertyOptions,
    );
  });
});

describe("fast-check Asteroids properties", () => {
  test("newAsteroidsState creates unique asteroid ids and expected wave count", () => {
    fc.assert(
      fc.property(
        asteroidsConfigArb,
        fc.integer({ min: 1, max: 12 }),
        rngValuesArb,
        (config, wave, values) => {
          const state = newAsteroidsState(config, wave, rngFrom(values));
          const expectedCount = Math.min(
            config.maxAsteroids,
            config.startingAsteroids + (wave - 1) * config.asteroidGrowth,
          );
          expect(state.asteroids).toHaveLength(expectedCount);
          expect(new Set(state.asteroids.map((asteroid) => asteroid.id)).size).toBe(
            state.asteroids.length,
          );
          expect(state.lives).toBe(config.lives);
          for (const asteroid of state.asteroids) {
            expect(asteroid.x).toBeGreaterThanOrEqual(0);
            expect(asteroid.x).toBeLessThanOrEqual(state.width);
            expect(asteroid.y).toBeGreaterThanOrEqual(0);
            expect(asteroid.y).toBeLessThanOrEqual(state.height);
          }
        },
      ),
      propertyOptions,
    );
  });

  test("ship rotation normalizes angles and thrust caps velocity", () => {
    fc.assert(
      fc.property(
        asteroidsConfigArb,
        fc.double({ min: -100, max: 100, noNaN: true, noDefaultInfinity: true }),
        fc.record({ x: finitePercentArb, y: finitePercentArb }),
        fc.constantFrom<-1 | 0 | 1>(-1, 0, 1),
        (config, angle, velocity, direction) => {
          const base = newAsteroidsState(config);
          const state: AsteroidsState = {
            ...base,
            ship: { ...base.ship, angle, vx: velocity.x, vy: velocity.y },
          };
          const rotated = rotateAsteroidsShip(state, direction, config);
          if (direction === 0) expect(rotated).toBe(state);
          else {
            expect(rotated.ship.angle).toBeGreaterThanOrEqual(-Math.PI);
            expect(rotated.ship.angle).toBeLessThan(Math.PI);
          }

          const thrusted = thrustAsteroidsShip(state, config);
          expect(Math.hypot(thrusted.ship.vx, thrusted.ship.vy)).toBeLessThanOrEqual(
            config.maxShipSpeed + 1e-9,
          );
          expect(thrusted.ship.thrusting).toBe(true);
        },
      ),
      propertyOptions,
    );
  });

  test("firing asteroid bullets increments ids, sets cooldown, and wraps bullet positions", () => {
    fc.assert(
      fc.property(asteroidsConfigArb, (config) => {
        const state = { ...newAsteroidsState(config), bulletCooldown: 0 };
        const fired = fireAsteroidBullet(state, config);
        expect(fired.bullets).toHaveLength(state.bullets.length + 1);
        expect(fired.bulletCooldown).toBe(config.bulletCooldown);
        expect(fired.nextId).toBe(state.nextId + 1);
        const bullet = fired.bullets.at(-1)!;
        expect(bullet.ttl).toBe(config.bulletTtl);
        expect(bullet.x).toBeGreaterThanOrEqual(0);
        expect(bullet.x).toBeLessThan(state.width);
        expect(bullet.y).toBeGreaterThanOrEqual(0);
        expect(bullet.y).toBeLessThan(state.height);
      }),
      propertyOptions,
    );
  });

  test("asteroid circle overlap matches radius-distance comparison", () => {
    fc.assert(
      fc.property(
        fc.record({ x: finitePercentArb, y: finitePercentArb, radius: nonNegativeFiniteArb }),
        fc.record({ x: finitePercentArb, y: finitePercentArb, radius: nonNegativeFiniteArb }),
        (a, b) => {
          const expected = Math.hypot(a.x - b.x, a.y - b.y) <= a.radius + b.radius;
          expect(asteroidsCirclesOverlap(a, b)).toBe(expected);
          expect(asteroidsCirclesOverlap(a, b)).toBe(asteroidsCirclesOverlap(b, a));
        },
      ),
      propertyOptions,
    );
  });

  test("stepAsteroids advances active states and marks empty waves won", () => {
    fc.assert(
      fc.property(asteroidsConfigArb, (config) => {
        const state = { ...newAsteroidsState(config), asteroids: [], bullets: [] };
        const stepped = stepAsteroids(state, config);
        expect(stepped.tick).toBe(state.tick + 1);
        expect(stepped.won).toBe(true);
        expect(stepped.lost).toBe(false);
      }),
      propertyOptions,
    );
  });
});

describe("fast-check Frogger properties", () => {
  test("newFroggerState and newFroggerLanes mirror lane profiles with level-scaled speeds", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 12 }), (level) => {
        const state = newFroggerState(froggerConfig, level);
        const lanes = newFroggerLanes(froggerConfig, level);
        expect(state.columns).toBe(froggerColumns);
        expect(state.lanes).toEqual(lanes);
        expect(lanes).toHaveLength(baseFroggerLaneProfiles.length);
        for (const profile of baseFroggerLaneProfiles) {
          const lane = lanes.find((candidate) => candidate.row === profile.row)!;
          expect(lane.kind).toBe(profile.kind);
          expect(lane.objects).toHaveLength(profile.offsets?.length ?? 0);
        }
      }),
      propertyOptions,
    );
  });

  test("frogger home columns resolve within tolerance", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: froggerHomeColumns.length - 1 }),
        fc.double({ min: -0.44, max: 0.44, noNaN: true, noDefaultInfinity: true }),
        (index, delta) => {
          expect(froggerHomeIndexForColumn(froggerHomeColumns[index]! + delta)).toBe(index);
        },
      ),
      propertyOptions,
    );
  });

  test("froggerObjectCoversColumn exactly reflects object span containment", () => {
    fc.assert(
      fc.property(
        fc.record({
          id: fc.nat(),
          kind: fc.constantFrom<FroggerLaneObject["kind"]>("car", "truck", "log", "turtle"),
          x: fc.double({ min: -20, max: 20, noNaN: true, noDefaultInfinity: true }),
          length: fc.double({ min: 0, max: 10, noNaN: true, noDefaultInfinity: true }),
          speed: fc.double({ min: -2, max: 2, noNaN: true, noDefaultInfinity: true }),
        }),
        fc.integer({ min: -20, max: 20 }),
        (object, column) => {
          const center = column + 0.5;
          expect(froggerObjectCoversColumn(object, column)).toBe(
            center >= object.x && center <= object.x + object.length,
          );
        },
      ),
      propertyOptions,
    );
  });

  test("Frogger movement and ticking keep frog in board or reset after life loss", () => {
    fc.assert(
      fc.property(fc.array(directionArb, { maxLength: 50 }), (moves) => {
        let state = newFroggerState(froggerConfig);
        for (const direction of moves) {
          state = moveFrogger(state, direction, froggerConfig);
          state = stepFrogger(state, froggerConfig);
          expect(state.frog.row).toBeGreaterThanOrEqual(0);
          expect(state.frog.row).toBeLessThan(state.rows);
          expect(state.frog.column).toBeGreaterThanOrEqual(0);
          expect(state.frog.column).toBeLessThanOrEqual(state.columns - 1);
          expect(state.lives).toBeLessThanOrEqual(froggerConfig.lives);
          expect(state.score).toBeGreaterThanOrEqual(0);
        }
      }),
      propertyOptions,
    );
  });
});

describe("fast-check Space Invaders properties", () => {
  test("newInvaderState creates fixed players, aliens, and barriers", () => {
    fc.assert(
      fc.property(invaderConfigArb, fc.integer({ min: 1, max: 2 }), (config, playerCount) => {
        const players = newInvaderPlayers(playerCount);
        const state = newInvaderState(config, 1, players);
        expect(state.players).toHaveLength(playerCount);
        expect(state.aliens).toHaveLength(config.alienRows * config.alienColumns);
        expect(state.barriers).toHaveLength(4);
        expect(state.lives).toBe(config.lives);
        for (const player of state.players) {
          expect(player.x).toBeGreaterThanOrEqual(0);
          expect(player.x + player.width).toBeLessThanOrEqual(state.width);
        }
      }),
      propertyOptions,
    );
  });

  test("scaleInvaderConfigForPlayers never exceeds caps and keeps solo unchanged", () => {
    fc.assert(
      fc.property(invaderConfigArb, fc.integer({ min: 1, max: 4 }), (config, players) => {
        const scaled = scaleInvaderConfigForPlayers(config, players);
        if (players <= 1) expect(scaled).toEqual(config);
        else {
          expect(scaled.alienRows).toBeLessThanOrEqual(5);
          expect(scaled.alienColumns).toBeLessThanOrEqual(10);
          expect(scaled.alienStepEvery).toBeGreaterThanOrEqual(14);
          expect(scaled.alienShotEvery).toBeGreaterThanOrEqual(18);
        }
      }),
      propertyOptions,
    );
  });

  test("aiming and stepping invader players keeps them inside the board", () => {
    fc.assert(
      fc.property(
        invaderConfigArb,
        finitePercentArb,
        fc.constantFrom<-1 | 0 | 1>(-1, 0, 1),
        (config, centerX, move) => {
          const state = newInvaderState(config, 1, newInvaderPlayers(2));
          const aimed = aimInvaderPlayer(state, "p1", centerX);
          const stepped = stepInvadersWithPlayerInputs(aimed, config, [
            { playerId: "p1", move },
            { playerId: "p2", move: -move as -1 | 0 | 1 },
          ]);
          for (const player of stepped.players) {
            expect(player.x).toBeGreaterThanOrEqual(0);
            expect(player.x + player.width).toBeLessThanOrEqual(stepped.width);
          }
        },
      ),
      propertyOptions,
    );
  });

  test("firing invader shots allows at most one active player shot per player", () => {
    fc.assert(
      fc.property(invaderConfigArb, (config) => {
        let state: InvaderState = newInvaderState(config, 1, newInvaderPlayers(2));
        state = fireInvaderPlayerShot(state, "p1");
        state = fireInvaderPlayerShot(state, "p1");
        state = fireInvaderPlayerShot(state, "p2");
        expect(
          state.shots.filter((shot) => shot.owner === "player" && shot.playerId === "p1"),
        ).toHaveLength(1);
        expect(
          state.shots.filter((shot) => shot.owner === "player" && shot.playerId === "p2"),
        ).toHaveLength(1);
      }),
      propertyOptions,
    );
  });

  test("stepInvaders advances active games and terminal states remain unchanged", () => {
    fc.assert(
      fc.property(invaderConfigArb, fc.constantFrom<-1 | 0 | 1>(-1, 0, 1), (config, move) => {
        const state = newInvaderState(config);
        const stepped = stepInvaders(state, config, { move });
        expect(stepped.tick).toBe(state.tick + 1);
        expect(stepped.score).toBeGreaterThanOrEqual(state.score);
        expect(stepped.lives).toBeLessThanOrEqual(state.lives);

        const won: InvaderState = { ...state, won: true };
        const lost: InvaderState = { ...state, lost: true };
        expect(stepInvaders(won, config)).toBe(won);
        expect(stepInvaders(lost, config)).toBe(lost);
      }),
      propertyOptions,
    );
  });
});
