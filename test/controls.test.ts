import { expect, test } from "bun:test";
import { botPlayModeLabel, nextBotPlayMode } from "@games/shared/controls";

test("bot play mode cycles and labels consistently", () => {
  expect(nextBotPlayMode("bot")).toBe("local");
  expect(nextBotPlayMode("local")).toBe("bot");
  expect(botPlayModeLabel("bot")).toBe("Vs bot");
  expect(botPlayModeLabel("local")).toBe("2 players");
});
