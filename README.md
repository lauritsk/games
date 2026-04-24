# Classic Games

Tiny monorepo for browser-playable classic games. Built with Bun, TypeScript, and CSS only.

## Apps

- `apps/web` — the web shell and game shelf

## Packages

- `packages/core` — shared game types and DOM helpers
- `packages/connect4` — first game: Connect 4

## Commands

```bash
mise run dev       # start http://localhost:3000
mise run typecheck # TypeScript project references
mise run build     # static build in apps/web/dist
mise run check     # typecheck + build
```

## Add a game

Create a package under `packages/<game>` that exports a `GameDefinition`, then add it to `apps/web/src/main.ts`.

Themes are shared tokens in `apps/web/src/styles.css` and selected by each game's `theme` field. Current theme names: `deep-cave`, `deep-ocean`, `outer-space`, `deep-forest`.
