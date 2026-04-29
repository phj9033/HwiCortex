import { describe, it, expect, afterEach } from "vitest";
import { getOverview, getTags, getCollectionDetail, getWikiPageDetail } from "../../src/cli/dashboard.js";
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

describe("getTags", () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => { cleanup?.(); cleanup = null; });

  it("aggregates tag counts across pages and projects", () => {
    const { store, cleanup: c } = makeTempStore(); cleanup = c;
    const vault = makeTempVault();
    writeWikiPage(vault, "p1", "A", "x", { tags: ["popup", "ui"] });
    writeWikiPage(vault, "p1", "B", "x", { tags: ["popup"] });
    writeWikiPage(vault, "p2", "C", "x", { tags: ["ui"] });

    const { tags } = getTags(store, vault);

    const popup = tags.find(t => t.name === "popup")!;
    expect(popup.count).toBe(2);
    expect(popup.projects).toEqual(["p1"]);
    const ui = tags.find(t => t.name === "ui")!;
    expect(ui.count).toBe(2);
    expect(ui.projects.sort()).toEqual(["p1", "p2"]);
  });
});

describe("getCollectionDetail", () => {
  it("returns null for unknown collection", () => {
    const { store, cleanup } = makeTempStore();
    try { expect(getCollectionDetail(store, "nope")).toBeNull(); }
    finally { cleanup(); }
  });
});

describe("getWikiPageDetail", () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => { cleanup?.(); cleanup = null; });

  it("returns frontmatter, body, and backlinks", () => {
    const { store, cleanup: c } = makeTempStore(); cleanup = c;
    const vault = makeTempVault();
    writeWikiPage(vault, "p1", "Target", "target body");
    writeWikiPage(vault, "p1", "Source", "see [[Target]]");

    const detail = getWikiPageDetail(store, vault, "p1", "target");
    expect(detail?.meta.title).toBe("Target");
    expect(detail?.body).toContain("target body");
    expect(detail?.backlinks.some(b => b.title === "Source")).toBe(true);
  });
});
