import { beforeEach, describe, expect, test } from "bun:test";
import { readStored, removeStored, storageKey, writeStored } from "@shared/storage";

class FakeStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
  clear(): void {
    this.values.clear();
  }
}

const storage = new FakeStorage();

beforeEach(() => {
  storage.clear();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
});

describe("storage helpers", () => {
  test("namespaces keys", () => {
    expect(storageKey("saves", "2048")).toBe("games:v1:saves:2048");
  });

  test("writes and reads JSON envelopes", () => {
    const key = storageKey("thing");
    expect(writeStored(key, 1, { value: 42 })).toBe(true);
    expect(readStored(key, 1, (value) => value as { value: number })).toEqual({ value: 42 });
  });

  test("returns null for missing or schema-mismatched data", () => {
    const key = storageKey("missing");
    expect(readStored(key, 1, (value) => value)).toBeNull();
    writeStored(key, 1, { ok: true });
    expect(readStored(key, 2, (value) => value)).toBeNull();
  });

  test("ignores corrupt JSON and removes it", () => {
    const key = storageKey("bad");
    storage.setItem(key, "{");
    expect(readStored(key, 1, (value) => value)).toBeNull();
    expect(storage.getItem(key)).toBeNull();
  });

  test("removeStored does not throw", () => {
    const key = storageKey("gone");
    writeStored(key, 1, true);
    removeStored(key);
    expect(readStored(key, 1, (value) => value)).toBeNull();
  });
});
