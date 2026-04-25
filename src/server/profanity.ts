const denied = new Set([
  "asshole",
  "bitch",
  "cunt",
  "dick",
  "fuck",
  "fucker",
  "fucking",
  "hitler",
  "nazi",
  "nigger",
  "nigga",
  "pedo",
  "porn",
  "pussy",
  "shit",
  "slut",
  "whore",
]);

export function containsProfanity(value: string): boolean {
  const words = value
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  if (words.some((word) => denied.has(word))) return true;

  const compact = value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  return [...denied].some((word) => compact === word || compact.includes(word));
}
