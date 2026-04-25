import * as v from "valibot";
import { parseWithSchema } from "@shared/validation";

export type ApiJsonResponse = { ok: boolean; error?: string };

const apiResponseSchema = v.looseObject({ ok: v.boolean(), error: v.optional(v.string()) });

export async function requestApiJson<T extends ApiJsonResponse>(
  input: RequestInfo | URL,
  fallbackError: string,
  init?: RequestInit,
): Promise<T> {
  try {
    const response = await fetch(input, { cache: "no-store", ...init });
    const value = (await response.json()) as unknown;
    if (isApiJsonResponse(value)) return value as T;
  } catch {
    // Network failures and invalid JSON are reported as feature-specific API errors below.
  }
  return { ok: false, error: fallbackError } as T;
}

function isApiJsonResponse(value: unknown): value is ApiJsonResponse {
  return parseWithSchema(apiResponseSchema, value) !== null;
}
