import { containsProfanity } from "./profanity";

export const usernameError = "Choose another name.";

const reservedNames = new Set([
  "admin",
  "administrator",
  "mod",
  "moderator",
  "system",
  "null",
  "undefined",
  "anonymous",
  "leaderboard",
  "games",
  "support",
  "root",
]);

const allowedPattern = /^[\p{L}\p{N} _-]+$/u;
const controlPattern = /[\p{Cc}\p{Cf}]/u;
const urlPattern = /(?:https?:\/\/|www\.|\.[a-z]{2,}\b)/iu;
const emailPattern = /\S+@\S+\.\S+/u;

export type UsernameValidation =
  | { ok: true; username: string; normalizedUsername: string }
  | { ok: false; error: typeof usernameError };

export function normalizeUsername(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

export function validateUsername(value: unknown): UsernameValidation {
  if (typeof value !== "string" || controlPattern.test(value)) return invalid();
  const username = normalizeUsername(value);
  const visibleLength = [...username].length;
  const normalizedUsername = username.toLocaleLowerCase();

  if (
    visibleLength < 3 ||
    visibleLength > 16 ||
    controlPattern.test(username) ||
    !allowedPattern.test(username) ||
    urlPattern.test(username) ||
    emailPattern.test(username) ||
    reservedNames.has(normalizedUsername) ||
    containsProfanity(username)
  ) {
    return invalid();
  }

  return { ok: true, username, normalizedUsername };
}

function invalid(): UsernameValidation {
  return { ok: false, error: usernameError };
}
