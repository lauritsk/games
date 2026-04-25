import { apiContract, type ApiEndpointContract, type ApiOpenApiScalar } from "@server/api-contract";

type JsonObject = Record<string, unknown>;

const openApi = {
  openapi: "3.1.0",
  info: {
    title: "Games API",
    version: "1.0.0",
    description: "Generated from src/server/api-contract.ts Valibot-backed endpoint contracts.",
  },
  paths: buildPaths(),
  components: {
    schemas: buildSchemas(),
  },
} satisfies JsonObject;

await Bun.write("docs/openapi.json", `${JSON.stringify(openApi, null, 2)}\n`);
await Bun.write("docs/api.md", markdown());
await formatJson("docs/openapi.json");

async function formatJson(path: string): Promise<void> {
  try {
    const proc = Bun.spawn(["oxfmt", "--write", path], { stdout: "ignore", stderr: "ignore" });
    await proc.exited;
  } catch {
    // Formatting is enforced by `mise run lint`; keep docs generation usable without oxfmt in PATH.
  }
}

function buildPaths(): JsonObject {
  const paths: JsonObject = {};
  for (const endpoint of apiContract) {
    const path = (paths[endpoint.path] ?? {}) as JsonObject;
    path[endpoint.method.toLowerCase()] = operation(endpoint);
    paths[endpoint.path] = path;
  }
  return paths;
}

function operation(endpoint: ApiEndpointContract): JsonObject {
  return {
    operationId: endpoint.operationId,
    summary: endpoint.summary,
    tags: endpoint.tags,
    ...(endpoint.query?.length ? { parameters: endpoint.query.map(queryParameter) } : {}),
    ...(endpoint.bodyKind === "json"
      ? {
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: schemaRef(requestSchemaName(endpoint.operationId)) },
            },
          },
        }
      : {}),
    responses: {
      "200": {
        description:
          endpoint.bodyKind === "websocket"
            ? "WebSocket upgrade succeeds."
            : "Successful response.",
        ...(endpoint.bodyKind === "websocket"
          ? {}
          : {
              content: {
                "application/json": { schema: schemaRef(responseSchemaName(endpoint.operationId)) },
              },
            }),
      },
      default: {
        description: "Error response.",
        content: { "application/json": { schema: schemaRef("ApiError") } },
      },
    },
  };
}

function queryParameter(parameter: NonNullable<ApiEndpointContract["query"]>[number]): JsonObject {
  return {
    name: parameter.name,
    in: "query",
    required: parameter.required ?? false,
    description: parameter.description,
    schema: openApiScalar(parameter.schema),
  };
}

function openApiScalar(scalar: ApiOpenApiScalar): JsonObject {
  return {
    type: scalar.type,
    ...(scalar.minimum === undefined ? {} : { minimum: scalar.minimum }),
    ...(scalar.maximum === undefined ? {} : { maximum: scalar.maximum }),
    ...(scalar.default === undefined ? {} : { default: scalar.default }),
  };
}

function schemaRef(name: string): JsonObject {
  return { $ref: `#/components/schemas/${name}` };
}

function requestSchemaName(operationId: string): string {
  const names: Record<string, string> = {
    pushSyncSnapshot: "SyncPush",
    submitLeaderboardScore: "LeaderboardSubmission",
    createMultiplayerRoom: "CreateMultiplayerRoomRequest",
    joinMultiplayerRoom: "RoomCodeRequest",
    spectateMultiplayerRoom: "RoomCodeRequest",
  };
  return names[operationId] ?? "EmptyObject";
}

function responseSchemaName(operationId: string): string {
  const names: Record<string, string> = {
    getSyncStatus: "SyncStatusResponse",
    getSyncSnapshot: "SyncSnapshotResponse",
    pushSyncSnapshot: "SyncSnapshotResponse",
    listLeaderboard: "LeaderboardListResponse",
    submitLeaderboardScore: "LeaderboardSubmitResponse",
    getMultiplayerStatus: "MultiplayerStatusResponse",
    createMultiplayerRoom: "MultiplayerSessionResponse",
    joinMultiplayerRoom: "MultiplayerSessionResponse",
    spectateMultiplayerRoom: "MultiplayerSessionResponse",
    connectMultiplayerSocket: "ApiError",
  };
  return names[operationId] ?? "ApiError";
}

function buildSchemas(): JsonObject {
  const primitive = { oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }] };
  const primitiveRecord = { type: "object", additionalProperties: primitive };
  const apiError = {
    type: "object",
    required: ["ok", "error"],
    properties: { ok: { const: false }, error: { type: "string" } },
    additionalProperties: true,
  };
  const syncSnapshot = {
    type: "object",
    required: ["preferences", "saves", "deletedSaves", "results", "resultClears"],
    properties: {
      preferences: { type: "array", items: schemaRef("SyncPreference") },
      saves: { type: "array", items: schemaRef("SyncSave") },
      deletedSaves: { type: "array", items: schemaRef("SyncSaveTombstone") },
      results: { type: "array", items: schemaRef("SyncResult") },
      resultClears: { type: "array", items: schemaRef("SyncResultClear") },
    },
  };
  const resultMetrics = {
    score: { type: "number" },
    moves: { type: "number" },
    durationMs: { type: "number" },
    level: { type: "number" },
    streak: { type: "number" },
  };

  return {
    EmptyObject: { type: "object" },
    ApiError: apiError,
    SyncStatusResponse: {
      oneOf: [
        {
          type: "object",
          required: ["ok", "storage"],
          properties: { ok: { const: true }, storage: { const: "bun:sqlite" } },
        },
        schemaRef("ApiError"),
      ],
    },
    SyncSnapshotResponse: {
      oneOf: [
        {
          type: "object",
          required: ["ok", "snapshot"],
          properties: { ok: { const: true }, snapshot: schemaRef("SyncSnapshot") },
        },
        schemaRef("ApiError"),
      ],
    },
    SyncPush: {
      type: "object",
      required: ["deviceId"],
      properties: {
        deviceId: syncId(),
        preferences: { type: "array", items: schemaRef("SyncPreference") },
        saves: { type: "array", items: schemaRef("SyncSave") },
        deletedSaves: { type: "array", items: schemaRef("SyncSaveTombstone") },
        results: { type: "array", items: schemaRef("SyncResult") },
        resultClears: { type: "array", items: schemaRef("SyncResultClear") },
      },
    },
    SyncSnapshot: syncSnapshot,
    SyncPreference: {
      type: "object",
      required: ["gameId", "updatedAt", "data"],
      properties: { gameId: syncId(), updatedAt: timestamp(), data: {} },
    },
    SyncSave: {
      type: "object",
      required: ["gameId", "updatedAt", "data"],
      properties: { gameId: syncId(), updatedAt: timestamp(), data: {} },
    },
    SyncSaveTombstone: {
      type: "object",
      required: ["gameId", "deletedAt"],
      properties: { gameId: syncId(), deletedAt: timestamp() },
    },
    SyncResultClear: {
      type: "object",
      required: ["clearedAt"],
      properties: { gameId: syncId(), clearedAt: timestamp() },
    },
    SyncResult: {
      type: "object",
      required: ["id", "runId", "gameId", "finishedAt", "outcome"],
      properties: {
        id: syncId(),
        runId: syncId(),
        gameId: syncId(),
        finishedAt: timestamp(),
        difficulty: { enum: ["Easy", "Medium", "Hard"] },
        outcome: { enum: ["won", "lost", "draw", "completed"] },
        ...resultMetrics,
        metadata: primitiveRecord,
      },
    },
    LeaderboardSubmission: {
      type: "object",
      required: ["gameId", "username", "outcome"],
      properties: {
        deviceId: { type: "string" },
        runId: { type: "string" },
        gameId: { type: "string" },
        username: { type: "string" },
        difficulty: { enum: ["Easy", "Medium", "Hard"] },
        outcome: { enum: ["won", "lost", "draw", "completed"] },
        ...resultMetrics,
        metadata: primitiveRecord,
      },
      additionalProperties: true,
    },
    LeaderboardEntry: {
      type: "object",
      required: [
        "id",
        "gameId",
        "username",
        "outcome",
        "metric",
        "metricValue",
        "metadata",
        "createdAt",
      ],
      properties: {
        id: { type: "string" },
        gameId: { type: "string" },
        username: { type: "string" },
        difficulty: { enum: ["Easy", "Medium", "Hard"] },
        outcome: { type: "string" },
        metric: { type: "string" },
        metricValue: { type: "number" },
        ...resultMetrics,
        metadata: primitiveRecord,
        createdAt: { type: "string" },
        rank: { type: "integer" },
      },
    },
    LeaderboardListResponse: {
      oneOf: [
        {
          type: "object",
          required: ["ok", "entries"],
          properties: {
            ok: { const: true },
            entries: { type: "array", items: schemaRef("LeaderboardEntry") },
          },
        },
        schemaRef("ApiError"),
      ],
    },
    LeaderboardSubmitResponse: {
      oneOf: [
        {
          type: "object",
          required: ["ok", "rank", "entry"],
          properties: {
            ok: { const: true },
            rank: { type: "integer" },
            entry: schemaRef("LeaderboardEntry"),
          },
        },
        schemaRef("ApiError"),
      ],
    },
    CreateMultiplayerRoomRequest: {
      type: "object",
      required: ["gameId"],
      properties: { gameId: { type: "string", minLength: 1 }, settings: {} },
    },
    RoomCodeRequest: {
      type: "object",
      properties: { code: { type: "string", default: "" } },
    },
    MultiplayerStatusResponse: {
      oneOf: [
        { type: "object", required: ["ok"], properties: { ok: { const: true } } },
        schemaRef("ApiError"),
      ],
    },
    MultiplayerSessionResponse: {
      oneOf: [
        {
          type: "object",
          required: ["ok", "session"],
          properties: { ok: { const: true }, session: schemaRef("MultiplayerSession") },
        },
        schemaRef("ApiError"),
      ],
    },
    MultiplayerSession: {
      type: "object",
      required: ["code", "gameId", "playerId", "playerToken", "seat"],
      properties: {
        code: { type: "string" },
        gameId: { type: "string" },
        playerId: { type: "string" },
        playerToken: { type: "string" },
        seat: { enum: ["p1", "p2", "p3", "p4"] },
        role: { enum: ["player", "spectator"] },
      },
    },
  };
}

function syncId(): JsonObject {
  return { type: "string", minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9._:-]+$" };
}

function timestamp(): JsonObject {
  return { type: "string", minLength: 1, maxLength: 64 };
}

function markdown(): string {
  const rows = apiContract
    .map(
      (endpoint) =>
        `| \`${endpoint.method}\` | \`${endpoint.path}\` | ${endpoint.tags.join(", ")} | ${endpoint.summary} |`,
    )
    .join("\n");

  return `# Games API\n\nGenerated from \`src/server/api-contract.ts\`. Do not edit by hand; run \`mise run docs:api\`.\n\n## HTTP endpoints\n\n| Method | Path | Tags | Summary |\n| --- | --- | --- | --- |\n${rows}\n\n## Schemas\n\nOpenAPI JSON: [openapi.json](openapi.json).\n\nThe runtime source of truth is the Valibot-backed contract in \`src/server/api-contract.ts\`.\nWebSocket client/server message schemas are included there as \`clientMessageSchema\` and \`serverMessageSchema\`.\n`;
}
