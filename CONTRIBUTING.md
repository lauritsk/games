# Contributing

Assume only `mise` is installed globally.

## Setup

```sh
mise install
```

## Workflow

```sh
mise run fix
mise run check
```

Common tasks:

- `mise run fix`
- `mise run lint`
- `mise run test`
- `mise run build`

## Commits

Use Conventional Commits:

```sh
mise exec cocogitto -- cog commit <type> "<message>" [scope]
```

Use `-B` for breaking changes.

## Pull Requests

- Run `mise run check`
- Keep changes focused
- Update tests and docs when behavior changes
- Use a Conventional Commit title

## New game acceptance checklist

Each added game should satisfy this checklist before review:

- Reuse shared project pieces first: `@shared/core`, `@games/shared/arcade`, `@games/shared/controls`, `@shared/keyboard`, `@games/shared/game-input`, shared dialogs/history/results, and theme tokens in `src/ui/styles.css`.
- Keep unique game feel without duplicating generic UI, input, loop, collision, storage, or styling logic that already exists.
- Separate non-trivial rules into `src/games/<game>/logic.ts` and cover them with deterministic tests.
- Register a `GameDefinition` with clear name, description, difficulty/options, theme, and result behavior.
- Look good and remain playable on desktop, tablet, and mobile viewports.
- Avoid page scroll during normal play; if a large board cannot fit, provide intentional in-game pan/zoom/overflow controls that are usable and visually polished.
- Support keyboard, mouse, and touch controls where the game design allows; document any intentional exception in the PR.
- Preserve accessibility basics: visible focus, semantic controls, readable contrast, labels/help text for controls, and no pointer-only required action.
- Handle lifecycle cleanly: start/restart, pause/resume for real-time games, win/loss/draw/end states, cleanup of timers/listeners, and saved/history state where relevant.
- Integrate leaderboards only when there is a fair primary metric; validate eligibility and metadata consistently with existing leaderboard games.
- Include tests for logic plus at least smoke coverage for UI behavior when risk warrants it.
- Run `mise run check` before opening the PR.
