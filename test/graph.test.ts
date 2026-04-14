import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations, DEFAULT_MIGRATIONS } from "../src/migration/runner";
import { saveSymbols, saveRelations, getRelationsForHash, getSymbolUsages, resolveTargetHashes, getFileGraph, findPath, detectClusters, nameClusters, saveClusters } from "../src/graph";

describe("graph migration v3", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    // Create base tables needed by migrations v1/v2
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
  });

  afterEach(() => db.close());

  it("creates symbols table", () => {
    runMigrations(db, ":memory:", DEFAULT_MIGRATIONS);
    const info = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='symbols'").get();
    expect(info).toBeTruthy();
  });

  it("creates relations table", () => {
    runMigrations(db, ":memory:", DEFAULT_MIGRATIONS);
    const info = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='relations'").get();
    expect(info).toBeTruthy();
  });

  it("creates clusters and cluster_members tables", () => {
    runMigrations(db, ":memory:", DEFAULT_MIGRATIONS);
    const clusters = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='clusters'").get();
    const members = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cluster_members'").get();
    expect(clusters).toBeTruthy();
    expect(members).toBeTruthy();
  });
});

describe("graph storage", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    // Create base tables needed by migrations
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
    // Run all migrations including v3
    runMigrations(db, ":memory:", DEFAULT_MIGRATIONS);
    // Seed content and documents (with all columns after migrations)
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

  it("saves and retrieves symbols", () => {
    saveSymbols(db, "hash_a", [
      { name: "createStore", kind: "function", line: 1 },
    ]);
    const symbols = db.prepare("SELECT * FROM symbols WHERE hash = ?").all("hash_a");
    expect(symbols).toHaveLength(1);
    expect(symbols[0].name).toBe("createStore");
  });

  it("saves and retrieves relations", () => {
    saveRelations(db, "hash_a", [
      { type: "imports", targetRef: "./b", targetSymbol: "foo" },
    ]);
    const rels = getRelationsForHash(db, "hash_a");
    expect(rels).toHaveLength(1);
    expect(rels[0].target_ref).toBe("./b");
  });

  it("resolves target_hash from import paths", () => {
    saveRelations(db, "hash_a", [
      { type: "imports", targetRef: "./b" },
    ]);
    resolveTargetHashes(db, "test");
    const rels = getRelationsForHash(db, "hash_a");
    expect(rels[0].target_hash).toBe("hash_b");
  });

  it("finds symbol usages across files", () => {
    saveSymbols(db, "hash_a", [{ name: "foo", kind: "function", line: 1 }]);
    saveRelations(db, "hash_b", [
      { type: "calls", targetSymbol: "foo", targetRef: "foo" },
    ]);
    const usages = getSymbolUsages(db, "foo");
    expect(usages.defined).toContainEqual(expect.objectContaining({ hash: "hash_a" }));
    expect(usages.usedBy).toContainEqual(expect.objectContaining({ source_hash: "hash_b" }));
  });

  it("getFileGraph aggregates all relation types for a file", () => {
    saveRelations(db, "hash_a", [
      { type: "imports", targetRef: "./b", targetSymbol: "foo" },
    ]);
    saveRelations(db, "hash_b", [
      { type: "imports", targetRef: "./a", targetSymbol: "bar" },
    ]);
    resolveTargetHashes(db, "test");
    const graph = getFileGraph(db, "hash_a");
    expect(graph.imports).toHaveLength(1);
    expect(graph.importedBy).toHaveLength(1);
  });

  it("findPath returns shortest path between two files", () => {
    db.exec(`INSERT INTO content VALUES ('hash_c', 'content c', datetime('now'))`);
    db.exec(`
      INSERT INTO documents (id, collection, path, title, hash, active, modified_at, indexed_at, source_type, project, tags)
        VALUES (3, 'test', 'src/c.ts', 'c', 'hash_c', 1, NULL, NULL, 'docs', NULL, NULL)
    `);
    saveRelations(db, "hash_a", [{ type: "imports", targetRef: "./b", targetSymbol: "b" }]);
    saveRelations(db, "hash_b", [{ type: "imports", targetRef: "./c", targetSymbol: "c" }]);
    resolveTargetHashes(db, "test");
    const path = findPath(db, "hash_a", "hash_c");
    expect(path).not.toBeNull();
    expect(path).toEqual(["hash_a", "hash_b", "hash_c"]);
  });

  it("findPath returns null when no path exists", () => {
    db.exec(`INSERT INTO content VALUES ('hash_z', 'content z', datetime('now'))`);
    db.exec(`
      INSERT INTO documents (id, collection, path, title, hash, active, modified_at, indexed_at, source_type, project, tags)
        VALUES (3, 'test', 'src/z.ts', 'z', 'hash_z', 1, NULL, NULL, 'docs', NULL, NULL)
    `);
    const path = findPath(db, "hash_a", "hash_z");
    expect(path).toBeNull();
  });

  describe("clustering", () => {
    // Extend seed data for clustering tests
    beforeEach(() => {
      db.exec(`
        INSERT INTO content VALUES ('hash_c', 'content c', datetime('now'));
        INSERT INTO content VALUES ('hash_x', 'content x', datetime('now'));
        INSERT INTO content VALUES ('hash_y', 'content y', datetime('now'));
        INSERT INTO documents (id, collection, path, title, hash, active, modified_at, indexed_at, source_type, project, tags)
          VALUES (3, 'test', 'src/c.ts', 'c', 'hash_c', 1, NULL, NULL, 'docs', NULL, NULL);
        INSERT INTO documents (id, collection, path, title, hash, active, modified_at, indexed_at, source_type, project, tags)
          VALUES (4, 'test', 'src/x.ts', 'x', 'hash_x', 1, NULL, NULL, 'docs', NULL, NULL);
        INSERT INTO documents (id, collection, path, title, hash, active, modified_at, indexed_at, source_type, project, tags)
          VALUES (5, 'test', 'src/y.ts', 'y', 'hash_y', 1, NULL, NULL, 'docs', NULL, NULL);
      `);
    });

    it("detects clusters from relations", () => {
      // Cluster 1: a → b → c
      // Cluster 2: x → y
      saveRelations(db, "hash_a", [{ type: "imports", targetRef: "./b", targetSymbol: "b" }]);
      saveRelations(db, "hash_b", [{ type: "imports", targetRef: "./c", targetSymbol: "c" }]);
      saveRelations(db, "hash_x", [{ type: "imports", targetRef: "./y", targetSymbol: "y" }]);
      resolveTargetHashes(db, "test");

      const clusters = detectClusters(db, "test");
      expect(clusters.length).toBeGreaterThanOrEqual(2);
    });

    it("saves clusters to database", () => {
      saveRelations(db, "hash_a", [{ type: "imports", targetRef: "./b", targetSymbol: "b" }]);
      resolveTargetHashes(db, "test");
      const clusters = detectClusters(db, "test");
      saveClusters(db, "test", nameClusters(db, clusters));

      const rows = db.prepare("SELECT * FROM clusters WHERE collection = ?").all("test");
      expect(rows.length).toBeGreaterThan(0);

      const members = db.prepare("SELECT * FROM cluster_members").all();
      expect(members.length).toBeGreaterThan(0);
    });

    it("names clusters by most-imported symbol", () => {
      saveSymbols(db, "hash_a", [{ name: "createStore", kind: "function", line: 1 }]);
      saveRelations(db, "hash_b", [{ type: "imports", targetRef: "./a", targetSymbol: "createStore" }]);
      saveRelations(db, "hash_c", [{ type: "imports", targetRef: "./a", targetSymbol: "createStore" }]);
      resolveTargetHashes(db, "test");

      const clusters = detectClusters(db, "test");
      const named = nameClusters(db, clusters);
      expect(named[0].name).toContain("createStore");
    });
  });
});
