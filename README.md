# Classic Games

Tiny browser-playable classic games app. Built with Bun's HTML bundler/dev server, TypeScript, and CSS only.

## Structure

- `index.html` — Bun HTML bundler entrypoint
- `src/server.ts` — Bun dev server with HMR
- `src/main.ts` — app shell and routing
- `src/games.ts` — game registry
- `src/core.ts` — shared game types and DOM helpers
- `src/games/` — individual games
- `src/styles.css` — shared styles and themes
- `test/` — Bun test runner tests

## Commands

```bash
mise run dev          # start http://localhost:3000 with Bun HMR
mise run typecheck    # TypeScript check
mise run test         # Bun tests
mise run build        # static hashed build in dist
mise run build-single # one-file standalone HTML build in dist-single
mise run check        # typecheck + tests + build
```

## Add a game

Create `src/games/<game>.ts` that exports a `GameDefinition`, then add it to `src/games.ts`.

Themes are shared tokens in `src/styles.css` and selected by each game's `theme` field. Current theme names: `deep-cave`, `deep-ocean`, `outer-space`, `deep-forest`.
