import { describe, expect, test } from "bun:test";
import { parseAppearanceMode, resolveAppearance } from "../src/appearance";

describe("appearance mode", () => {
  test("defaults invalid or missing values to system", () => {
    expect(parseAppearanceMode(null)).toBe("system");
    expect(parseAppearanceMode("sepia")).toBe("system");
  });

  test("system follows light or dark system preference", () => {
    expect(resolveAppearance("system", false)).toBe("light");
    expect(resolveAppearance("system", true)).toBe("dark");
  });

  test("explicit light or dark overrides system preference", () => {
    expect(resolveAppearance("light", true)).toBe("light");
    expect(resolveAppearance("dark", false)).toBe("dark");
  });
});
