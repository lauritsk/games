import { describe, expect, test } from "bun:test";
import { canMove2048, merge2048Line, slide2048 } from "../src/games/2048.logic";
import { newBreakoutState, moveBreakoutPaddle, stepBreakout, circleIntersectsRect } from "../src/games/breakout.logic";
import { connect4Human, dropConnect4DiscInPlace, findConnect4TacticalMove, findConnect4Win, newConnect4Board } from "../src/games/connect4.logic";
import { floodOpenMinesweeperInPlace, minesweeperNeighbors, newMinesweeperBoard, openSafeMinesweeperCount, seededMinesweeperBoard, type MinesweeperConfig } from "../src/games/minesweeper.logic";
import { allMemoryMatched, newMemoryDeck, openUnmatchedMemoryCards, type MemoryCard } from "../src/games/memory.logic";
import { moveSnakePoint, nextSnakeDirection, snakeOutOfBounds, snakePointsEqual, startSnakeBody } from "../src/games/snake.logic";
import { canPlaceTetrisPiece, clearTetrisLines, lockTetrisPiece, moveTetrisPiece, newTetrisBoard, rotateTetrisPiece, spawnTetrisPiece, tetrisDrop, tetrisGhostPiece, tetrisLineScore, tetrisRows, type TetrisBoard } from "../src/games/tetris.logic";
import { chooseTicTacToeBotMove, getTicTacToeWinner, humanMark, newTicTacToeBoard, winningTicTacToeMove, type TicTacToeCell } from "../src/games/tictactoe.logic";

describe("2048 logic", () => {
  test("merges one pair per tile", () => {
    expect(merge2048Line([2, 2, 2, 2])).toEqual({ line: [4, 4, 0, 0], score: 8 });
    expect(merge2048Line([2, 0, 2, 4])).toEqual({ line: [4, 4, 0, 0], score: 4 });
  });

  test("slides board and detects locked board", () => {
    const result = slide2048([[2, 0], [2, 4]], "up");
    expect(result).toEqual({ board: [[4, 4], [0, 0]], score: 4, changed: true });
    expect(canMove2048([[2, 4], [8, 16]])).toBe(false);
  });
});

describe("breakout logic", () => {
  const config = { brickRows: 1, brickColumns: 2, lives: 2, ballSpeed: 1.2, paddleWidth: 20 };

  test("clamps paddle and detects circle/rect collision", () => {
    const state = newBreakoutState(config);
    expect(moveBreakoutPaddle(state, -50).paddle.x).toBe(0);
    expect(moveBreakoutPaddle(state, 150).paddle.x).toBe(80);
    expect(circleIntersectsRect({ x: 5, y: 5, vx: 0, vy: 0, radius: 2 }, { x: 6, y: 6, width: 5, height: 5 })).toBe(true);
  });

  test("breaks bricks, wins, and loses lives", () => {
    const state = newBreakoutState({ ...config, brickRows: 1, brickColumns: 1 });
    const brick = state.bricks[0]!;
    const hit = stepBreakout({ ...state, ball: { x: brick.x + 1, y: brick.y + brick.height + 1, vx: 0, vy: -1, radius: 1.6 } });
    expect(hit.score).toBe(10);
    expect(hit.won).toBe(true);

    const miss = stepBreakout({ ...state, ball: { x: 50, y: 102, vx: 0, vy: 1, radius: 1.6 } });
    expect(miss.lives).toBe(1);
    expect(miss.lost).toBe(false);
  });

  test("does not bounce when paddle moves under an already-missed ball", () => {
    const state = newBreakoutState(config);
    let missed = {
      ...state,
      paddle: { ...state.paddle, x: 40, width: 20 },
      ball: { x: 50, y: state.paddle.y + 1, vx: 0, vy: 1, radius: 1.6 },
    };

    for (let index = 0; index < 12 && missed.lives === state.lives; index += 1) {
      missed = stepBreakout(missed);
      if (missed.lives === state.lives) expect(missed.ball.vy).toBeGreaterThan(0);
    }

    expect(missed.lives).toBe(state.lives - 1);
  });

  test("does not bounce while moving upward through paddle", () => {
    const state = newBreakoutState(config);
    const upward = stepBreakout({
      ...state,
      paddle: { ...state.paddle, x: 40, width: 20 },
      ball: { x: 50, y: state.paddle.y, vx: 0, vy: -1, radius: 1.6 },
    });
    expect(upward.ball.vy).toBe(-1);
  });

  test("still bounces when ball crosses paddle top", () => {
    const state = newBreakoutState(config);
    const caught = stepBreakout({
      ...state,
      paddle: { ...state.paddle, x: 40, width: 20 },
      ball: { x: 50, y: state.paddle.y - 2.4, vx: 0, vy: 1, radius: 1.6 },
    });
    expect(caught.ball.vy).toBeLessThan(0);
  });
});

describe("tic-tac-toe logic", () => {
  test("finds winners and tactical moves", () => {
    const board: TicTacToeCell[] = ["X", "X", "", "O", "", "", "", "O", ""];
    expect(winningTicTacToeMove(board, humanMark)).toBe(2);
    expect(chooseTicTacToeBotMove(["O", "O", "", "X", "", "", "X", "", ""], "Medium")).toBe(2);
    expect(getTicTacToeWinner(["X", "X", "X", "", "", "", "", "", ""])?.line).toEqual([0, 1, 2]);
    expect(newTicTacToeBoard()).toHaveLength(9);
  });
});

describe("connect 4 logic", () => {
  test("drops discs, finds wins, and finds tactical moves", () => {
    const board = newConnect4Board();
    expect(dropConnect4DiscInPlace(board, 0, connect4Human)).toBe(5);
    expect(dropConnect4DiscInPlace(board, 0, connect4Human)).toBe(4);

    const winBoard = newConnect4Board();
    for (const column of [0, 1, 2, 3]) dropConnect4DiscInPlace(winBoard, column, connect4Human);
    expect(findConnect4Win(winBoard, 5, 3, connect4Human)).not.toBeNull();

    const tacticalBoard = newConnect4Board();
    for (const column of [0, 1, 2]) dropConnect4DiscInPlace(tacticalBoard, column, connect4Human);
    expect(findConnect4TacticalMove(tacticalBoard, connect4Human)).toBe(3);
  });
});

describe("minesweeper logic", () => {
  const config: MinesweeperConfig = { size: 5, mines: 4 };

  test("neighbors stay in bounds", () => {
    expect(minesweeperNeighbors(config, 0, 0)).toEqual([[0, 1], [1, 0], [1, 1]]);
    expect(minesweeperNeighbors(config, 2, 2)).toHaveLength(8);
  });

  test("first board keeps safe area mine-free", () => {
    const board = seededMinesweeperBoard(config, 2, 2);
    for (const [row, column] of [...minesweeperNeighbors(config, 2, 2), [2, 2] as [number, number]]) {
      expect(board[row]![column]!.mine).toBe(false);
    }
    expect(board.flat().filter((cell) => cell.mine)).toHaveLength(config.mines);
  });

  test("flood opens empty cells", () => {
    const board = newMinesweeperBoard({ size: 3, mines: 0 });
    floodOpenMinesweeperInPlace(board, { size: 3, mines: 0 }, 1, 1);
    expect(openSafeMinesweeperCount(board)).toBe(9);
  });
});

describe("snake logic", () => {
  test("moves points and rejects reversal", () => {
    expect(startSnakeBody(10)).toEqual([{ row: 5, column: 5 }, { row: 5, column: 4 }, { row: 5, column: 3 }]);
    expect(moveSnakePoint({ row: 1, column: 1 }, "left")).toEqual({ row: 1, column: 0 });
    expect(nextSnakeDirection("right", "right", "left")).toBe("right");
    expect(snakeOutOfBounds({ row: -1, column: 0 }, 10)).toBe(true);
    expect(snakePointsEqual({ row: 1, column: 2 }, { row: 1, column: 2 })).toBe(true);
  });
});

describe("tetris logic", () => {
  test("rotates pieces and uses wall kicks", () => {
    const board = newTetrisBoard();
    const piece = spawnTetrisPiece("I");
    expect(rotateTetrisPiece(board, piece).rotation).toBe(1);

    const againstLeftWall = { ...spawnTetrisPiece("I"), origin: { row: 2, column: 0 }, rotation: 1 };
    const rotated = rotateTetrisPiece(board, againstLeftWall);
    expect(rotated.rotation).toBe(2);
    expect(canPlaceTetrisPiece(board, rotated)).toBe(true);
  });

  test("locks pieces, clears lines, and scores by level", () => {
    const board = newTetrisBoard();
    const locked = lockTetrisPiece(board, { ...spawnTetrisPiece("O"), origin: { row: 19, column: 4 } });
    expect(locked[19]?.filter(Boolean)).toHaveLength(2);

    const fullBoard: TetrisBoard = newTetrisBoard();
    fullBoard[tetrisRows - 1] = Array.from({ length: 10 }, () => "T");
    const cleared = clearTetrisLines(fullBoard);
    expect(cleared.cleared).toBe(1);
    expect(cleared.board[0]?.every((cell) => cell === "")).toBe(true);
    expect(tetrisLineScore(4, 3)).toBe(2400);
  });

  test("drops until lock and detects game over", () => {
    const board = newTetrisBoard();
    const state = { board, piece: { ...spawnTetrisPiece("O"), origin: { row: 19, column: 4 } }, next: "I" as const, bag: ["T" as const], score: 0, lines: 0, level: 1, over: false };
    expect(tetrisDrop(state).board[19]?.filter(Boolean)).toHaveLength(2);

    const blocked = newTetrisBoard();
    blocked[1] = Array.from({ length: 10 }, () => "Z");
    const blockedState = { ...state, board: blocked, piece: spawnTetrisPiece("O") };
    expect(tetrisDrop(blockedState).over).toBe(true);
    expect(moveTetrisPiece(board, spawnTetrisPiece("T"), "down").origin.row).toBe(2);
  });

  test("finds ghost landing position", () => {
    const board = newTetrisBoard();
    const piece = spawnTetrisPiece("O");
    expect(tetrisGhostPiece(board, piece).origin.row).toBe(19);

    board[18] = Array.from({ length: 10 }, () => "Z");
    expect(tetrisGhostPiece(board, piece).origin.row).toBe(17);
  });
});

describe("memory logic", () => {
  test("creates pairs and identifies open/matched cards", () => {
    const deck = newMemoryDeck(4);
    expect(deck).toHaveLength(8);
    expect(new Set(deck.map((card) => card.symbol)).size).toBe(4);

    const cards: MemoryCard[] = [
      { id: 0, symbol: "★", open: true, matched: false },
      { id: 1, symbol: "★", open: false, matched: true },
    ];
    expect(openUnmatchedMemoryCards(cards)).toHaveLength(1);
    expect(allMemoryMatched(cards)).toBe(false);
  });
});
