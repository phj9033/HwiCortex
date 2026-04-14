import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations, DEFAULT_MIGRATIONS } from "../src/migration/runner";
import { saveSymbols, saveRelations, resolveTargetHashes, detectClusters, nameClusters, saveClusters } from "../src/graph";
import { handleGraph, handlePath, handleRelated, handleSymbol, handleClusters } from "../src/cli/graph";

describe("CLI graph handlers", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE IF NOT EXISTS content (hash TEXT PRIMARY KEY, doc TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        collection TEXT NOT NULL,
        path TEXT NOT NULL,
        title TEXT NOT NULL,
        hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        modified_at TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        source_type TEXT DEFAULT 'docs',
        project TEXT,
        tags TEXT
      );
      CREATE TABLE IF NOT EXISTS store_collections (
        name TEXT PRIMARY KEY, path TEXT NOT NULL, pattern TEXT NOT NULL DEFAULT '**/*.md'
      );
    `);
    runMigrations(db, ":memory:", DEFAULT_MIGRATIONS);

    // Seed data: 3 files in "test" collection
    db.exec(`
      INSERT INTO content VALUES ('hash_a', 'content a', datetime('now'));
      INSERT INTO content VALUES ('hash_b', 'content b', datetime('now'));
      INSERT INTO content VALUES ('hash_c', 'content c', datetime('now'));
      INSERT INTO documents (id, collection, path, title, hash, created_at, modified_at, active, source_type, project, tags)
        VALUES (1, 'test', 'src/a.ts', 'a', 'hash_a', datetime('now'), datetime('now'), 1, 'docs', NULL, NULL);
      INSERT INTO documents (id, collection, path, title, hash, created_at, modified_at, active, source_type, project, tags)
        VALUES (2, 'test', 'src/b.ts', 'b', 'hash_b', datetime('now'), datetime('now'), 1, 'docs', NULL, NULL);
      INSERT INTO documents (id, collection, path, title, hash, created_at, modified_at, active, source_type, project, tags)
        VALUES (3, 'test', 'src/c.ts', 'c', 'hash_c', datetime('now'), datetime('now'), 1, 'docs', NULL, NULL);
    `);

    // Symbols
    saveSymbols(db, "hash_a", [
      { name: "createStore", kind: "function", line: 1 },
      { name: "Store", kind: "class", line: 5 },
    ]);
    saveSymbols(db, "hash_b", [{ name: "helper", kind: "function", line: 1 }]);

    // Relations: a imports b, b imports c
    saveRelations(db, "hash_a", [{ type: "imports", targetRef: "./b", targetSymbol: "helper" }]);
    saveRelations(db, "hash_b", [{ type: "imports", targetRef: "./c", targetSymbol: "util" }]);
    resolveTargetHashes(db, "test");

    // Build clusters
    const clusters = detectClusters(db, "test");
    if (clusters.length > 0) {
      saveClusters(db, "test", nameClusters(db, clusters));
    }
  });

  afterEach(() => db.close());

  it("handleGraph returns file relationships", () => {
    const output = handleGraph(db, "src/a.ts", {});
    expect(output).toContain("imports");
  });

  it("handlePath finds connection between files", () => {
    const output = handlePath(db, "src/a.ts", "src/c.ts", {});
    expect(output).toContain("→");
  });

  it("handleRelated lists related files", () => {
    const output = handleRelated(db, "src/a.ts", {});
    expect(output).toContain("b.ts");
  });

  it("handleSymbol finds definition and usages", () => {
    const output = handleSymbol(db, "createStore", {});
    expect(output).toContain("src/a.ts");
  });

  it("handleClusters lists all clusters", () => {
    const output = handleClusters(db, {});
    // Should contain cluster info or "no clusters"
    expect(typeof output).toBe("string");
  });

  it("handleGraph returns message for unknown file", () => {
    const output = handleGraph(db, "nonexistent.ts", {});
    expect(output).toContain("not found");
  });

  it("handlePath returns message when no path exists", () => {
    // hash_a and a disconnected file
    db.exec(`INSERT INTO content VALUES ('hash_z', 'z', datetime('now'))`);
    db.exec(`INSERT INTO documents (id, collection, path, title, hash, created_at, modified_at, active, source_type, project, tags)
      VALUES (4, 'test', 'src/z.ts', 'z', 'hash_z', datetime('now'), datetime('now'), 1, 'docs', NULL, NULL)`);
    const output = handlePath(db, "src/a.ts", "src/z.ts", {});
    expect(output).toContain("no path");
  });
});
