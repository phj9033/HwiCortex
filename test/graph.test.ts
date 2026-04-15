import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations, DEFAULT_MIGRATIONS } from "../src/migration/runner";
import { saveSymbols, saveRelations, getRelationsForHash, getSymbolUsages, resolveTargetHashes, getFileGraph, findPath, detectClusters, nameClusters, saveClusters } from "../src/graph";

describe("graph", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE IF NOT EXISTS content (hash TEXT PRIMARY KEY, doc TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT, collection TEXT NOT NULL, path TEXT NOT NULL,
        title TEXT, hash TEXT NOT NULL, active INTEGER DEFAULT 1, modified_at TEXT, indexed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS store_collections (
        name TEXT PRIMARY KEY, path TEXT NOT NULL, pattern TEXT NOT NULL DEFAULT '**/*.md'
      );
    `);
    runMigrations(db, ":memory:", DEFAULT_MIGRATIONS);

    // Seed base data
    db.exec(`
      INSERT INTO content VALUES ('hash_a', 'content a', datetime('now'));
      INSERT INTO content VALUES ('hash_b', 'content b', datetime('now'));
      INSERT INTO documents (id, collection, path, title, hash, active, modified_at, indexed_at, source_type, project, tags)
        VALUES (1, 'test', 'src/a.ts', 'a', 'hash_a', 1, NULL, NULL, 'docs', NULL, NULL);
      INSERT INTO documents (id, collection, path, title, hash, active, modified_at, indexed_at, source_type, project, tags)
        VALUES (2, 'test', 'src/b.ts', 'b', 'hash_b', 1, NULL, NULL, 'docs', NULL, NULL);
    `);
  });

  afterEach(() => db.close());

  // --- Migrations ---

  it("v3 creates graph tables", () => {
    for (const table of ["symbols", "relations", "clusters", "cluster_members"]) {
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)).toBeTruthy();
    }
  });

  it("v4 adds kind column with updated unique constraint", () => {
    const cols = (db.prepare("PRAGMA table_info(clusters)").all() as { name: string }[]).map(c => c.name);
    expect(cols).toContain("kind");

    // Same name + different kind should be allowed
    db.prepare("INSERT INTO clusters (collection, name, kind) VALUES ('test', 'foo', 'code')").run();
    db.prepare("INSERT INTO clusters (collection, name, kind) VALUES ('test', 'foo', 'doc')").run();
    expect((db.prepare("SELECT COUNT(*) as c FROM clusters WHERE name = 'foo'").get() as any).c).toBe(2);
  });

  // --- Storage ---

  it("saves and retrieves symbols and relations", () => {
    saveSymbols(db, "hash_a", [{ name: "createStore", kind: "function", line: 1 }]);
    expect(db.prepare("SELECT * FROM symbols WHERE hash = ?").all("hash_a")).toHaveLength(1);

    saveRelations(db, "hash_a", [{ type: "imports", targetRef: "./b", targetSymbol: "foo" }]);
    const rels = getRelationsForHash(db, "hash_a");
    expect(rels).toHaveLength(1);
    expect(rels[0].target_ref).toBe("./b");
  });

  it("resolves target_hash from import paths", () => {
    saveRelations(db, "hash_a", [{ type: "imports", targetRef: "./b" }]);
    resolveTargetHashes(db, "test");
    expect(getRelationsForHash(db, "hash_a")[0].target_hash).toBe("hash_b");
  });

  it("finds symbol usages across files", () => {
    saveSymbols(db, "hash_a", [{ name: "foo", kind: "function", line: 1 }]);
    saveRelations(db, "hash_b", [{ type: "calls", targetSymbol: "foo", targetRef: "foo" }]);
    const usages = getSymbolUsages(db, "foo");
    expect(usages.defined).toContainEqual(expect.objectContaining({ hash: "hash_a" }));
    expect(usages.usedBy).toContainEqual(expect.objectContaining({ source_hash: "hash_b" }));
  });

  it("getFileGraph aggregates relations", () => {
    saveRelations(db, "hash_a", [{ type: "imports", targetRef: "./b", targetSymbol: "foo" }]);
    saveRelations(db, "hash_b", [{ type: "imports", targetRef: "./a", targetSymbol: "bar" }]);
    resolveTargetHashes(db, "test");
    const graph = getFileGraph(db, "hash_a");
    expect(graph.imports).toHaveLength(1);
    expect(graph.importedBy).toHaveLength(1);
  });

  // --- Path Finding ---

  it("findPath returns shortest path or null", () => {
    db.exec(`INSERT INTO content VALUES ('hash_c', 'content c', datetime('now'))`);
    db.exec(`INSERT INTO documents (id, collection, path, title, hash, active, modified_at, indexed_at, source_type, project, tags)
      VALUES (3, 'test', 'src/c.ts', 'c', 'hash_c', 1, NULL, NULL, 'docs', NULL, NULL)`);
    saveRelations(db, "hash_a", [{ type: "imports", targetRef: "./b", targetSymbol: "b" }]);
    saveRelations(db, "hash_b", [{ type: "imports", targetRef: "./c", targetSymbol: "c" }]);
    resolveTargetHashes(db, "test");

    expect(findPath(db, "hash_a", "hash_c")).toEqual(["hash_a", "hash_b", "hash_c"]);
    expect(findPath(db, "hash_a", "hash_nonexistent")).toBeNull();
  });

  // --- Resolution Fallbacks ---

  it("resolves C# extends by symbol-name fallback", () => {
    db.prepare("INSERT INTO content VALUES ('hash_base', 'class Base {}', datetime('now'))").run();
    db.prepare("INSERT INTO documents (collection, path, hash, title, active) VALUES ('test', 'Scripts/Base.cs', 'hash_base', 'Base', 1)").run();
    saveSymbols(db, "hash_base", [{ name: "BaseController", kind: "class", line: 1 }]);

    db.prepare("INSERT INTO content VALUES ('hash_player', 'class Player : Base {}', datetime('now'))").run();
    db.prepare("INSERT INTO documents (collection, path, hash, title, active) VALUES ('test', 'Scripts/Player.cs', 'hash_player', 'Player', 1)").run();
    saveRelations(db, "hash_player", [{ type: "extends", targetRef: "BaseController", sourceSymbol: "Player" }]);

    resolveTargetHashes(db, "test");
    const rel = db.prepare("SELECT target_hash FROM relations WHERE source_hash = 'hash_player' AND type = 'extends'").get() as any;
    expect(rel.target_hash).toBe("hash_base");
  });

  it("resolves wiki-link by stem and path suffix", () => {
    db.prepare("INSERT INTO content VALUES ('h_settings', '# Settings', datetime('now'))").run();
    db.prepare("INSERT INTO documents (collection, path, hash, title, active) VALUES ('test', 'specs/settings.md', 'h_settings', 'Settings', 1)").run();

    db.prepare("INSERT INTO content VALUES ('h_overview', '[[settings]]', datetime('now'))").run();
    db.prepare("INSERT INTO documents (collection, path, hash, title, active) VALUES ('test', 'docs/overview.md', 'h_overview', 'Overview', 1)").run();
    saveRelations(db, "h_overview", [{ type: "wiki_link", targetRef: "settings" }]);

    expect(resolveTargetHashes(db, "test")).toBeGreaterThanOrEqual(1);
    expect((db.prepare("SELECT target_hash FROM relations WHERE source_hash = 'h_overview'").get() as any).target_hash).toBe("h_settings");

    // Path suffix: [[specs/achievement]]
    db.prepare("INSERT INTO content VALUES ('h_ach', '# Ach', datetime('now'))").run();
    db.prepare("INSERT INTO documents (collection, path, hash, title, active) VALUES ('test', 'specs/achievement.md', 'h_ach', 'Ach', 1)").run();
    db.prepare("INSERT INTO content VALUES ('h_idx', '[[specs/achievement]]', datetime('now'))").run();
    db.prepare("INSERT INTO documents (collection, path, hash, title, active) VALUES ('test', 'docs/index.md', 'h_idx', 'Index', 1)").run();
    saveRelations(db, "h_idx", [{ type: "wiki_link", targetRef: "specs/achievement" }]);

    expect(resolveTargetHashes(db, "test")).toBeGreaterThanOrEqual(1);
  });

  // --- Clustering ---

  it("detects clusters and names by most-imported symbol", () => {
    db.exec(`
      INSERT INTO content VALUES ('hash_c', 'c', datetime('now'));
      INSERT INTO documents (id, collection, path, title, hash, active, modified_at, indexed_at, source_type, project, tags)
        VALUES (3, 'test', 'src/c.ts', 'c', 'hash_c', 1, NULL, NULL, 'docs', NULL, NULL);
    `);
    saveSymbols(db, "hash_a", [{ name: "createStore", kind: "function", line: 1 }]);
    saveRelations(db, "hash_b", [{ type: "imports", targetRef: "./a", targetSymbol: "createStore" }]);
    saveRelations(db, "hash_c", [{ type: "imports", targetRef: "./a", targetSymbol: "createStore" }]);
    resolveTargetHashes(db, "test");

    const clusters = detectClusters(db, "test");
    expect(clusters.length).toBeGreaterThanOrEqual(1);

    const named = nameClusters(db, clusters);
    expect(named[0].name).toContain("createStore");

    saveClusters(db, "test", named);
    expect(db.prepare("SELECT * FROM clusters WHERE collection = ?").all("test").length).toBeGreaterThan(0);
  });

  it("kind-separated clustering isolates code and doc relations", () => {
    // Code pair
    db.prepare("INSERT INTO content VALUES ('c1', 'code1', datetime('now'))").run();
    db.prepare("INSERT INTO content VALUES ('c2', 'code2', datetime('now'))").run();
    db.prepare("INSERT INTO documents (collection, path, hash, title, active) VALUES ('mixed', 'a.ts', 'c1', 'a', 1)").run();
    db.prepare("INSERT INTO documents (collection, path, hash, title, active) VALUES ('mixed', 'b.ts', 'c2', 'b', 1)").run();
    saveRelations(db, "c1", [{ type: "imports", targetRef: "./b" }]);
    db.prepare("UPDATE relations SET target_hash = 'c2' WHERE source_hash = 'c1'").run();

    // Doc pair
    db.prepare("INSERT INTO content VALUES ('d1', 'doc1', datetime('now'))").run();
    db.prepare("INSERT INTO content VALUES ('d2', 'doc2', datetime('now'))").run();
    db.prepare("INSERT INTO documents (collection, path, hash, title, active) VALUES ('mixed', 'x.md', 'd1', 'x', 1)").run();
    db.prepare("INSERT INTO documents (collection, path, hash, title, active) VALUES ('mixed', 'y.md', 'd2', 'y', 1)").run();
    saveRelations(db, "d1", [{ type: "wiki_link", targetRef: "y" }]);
    db.prepare("UPDATE relations SET target_hash = 'd2' WHERE source_hash = 'd1'").run();

    const codeClusters = detectClusters(db, "mixed", { relationTypes: ["imports", "calls", "extends", "implements", "uses_type"] });
    expect(codeClusters.flatMap(c => c.members)).toContain("c1");
    expect(codeClusters.flatMap(c => c.members)).not.toContain("d1");

    const docClusters = detectClusters(db, "mixed", { relationTypes: ["wiki_link"] });
    expect(docClusters.flatMap(c => c.members)).toContain("d1");
    expect(docClusters.flatMap(c => c.members)).not.toContain("c1");

    // saveClusters with different kinds don't overwrite each other
    saveClusters(db, "mixed", nameClusters(db, codeClusters), "code");
    saveClusters(db, "mixed", nameClusters(db, docClusters), "doc");
    const kinds = (db.prepare("SELECT kind FROM clusters WHERE collection = 'mixed'").all() as any[]).map(c => c.kind);
    expect(kinds).toContain("code");
    expect(kinds).toContain("doc");
  });
});
