import { game2048 } from "./games/2048";
import { breakout } from "./games/breakout";
import { connect4 } from "./games/connect4";
import type { GameDefinition } from "./core";
import { memory } from "./games/memory";
import { minesweeper } from "./games/minesweeper";
import { snake } from "./games/snake";
import { tetris } from "./games/tetris";
import { tictactoe } from "./games/tictactoe";

export const games = [connect4, minesweeper, game2048, tictactoe, snake, memory, tetris, breakout] satisfies GameDefinition[];
