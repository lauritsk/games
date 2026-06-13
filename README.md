# Games

A small collection of browser games built with TypeScript, Vite, and plain CSS.

## Games

- Connect 4
- Minesweeper
- 2048
- Tic-Tac-Toe
- Snake
- Memory
- Tetris
- Breakout
- Ballz
- Space Invaders
- Asteroids
- Frogger
- Maze Chase

Some games have local multiplayer, bots, saves, leaderboards, or online private rooms when the Node server is running.

## Structure

```text
src/
  app/          app shell and routing
  features/     results, leaderboards, multiplayer
  games/        game implementations
  server/       Node/WebSocket server for online rooms
  shared/       shared helpers
  ui/           styles, assets, sounds

test/           unit tests
e2e/            Playwright tests
docs/           extra notes
```

## Multiplayer

Online rooms need the included Node/WebSocket server. Static hosting still works for local play, but not live multiplayer.

Rooms are in memory only, so they disappear when the server restarts.
