import { game2048 } from "@classic-games/2048";
import { connect4 } from "@classic-games/connect4";
import type { GameDefinition } from "@classic-games/core";
import { minesweeper } from "@classic-games/minesweeper";
import { tictactoe } from "@classic-games/tictactoe";

export const games = [connect4, minesweeper, game2048, tictactoe] satisfies GameDefinition[];
