import { describe, it, expect, afterEach } from "vitest";
import { searchDashboard } from "../../src/cli/dashboard.js";
import { makeTempStore } from "./fixtures.js";

describe("searchDashboard", () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => { cleanup?.(); cleanup = null; });

  it("returns empty results for empty/whitespace query", async () => {
    const { store, cleanup: c } = makeTempStore(); cleanup = c;
    expect((await searchDashboard(store, "")).results).toEqual([]);
    expect((await searchDashboard(store, "   ")).results).toEqual([]);
  });

  it("does not throw on special characters", async () => {
    const { store, cleanup: c } = makeTempStore(); cleanup = c;
    await expect(searchDashboard(store, 'foo "bar" *baz')).resolves.toBeDefined();
  });
});
