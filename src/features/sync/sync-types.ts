import type { Difficulty } from "@shared/types";
import type { GameMetadata, GameOutcome } from "@features/results/game-results";

export type SyncPreference = {
  gameId: string;
  updatedAt: string;
  data: unknown;
};

export type SyncSave = {
  gameId: string;
  updatedAt: string;
  data: unknown;
};

export type SyncSaveTombstone = {
  gameId: string;
  deletedAt: string;
};

export type SyncResult = {
  id: string;
  runId: string;
  gameId: string;
  finishedAt: string;
  durationMs?: number;
  difficulty?: Difficulty;
  outcome: GameOutcome;
  score?: number;
  moves?: number;
  level?: number;
  streak?: number;
  metadata?: GameMetadata;
};

export type SyncResultClear = {
  gameId?: string;
  clearedAt: string;
};

export type SyncSnapshot = {
  preferences: SyncPreference[];
  saves: SyncSave[];
  deletedSaves: SyncSaveTombstone[];
  results: SyncResult[];
  resultClears: SyncResultClear[];
};

export type SyncPush = SyncSnapshot & {
  deviceId: string;
};
