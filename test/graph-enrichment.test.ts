import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations, DEFAULT_MIGRATIONS } from "../src/migration/runner";
import { saveRelations, resolveTargetHashes, detectClusters, nameClusters, saveClusters, enrichSearchResults } from "../src/graph";

describe("search result graph enrichment", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    // Create base tables (migrations will add graph tables)
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
        FOREIGN KEY (hash) REFERENCES content(hash) ON DELETE CASCADE,
        UNIQUE(collection, path)
      );
      CREATE TABLE IF NOT EXISTS store_collections (
        name TEXT PRIMARY KEY, path TEXT NOT NULL, pattern TEXT NOT NULL DEFAULT '**/*.md'
      );
    `);
    runMigrations(db, ":memory:", DEFAULT_MIGRATIONS);

    // Seed data
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

    // Relations: b and c both import a
    saveRelations(db, "hash_b", [{ type: "imports", targetRef: "./a", targetSymbol: "foo" }]);
    saveRelations(db, "hash_c", [{ type: "imports", targetRef: "./a", targetSymbol: "foo" }]);
    resolveTargetHashes(db, "test");

    // Build clusters
    const clusters = detectClusters(db, "test");
    if (clusters.length > 0) {
      saveClusters(db, "test", nameClusters(db, clusters));
    }
  });

  afterEach(() => db.close());

  it("appends cluster and importedByCount to results", () => {
    const results = [{ hash: "hash_a", score: 0.9 }];
    const enriched = enrichSearchResults(db, results as any);
    expect(enriched[0].cluster).toBeDefined();
    expect(enriched[0].importedByCount).toBe(2);
  });

  it("handles results with no graph data gracefully", () => {
    db.exec(`INSERT INTO content VALUES ('hash_z', 'z', datetime('now'))`);
    db.exec(`INSERT INTO documents (id, collection, path, title, hash, created_at, modified_at, active, source_type, project, tags)
      VALUES (4, 'other', 'src/z.ts', 'z', 'hash_z', datetime('now'), datetime('now'), 1, 'docs', NULL, NULL)`);
    const results = [{ hash: "hash_z", score: 0.5 }];
    const enriched = enrichSearchResults(db, results as any);
    expect(enriched[0].cluster).toBeUndefined();
    expect(enriched[0].importedByCount).toBe(0);
  });

  it("preserves original result fields", () => {
    const results = [{ hash: "hash_a", score: 0.9, title: "a.ts", displayPath: "test/src/a.ts" }];
    const enriched = enrichSearchResults(db, results as any);
    expect(enriched[0].score).toBe(0.9);
    expect(enriched[0].title).toBe("a.ts");
  });
});
