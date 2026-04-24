# Classic Games

Tiny browser-playable classic games app. Built with Bun, TypeScript, and CSS only.

## Structure

- `src/main.ts` — app shell and routing
- `src/games.ts` — game registry
- `src/core.ts` — shared game types and DOM helpers
- `src/games/` — individual games
- `src/styles.css` — shared styles and themes

## Commands

```bash
mise run dev       # start http://localhost:3000
mise run typecheck # TypeScript check
mise run build     # static build in dist
mise run check     # typecheck + build
```

## Add a game

Create `src/games/<game>.ts` that exports a `GameDefinition`, then add it to `src/games.ts`.

Themes are shared tokens in `src/styles.css` and selected by each game's `theme` field. Current theme names: `deep-cave`, `deep-ocean`, `outer-space`, `deep-forest`.
