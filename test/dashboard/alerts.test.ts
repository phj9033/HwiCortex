import { describe, it, expect, afterEach } from "vitest";
import { detectAlerts } from "../../src/cli/dashboard.js";
import { makeTempStore, makeTempVault, writeWikiPage } from "./fixtures.js";
import { upsertStoreCollection, insertContent, insertDocument } from "../../src/store.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";

describe("detectAlerts", () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => { cleanup?.(); cleanup = null; });

  it("flags overlap when one collection path is a prefix of another", () => {
    const { store, cleanup: c } = makeTempStore();
    cleanup = c;
    const vault = makeTempVault();
    const db = store.db;

    // Register two collections: path B is a subdirectory of path A
    upsertStoreCollection(db, "parent", { path: "/data/docs", pattern: "**/*.md" });
    upsertStoreCollection(db, "child", { path: "/data/docs/sub", pattern: "**/*.md" });

    const alerts = detectAlerts(store, vault);

    const overlapAlerts = alerts.filter(a => a.code === "overlap");
    expect(overlapAlerts.length).toBeGreaterThanOrEqual(1);
    expect(overlapAlerts[0].severity).toBe("warn");
    const names = [overlapAlerts[0].message];
    expect(names.some(m => m.includes("parent") && m.includes("child"))).toBe(true);
  });

  it("does not flag overlap for disjoint paths", () => {
    const { store, cleanup: c } = makeTempStore();
    cleanup = c;
    const vault = makeTempVault();
    const db = store.db;

    upsertStoreCollection(db, "colA", { path: "/data/alpha", pattern: "**/*.md" });
    upsertStoreCollection(db, "colB", { path: "/data/beta", pattern: "**/*.md" });

    const alerts = detectAlerts(store, vault);

    expect(alerts.filter(a => a.code === "overlap")).toHaveLength(0);
  });

  it("flags no-context for collections without context entries", () => {
    const { store, cleanup: c } = makeTempStore();
    cleanup = c;
    const vault = makeTempVault();
    const db = store.db;

    // Collection with no context
    upsertStoreCollection(db, "noCtxCol", { path: "/data/stuff", pattern: "**/*.md" });
    // Insert a doc so it doesn't also fire "empty"
    insertContent(db, "hash-nocontext", "content", new Date().toISOString());
    insertDocument(db, "noCtxCol", "/data/stuff/a.md", "A", "hash-nocontext", new Date().toISOString(), new Date().toISOString());

    const alerts = detectAlerts(store, vault);

    const noCtxAlerts = alerts.filter(a => a.code === "no-context");
    expect(noCtxAlerts.length).toBeGreaterThanOrEqual(1);
    const forOurCol = noCtxAlerts.find(a => a.message.includes("noCtxCol"));
    expect(forOurCol).toBeDefined();
    expect(forOurCol!.severity).toBe("info");
  });

  it("flags empty for collections with zero documents", () => {
    const { store, cleanup: c } = makeTempStore();
    cleanup = c;
    const vault = makeTempVault();
    const db = store.db;

    upsertStoreCollection(db, "emptyCol", { path: "/data/empty", pattern: "**/*.md", context: { "/": "ctx" } });

    const alerts = detectAlerts(store, vault);

    const emptyAlerts = alerts.filter(a => a.code === "empty");
    expect(emptyAlerts.length).toBeGreaterThanOrEqual(1);
    const forOurCol = emptyAlerts.find(a => a.message.includes("emptyCol"));
    expect(forOurCol).toBeDefined();
    expect(forOurCol!.severity).toBe("warn");
  });

  it("flags no-embedding for active docs without content_vectors rows", () => {
    const { store, cleanup: c } = makeTempStore();
    cleanup = c;
    const vault = makeTempVault();
    const db = store.db;

    // Register a collection with context so no-context/empty don't interfere
    upsertStoreCollection(db, "embedCol", { path: "/data/embed", pattern: "**/*.md", context: { "/": "ctx" } });

    // Insert a document into content + documents tables but no embedding in content_vectors
    const hash = "hash-no-embed-abc";
    insertContent(db, hash, "some content here", new Date().toISOString());
    insertDocument(db, "embedCol", "/data/embed/doc1.md", "Doc1", hash, new Date().toISOString(), new Date().toISOString());

    const alerts = detectAlerts(store, vault);

    const noEmbedAlerts = alerts.filter(a => a.code === "no-embedding");
    expect(noEmbedAlerts.length).toBe(1);
    expect(noEmbedAlerts[0].severity).toBe("warn");
    expect(noEmbedAlerts[0].message).toMatch(/1 document/);
  });

  it("flags stale (aggregated) for hit_count=0 wiki pages older than 30d", () => {
    const { store, cleanup: c } = makeTempStore();
    cleanup = c;
    const vault = makeTempVault();

    // Write wiki pages directly (no JSON.stringify on date strings, matching wiki.ts buildFrontmatter format)
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const todayDate = new Date().toISOString().slice(0, 10);

    function writeWikiDirect(vaultDir: string, project: string, slug: string, created: string): void {
      const path = join(vaultDir, "wiki", project, `${slug}.md`);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, [
        "---",
        `title: ${slug}`,
        `project: ${project}`,
        `tags: []`,
        `hit_count: 0`,
        `created: ${created}`,
        "---",
        "",
        "body",
      ].join("\n"));
    }

    // Stale: hit_count=0 and created 60 days ago
    writeWikiDirect(vault, "p1", "old-unread", sixtyDaysAgo);

    // Recent: hit_count=0 but created today — should NOT trigger stale
    writeWikiDirect(vault, "p1", "new-page", todayDate);

    const alerts = detectAlerts(store, vault);

    const staleAlerts = alerts.filter(a => a.code === "stale");
    expect(staleAlerts.length).toBe(1);
    expect(staleAlerts[0].severity).toBe("info");
    expect(staleAlerts[0].message).toMatch(/1 wiki page/);
    expect(staleAlerts[0].items).toBeDefined();
    expect(staleAlerts[0].items!.length).toBe(1);
  });

  it("returns empty array on a healthy fixture", () => {
    const { store, cleanup: c } = makeTempStore();
    cleanup = c;
    const vault = makeTempVault();
    // No collections, no documents, no wiki pages — completely empty store

    const alerts = detectAlerts(store, vault);

    expect(alerts).toEqual([]);
  });
});
