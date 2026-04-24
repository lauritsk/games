import { game2048 } from "./games/2048";
import { connect4 } from "./games/connect4";
import type { GameDefinition } from "./core";
import { memory } from "./games/memory";
import { minesweeper } from "./games/minesweeper";
import { snake } from "./games/snake";
import { tictactoe } from "./games/tictactoe";

export const games = [connect4, minesweeper, game2048, tictactoe, snake, memory] satisfies GameDefinition[];
