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

describe("migration v4 - cluster kind", () => {
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
    // Run all migrations including v4
    runMigrations(db, ":memory:", DEFAULT_MIGRATIONS);
  });

  afterEach(() => db.close());

  it("adds kind column to clusters table", () => {
    const info = db.prepare("PRAGMA table_info(clusters)").all() as { name: string }[];
    expect(info.map(c => c.name)).toContain("kind");
  });

  it("updates unique constraint to include kind", () => {
    // Should allow same name with different kinds
    db.prepare("INSERT INTO clusters (collection, name, kind) VALUES ('test', 'foo', 'code')").run();
    db.prepare("INSERT INTO clusters (collection, name, kind) VALUES ('test', 'foo', 'doc')").run();
    const count = (db.prepare("SELECT COUNT(*) as c FROM clusters WHERE name = 'foo'").get() as any).c;
    expect(count).toBe(2);
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

describe("symbol-name resolution fallback", () => {
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
  });

  afterEach(() => db.close());

  it("resolves extends relation by symbol name when path fails", () => {
    // File A defines class "BaseController"
    db.prepare("INSERT INTO content VALUES ('hash_a', 'class BaseController {}', datetime('now'))").run();
    db.prepare("INSERT INTO documents (collection, path, hash, title, active) VALUES ('test', 'Scripts/BaseController.cs', 'hash_a', 'BaseController', 1)").run();
    saveSymbols(db, "hash_a", [{ name: "BaseController", kind: "class", line: 1 }]);

    // File B extends BaseController — targetRef is the symbol name, not a path
    db.prepare("INSERT INTO content VALUES ('hash_b', 'class Player : BaseController {}', datetime('now'))").run();
    db.prepare("INSERT INTO documents (collection, path, hash, title, active) VALUES ('test', 'Scripts/Player.cs', 'hash_b', 'Player', 1)").run();
    saveRelations(db, "hash_b", [{ type: "extends", targetRef: "BaseController", sourceSymbol: "Player" }]);

    const resolved = resolveTargetHashes(db, "test");
    expect(resolved).toBeGreaterThanOrEqual(1);

    const rel = db.prepare("SELECT target_hash FROM relations WHERE source_hash = 'hash_b' AND type = 'extends'").get() as any;
    expect(rel.target_hash).toBe("hash_a");
  });
});

describe("wiki-link title resolution", () => {
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
  });

  afterEach(() => db.close());

  it("resolves wiki link by filename stem", () => {
    db.prepare("INSERT INTO content VALUES ('hash_md1', '# Settings', datetime('now'))").run();
    db.prepare("INSERT INTO documents (collection, path, hash, title, active) VALUES ('test', 'specs/settings.md', 'hash_md1', 'Settings', 1)").run();

    db.prepare("INSERT INTO content VALUES ('hash_md2', '[[settings]]', datetime('now'))").run();
    db.prepare("INSERT INTO documents (collection, path, hash, title, active) VALUES ('test', 'docs/overview.md', 'hash_md2', 'Overview', 1)").run();
    saveRelations(db, "hash_md2", [{ type: "wiki_link", targetRef: "settings" }]);

    const resolved = resolveTargetHashes(db, "test");
    expect(resolved).toBe(1);

    const rel = db.prepare("SELECT target_hash FROM relations WHERE source_hash = 'hash_md2' AND type = 'wiki_link'").get() as any;
    expect(rel.target_hash).toBe("hash_md1");
  });

  it("resolves wiki link with folder path suffix", () => {
    db.prepare("INSERT INTO content VALUES ('hash_md3', '# Achievement', datetime('now'))").run();
    db.prepare("INSERT INTO documents (collection, path, hash, title, active) VALUES ('test', 'specs/achievement.md', 'hash_md3', 'Achievement', 1)").run();

    db.prepare("INSERT INTO content VALUES ('hash_md4', '[[specs/achievement]]', datetime('now'))").run();
    db.prepare("INSERT INTO documents (collection, path, hash, title, active) VALUES ('test', 'docs/index.md', 'hash_md4', 'Index', 1)").run();
    saveRelations(db, "hash_md4", [{ type: "wiki_link", targetRef: "specs/achievement" }]);

    const resolved = resolveTargetHashes(db, "test");
    expect(resolved).toBe(1);
  });
});
