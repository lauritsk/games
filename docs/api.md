# Games API

Generated from `src/server/api-contract.ts`. Do not edit by hand; run `mise run docs:api`.

## HTTP endpoints

| Method | Path | Tags | Summary |
| --- | --- | --- | --- |
| `GET` | `/api/sync/status` | Sync | Check server-backed sync availability. |
| `GET` | `/api/sync` | Sync | Read the saved snapshot for one device. |
| `POST` | `/api/sync` | Sync | Merge local saves, preferences, results, and tombstones into server storage. |
| `GET` | `/api/leaderboard` | Leaderboard | List public leaderboard entries for a game. |
| `POST` | `/api/leaderboard` | Leaderboard | Submit one public leaderboard score. |
| `GET` | `/api/multiplayer/status` | Multiplayer | Check multiplayer availability. |
| `POST` | `/api/multiplayer/rooms` | Multiplayer | Create a private multiplayer room. |
| `POST` | `/api/multiplayer/rooms/join` | Multiplayer | Join an open multiplayer room as a player. |
| `POST` | `/api/multiplayer/rooms/spectate` | Multiplayer | Join an existing multiplayer room as a spectator. |
| `GET` | `/api/multiplayer/socket` | Multiplayer | Upgrade to the multiplayer WebSocket protocol. |

## Schemas

OpenAPI JSON: [openapi.json](openapi.json).

The runtime source of truth is the Valibot-backed contract in `src/server/api-contract.ts`.
WebSocket client/server message schemas are included there as `clientMessageSchema` and `serverMessageSchema`.
