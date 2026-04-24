import { shuffleInPlace, type RandomSource } from "../core";

export type MemoryCard = { id: number; symbol: string; open: boolean; matched: boolean };

export const memorySymbols = ["★", "◆", "●", "▲", "☽", "✿", "♣", "☀", "♥", "✦", "⬟", "☂"];

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
