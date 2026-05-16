import * as v from "valibot";
import { multiplayerSeats } from "@features/multiplayer/multiplayer-protocol";
import { finiteNumberSchema, integerSchema } from "@shared/validation";

export const apiErrorResponseSchema = v.looseObject({
  ok: v.literal(false),
  error: v.string(),
});

export const roomCodeRequestSchema = v.looseObject({ code: v.optional(v.string(), "") });
export const createMultiplayerRoomRequestSchema = v.looseObject({
  gameId: v.pipe(v.string(), v.minLength(1)),
  settings: v.optional(v.unknown()),
});

const multiplayerSeatSchema = v.picklist(multiplayerSeats);
const multiplayerSessionSchema = v.looseObject({
  code: v.string(),
  gameId: v.string(),
  playerId: v.string(),
  playerToken: v.string(),
  seat: multiplayerSeatSchema,
  role: v.optional(v.picklist(["player", "spectator"])),
});

const multiplayerSeatSnapshotSchema = v.object({
  joined: v.boolean(),
  connected: v.boolean(),
  ready: v.optional(v.boolean()),
});

export const multiplayerRoomSnapshotSchema = v.looseObject({
  code: v.string(),
  gameId: v.string(),
  status: v.picklist(["lobby", "countdown", "playing", "finished"]),
  revision: integerSchema,
  seats: v.object({
    p1: multiplayerSeatSnapshotSchema,
    p2: multiplayerSeatSnapshotSchema,
    p3: multiplayerSeatSnapshotSchema,
    p4: multiplayerSeatSnapshotSchema,
  }),
  state: v.unknown(),
  settings: v.optional(v.unknown()),
  countdownEndsAt: v.optional(finiteNumberSchema),
  spectatorCount: v.optional(integerSchema),
});

export const multiplayerStatusResponseSchema = v.union([
  v.object({ ok: v.literal(true) }),
  apiErrorResponseSchema,
]);

export const multiplayerSessionResponseSchema = v.union([
  v.object({ ok: v.literal(true), session: multiplayerSessionSchema }),
  apiErrorResponseSchema,
]);

export const multiplayerSocketErrorResponseSchema = v.union([
  apiErrorResponseSchema,
  v.object({ ok: v.literal(false), error: v.literal("Upgrade required") }),
]);

export const clientMessageSchema = v.variant("type", [
  v.object({ type: v.literal("start"), revision: integerSchema }),
  v.object({ type: v.literal("rematch"), revision: integerSchema }),
  v.object({ type: v.literal("settings"), revision: integerSchema, settings: v.unknown() }),
  v.object({ type: v.literal("action"), revision: integerSchema, action: v.unknown() }),
]);

export const serverMessageSchema = v.variant("type", [
  v.looseObject({
    type: v.literal("snapshot"),
    you: v.optional(
      v.object({
        playerId: v.string(),
        seat: multiplayerSeatSchema,
        role: v.optional(v.picklist(["player", "spectator"])),
      }),
    ),
    room: multiplayerRoomSnapshotSchema,
  }),
  v.looseObject({
    type: v.literal("error"),
    error: v.string(),
    room: v.optional(multiplayerRoomSnapshotSchema),
  }),
]);

export type ApiHttpMethod = "GET" | "POST";
export type ApiBodyKind = "none" | "json" | "websocket";

export type ApiEndpointContract = {
  operationId: string;
  method: ApiHttpMethod;
  path: string;
  summary: string;
  tags: readonly string[];
  bodyKind: ApiBodyKind;
  requestSchema?: v.GenericSchema;
  responseSchema: v.GenericSchema;
  query?: readonly ApiQueryParameter[];
};

export type ApiQueryParameter = {
  name: string;
  required?: boolean;
  description: string;
  schema: ApiOpenApiScalar;
};

export type ApiOpenApiScalar = {
  type: "string" | "integer" | "number" | "boolean";
  minimum?: number;
  maximum?: number;
  default?: string | number | boolean;
};

export const apiContract = [
  {
    operationId: "getMultiplayerStatus",
    method: "GET",
    path: "/api/multiplayer/status",
    summary: "Check multiplayer availability.",
    tags: ["Multiplayer"],
    bodyKind: "none",
    responseSchema: multiplayerStatusResponseSchema,
  },
  {
    operationId: "createMultiplayerRoom",
    method: "POST",
    path: "/api/multiplayer/rooms",
    summary: "Create a private multiplayer room.",
    tags: ["Multiplayer"],
    bodyKind: "json",
    requestSchema: createMultiplayerRoomRequestSchema,
    responseSchema: multiplayerSessionResponseSchema,
  },
  {
    operationId: "joinMultiplayerRoom",
    method: "POST",
    path: "/api/multiplayer/rooms/join",
    summary: "Join an open multiplayer room as a player.",
    tags: ["Multiplayer"],
    bodyKind: "json",
    requestSchema: roomCodeRequestSchema,
    responseSchema: multiplayerSessionResponseSchema,
  },
  {
    operationId: "spectateMultiplayerRoom",
    method: "POST",
    path: "/api/multiplayer/rooms/spectate",
    summary: "Join an existing multiplayer room as a spectator.",
    tags: ["Multiplayer"],
    bodyKind: "json",
    requestSchema: roomCodeRequestSchema,
    responseSchema: multiplayerSessionResponseSchema,
  },
  {
    operationId: "connectMultiplayerSocket",
    method: "GET",
    path: "/api/multiplayer/socket",
    summary: "Upgrade to the multiplayer WebSocket protocol.",
    tags: ["Multiplayer"],
    bodyKind: "websocket",
    responseSchema: multiplayerSocketErrorResponseSchema,
    query: [
      { name: "code", required: true, description: "Room code.", schema: { type: "string" } },
      {
        name: "playerId",
        required: true,
        description: "Session player id.",
        schema: { type: "string" },
      },
      {
        name: "token",
        required: true,
        description: "Session bearer token.",
        schema: { type: "string" },
      },
    ],
  },
] as const satisfies readonly ApiEndpointContract[];

export function parseQuery<TSchema extends v.GenericSchema>(
  schema: TSchema,
  url: URL,
): v.InferOutput<TSchema> | null {
  const value = Object.fromEntries(url.searchParams.entries());
  const result = v.safeParse(schema, value);
  return result.success ? result.output : null;
}

export function validateApiResponse<TSchema extends v.GenericSchema>(
  schema: TSchema,
  value: unknown,
): v.InferOutput<TSchema> {
  if (process.env["NODE_ENV"] === "production") return value as v.InferOutput<TSchema>;
  const result = v.safeParse(schema, value);
  if (result.success) return result.output;
  console.warn("Invalid API response", result.issues);
  return value as v.InferOutput<TSchema>;
}

export function apiJson<TSchema extends v.GenericSchema>(
  schema: TSchema,
  value: unknown,
  status = 200,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(validateApiResponse(schema, value)), {
    status,
    headers: {
      "content-type": "application/json;charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export function apiError(error: string, status = 400, headers?: Record<string, string>): Response {
  return apiJson(apiErrorResponseSchema, { ok: false, error }, status, headers);
}

export function tooManyRequests(): Response {
  return apiError("Too many requests", 429);
}
