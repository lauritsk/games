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
  const primitive = oneOf([stringSchema(), numberSchema(), { type: "boolean" }]);
  const primitiveRecord = objectSchema({}, [], { additionalProperties: primitive });
  const resultMetrics = resultMetricSchemas();

  return {
    EmptyObject: objectSchema(),
    ApiError: objectSchema({ ok: { const: false }, error: stringSchema() }, ["ok", "error"], {
      additionalProperties: true,
    }),
    SyncStatusResponse: successResponse({ storage: { const: "bun:sqlite" } }, ["storage"]),
    SyncSnapshotResponse: successResponse({ snapshot: schemaRef("SyncSnapshot") }, ["snapshot"]),
    SyncPush: objectSchema({ deviceId: syncId(), ...syncCollectionProperties() }, ["deviceId"]),
    SyncSnapshot: objectSchema(syncCollectionProperties(), [
      "preferences",
      "saves",
      "deletedSaves",
      "results",
      "resultClears",
    ]),
    SyncPreference: syncPayloadSchema("data"),
    SyncSave: syncPayloadSchema("data"),
    SyncSaveTombstone: objectSchema({ gameId: syncId(), deletedAt: timestamp() }, [
      "gameId",
      "deletedAt",
    ]),
    SyncResultClear: objectSchema({ gameId: syncId(), clearedAt: timestamp() }, ["clearedAt"]),
    SyncResult: objectSchema(
      {
        id: syncId(),
        runId: syncId(),
        gameId: syncId(),
        finishedAt: timestamp(),
        difficulty: difficultySchema(),
        outcome: outcomeSchema(),
        ...resultMetrics,
        metadata: primitiveRecord,
      },
      ["id", "runId", "gameId", "finishedAt", "outcome"],
    ),
    LeaderboardSubmission: objectSchema(
      {
        deviceId: stringSchema(),
        runId: stringSchema(),
        gameId: stringSchema(),
        username: stringSchema(),
        difficulty: difficultySchema(),
        outcome: outcomeSchema(),
        ...resultMetrics,
        metadata: primitiveRecord,
      },
      ["gameId", "username", "outcome"],
      { additionalProperties: true },
    ),
    LeaderboardEntry: objectSchema(
      {
        id: stringSchema(),
        gameId: stringSchema(),
        username: stringSchema(),
        difficulty: difficultySchema(),
        outcome: stringSchema(),
        metric: stringSchema(),
        metricValue: numberSchema(),
        ...resultMetrics,
        metadata: primitiveRecord,
        createdAt: stringSchema(),
        rank: integerSchema(),
      },
      ["id", "gameId", "username", "outcome", "metric", "metricValue", "metadata", "createdAt"],
    ),
    LeaderboardListResponse: successResponse({ entries: arrayOf(schemaRef("LeaderboardEntry")) }, [
      "entries",
    ]),
    LeaderboardSubmitResponse: successResponse(
      { rank: integerSchema(), entry: schemaRef("LeaderboardEntry") },
      ["rank", "entry"],
    ),
    CreateMultiplayerRoomRequest: objectSchema(
      { gameId: stringSchema({ minLength: 1 }), settings: {} },
      ["gameId"],
    ),
    RoomCodeRequest: objectSchema({ code: stringSchema({ default: "" }) }),
    MultiplayerStatusResponse: successResponse(),
    MultiplayerSessionResponse: successResponse({ session: schemaRef("MultiplayerSession") }, [
      "session",
    ]),
    MultiplayerSession: objectSchema(
      {
        code: stringSchema(),
        gameId: stringSchema(),
        playerId: stringSchema(),
        playerToken: stringSchema(),
        seat: enumSchema(["p1", "p2", "p3", "p4"]),
        role: enumSchema(["player", "spectator"]),
      },
      ["code", "gameId", "playerId", "playerToken", "seat"],
    ),
  };
}

function objectSchema(
  properties: JsonObject = {},
  required: readonly string[] = [],
  extra: JsonObject = {},
): JsonObject {
  return {
    type: "object",
    ...(required.length ? { required: [...required] } : {}),
    ...(Object.keys(properties).length ? { properties } : {}),
    ...extra,
  };
}

function successResponse(
  properties: JsonObject = {},
  required: readonly string[] = [],
): JsonObject {
  return oneOf([
    objectSchema({ ok: { const: true }, ...properties }, ["ok", ...required]),
    schemaRef("ApiError"),
  ]);
}

function oneOf(schemas: JsonObject[]): JsonObject {
  return { oneOf: schemas };
}

function arrayOf(items: JsonObject): JsonObject {
  return { type: "array", items };
}

function arrayRef(name: string): JsonObject {
  return arrayOf(schemaRef(name));
}

function stringSchema(extra: JsonObject = {}): JsonObject {
  return { type: "string", ...extra };
}

function numberSchema(): JsonObject {
  return { type: "number" };
}

function integerSchema(): JsonObject {
  return { type: "integer" };
}

function enumSchema(values: readonly string[]): JsonObject {
  return { enum: [...values] };
}

function difficultySchema(): JsonObject {
  return enumSchema(["Easy", "Medium", "Hard"]);
}

function outcomeSchema(): JsonObject {
  return enumSchema(["won", "lost", "draw", "completed"]);
}

function resultMetricSchemas(): JsonObject {
  return {
    score: numberSchema(),
    moves: numberSchema(),
    durationMs: numberSchema(),
    level: numberSchema(),
    streak: numberSchema(),
  };
}

function syncCollectionProperties(): JsonObject {
  return {
    preferences: arrayRef("SyncPreference"),
    saves: arrayRef("SyncSave"),
    deletedSaves: arrayRef("SyncSaveTombstone"),
    results: arrayRef("SyncResult"),
    resultClears: arrayRef("SyncResultClear"),
  };
}

function syncPayloadSchema(dataKey: "data"): JsonObject {
  return objectSchema({ gameId: syncId(), updatedAt: timestamp(), [dataKey]: {} }, [
    "gameId",
    "updatedAt",
    dataKey,
  ]);
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
