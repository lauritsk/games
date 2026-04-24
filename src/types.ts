export type GameTheme = "deep-cave" | "deep-ocean" | "outer-space" | "deep-forest";
export type Difficulty = "Easy" | "Medium" | "Hard";
export type Direction = "up" | "right" | "down" | "left";
export type GridPoint = { row: number; column: number };
export type RandomSource = () => number;

export type GameDefinition = {
  id: string;
  name: string;
  tagline: string;
  players: string;
  theme: GameTheme;
  mount(target: HTMLElement): () => void;
};
