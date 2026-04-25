import { shuffleInPlace, type RandomSource } from "../core";
import type { Difficulty } from "../types";

export type MemoryCard = { id: number; symbol: string; open: boolean; matched: boolean };
export type MemoryConfig = { pairs: number; columns: number; rows: number };

export const memorySymbols = ["★", "◆", "●", "▲", "☽", "✿", "♣", "☀", "♥", "✦", "⬟", "☂"];

export const memoryConfigs: Record<Difficulty, MemoryConfig> = {
  Easy: { pairs: 6, columns: 4, rows: 3 },
  Medium: { pairs: 8, columns: 4, rows: 4 },
  Hard: { pairs: 12, columns: 6, rows: 4 },
};

export function newMemoryDeck(pairs: number, rng?: RandomSource): MemoryCard[] {
  return shuffleInPlace(
    memorySymbols.slice(0, pairs).flatMap((symbol, id) => [
      { id: id * 2, symbol, open: false, matched: false },
      { id: id * 2 + 1, symbol, open: false, matched: false },
    ]),
    rng,
  );
}

export function allMemoryMatched(cards: MemoryCard[]): boolean {
  return cards.every((card) => card.matched);
}

export function openUnmatchedMemoryCards(cards: MemoryCard[]): MemoryCard[] {
  return cards.filter((item) => item.open && !item.matched);
}
