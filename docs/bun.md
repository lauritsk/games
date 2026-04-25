# Bun operations

Use these commands through `mise run <task>` so the pinned Bun version in `mise.toml` is used.

## Build variants

| Task | Output | Notes |
| --- | --- | --- |
| `mise run build` | `dist/` | Static browser build. Uses Bun HTML bundler, code splitting, and a separate `service-worker.js` when PWA is enabled. |
| `mise run build:server` | `/tmp/games-server-build/` | Fullstack Bun bundle. The server imports `index.html`, so Bun emits and routes frontend assets once with the server bundle. |
| `mise run build:production` | `dist/` | Same fullstack production bundle used by the Docker image. |
| `mise run build:single` | `dist-single/index.html` | Standalone single-file browser build. PWA registration is disabled so the page does not try to register a missing service worker. |
| `mise run build:analyze` | `dist-analyze/`, `reports/build/` | Writes Bun `--metafile` JSON and `--metafile-md` module graph reports. |

## Bundle feature flags

The build script forwards `GAMES_BUNDLE_*` variables to Bun with `--env=GAMES_BUNDLE_*`.

| Variable | Default | Effect |
| --- | --- | --- |
| `GAMES_BUNDLE_ONLINE` | `true` | Enables sync and online multiplayer API clients. Set `false` for offline-only bundles. |
| `GAMES_BUNDLE_PWA` | `true` | Enables service-worker registration and service-worker emission. |
| `GAMES_BUNDLE_STATIC_LITE` | `false` | Forces online and PWA features off for a smaller static/offline bundle. |

Examples:

```bash
GAMES_BUNDLE_STATIC_LITE=true mise run build
GAMES_BUNDLE_ONLINE=false GAMES_BUNDLE_PWA=false mise run build:single
```

## Tests and coverage

- `mise run test` runs `bun test --parallel test/*.test.ts`.
- `mise run test:changed` runs `bun test --changed` for local change-focused checks.
- `mise run test:coverage` writes text and LCOV coverage output to `coverage/`.

## Install and audit

- `mise run ci` runs `bun ci` for frozen installs in CI and Docker.
- `mise run audit` runs `bun audit`.

Current audit note: Bun reports a moderate `esbuild <=0.24.2` advisory through `drizzle-kit -> esbuild`. `drizzle-kit` is a dev-only migration generator here, not served in production bundles. Keep the separate audit workflow visible and update `drizzle-kit` when a compatible release removes the advisory.

Dependency install guardrails live in `bunfig.toml`:

- `minimumReleaseAge = 604800` delays newly published packages by 7 days.
- `linker = "isolated"` keeps dependency boundaries stricter than Bun's default hoisted linker.

## Profiling helpers

Bun can write Markdown profiler summaries that are easy to inspect or paste into reviews:

```bash
mise exec -- bun --cpu-prof --cpu-prof-md=reports/profiles/dev.cpu.md src/server/index.ts
mise exec -- bun --heap-prof --heap-prof-md=reports/profiles/dev.heap.md src/server/index.ts
```

Create `reports/profiles/` first if needed. Do not commit profiler reports unless they are intentionally attached to an investigation.

For very small runtime profiles, try Bun's constrained-memory mode locally before using it in deployment:

```bash
mise exec -- bun --smol src/server/index.ts
```
