import { describe, it, expect, afterEach } from "vitest";
import { getOverview } from "../../src/cli/dashboard.js";
import { makeTempStore, makeTempVault, writeWikiPage } from "./fixtures.js";

describe("getOverview", () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => { cleanup?.(); cleanup = null; });

  it("returns vault counters and wiki activity", () => {
    const { store, cleanup: c } = makeTempStore();
    cleanup = c;
    const vault = makeTempVault();
    writeWikiPage(vault, "p1", "Page A", "body", { tags: ["x"], importance: 6, hit_count: 10 });
    writeWikiPage(vault, "p1", "Page B", "body", { tags: ["y"], importance: 1, hit_count: 0 });

    const result = getOverview(store, vault);

    expect(result.vault.path).toBe(vault);
    expect(result.vault.totalWikiPages).toBe(2);
    expect(result.wiki.recent.length).toBeGreaterThan(0);
    expect(result.wiki.topHits[0].hit_count).toBe(10);
    expect(result.wiki.highImportance.some(p => p.title === "Page A")).toBe(true);
    expect(result.alerts).toEqual([]); // alerts come in Task 6
  });
});
