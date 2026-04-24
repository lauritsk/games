import { describe, expect, test } from "bun:test";
import { canMove2048, merge2048Line, slide2048 } from "../src/games/2048.logic";
import { connect4Human, dropConnect4Disc, findConnect4TacticalMove, findConnect4Win, newConnect4Board } from "../src/games/connect4.logic";
import { floodOpenMinesweeper, minesweeperNeighbors, newMinesweeperBoard, openSafeMinesweeperCount, seededMinesweeperBoard, type MinesweeperConfig } from "../src/games/minesweeper.logic";
import { allMemoryMatched, newMemoryDeck, openUnmatchedMemoryCards, type MemoryCard } from "../src/games/memory.logic";
import { moveSnakePoint, nextSnakeDirection, snakeOutOfBounds, snakePointsEqual, startSnakeBody } from "../src/games/snake.logic";
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
    expect(dropConnect4Disc(board, 0, connect4Human)).toBe(5);
    expect(dropConnect4Disc(board, 0, connect4Human)).toBe(4);

    const winBoard = newConnect4Board();
    for (const column of [0, 1, 2, 3]) dropConnect4Disc(winBoard, column, connect4Human);
    expect(findConnect4Win(winBoard, 5, 3, connect4Human)).not.toBeNull();

    const tacticalBoard = newConnect4Board();
    for (const column of [0, 1, 2]) dropConnect4Disc(tacticalBoard, column, connect4Human);
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
    floodOpenMinesweeper(board, { size: 3, mines: 0 }, 1, 1);
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
