import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations, DEFAULT_MIGRATIONS } from "../src/migration/runner";
import { saveSymbols, saveRelations, resolveTargetHashes, detectClusters, nameClusters, saveClusters } from "../src/graph";
import { generateClusterPage, generateRelationPage } from "../src/cli/graph-obsidian";

describe("Obsidian graph pages", () => {
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

    db.exec(`
      INSERT INTO content VALUES ('hash_a', 'content a', datetime('now'));
      INSERT INTO content VALUES ('hash_b', 'content b', datetime('now'));
      INSERT INTO content VALUES ('hash_c', 'content c', datetime('now'));
      INSERT INTO documents (id, collection, path, title, hash, active, modified_at, indexed_at, source_type, project, tags)
        VALUES (1, 'myproj', 'src/store.ts', 'store', 'hash_a', 1, NULL, NULL, 'docs', NULL, NULL);
      INSERT INTO documents (id, collection, path, title, hash, active, modified_at, indexed_at, source_type, project, tags)
        VALUES (2, 'myproj', 'src/db.ts', 'db', 'hash_b', 1, NULL, NULL, 'docs', NULL, NULL);
      INSERT INTO documents (id, collection, path, title, hash, active, modified_at, indexed_at, source_type, project, tags)
        VALUES (3, 'myproj', 'src/utils.ts', 'utils', 'hash_c', 1, NULL, NULL, 'docs', NULL, NULL);
    `);

    saveSymbols(db, "hash_a", [
      { name: "createStore", kind: "function", line: 1 },
      { name: "Store", kind: "class", line: 10 },
    ]);
    saveSymbols(db, "hash_b", [{ name: "openDb", kind: "function", line: 1 }]);

    saveRelations(db, "hash_a", [
      { type: "imports", targetRef: "./db", targetSymbol: "openDb" },
      { type: "imports", targetRef: "./utils", targetSymbol: "helper" },
    ]);
    saveRelations(db, "hash_c", [
      { type: "imports", targetRef: "./store", targetSymbol: "createStore" },
    ]);
    resolveTargetHashes(db, "myproj");

    const clusters = detectClusters(db, "myproj");
    if (clusters.length > 0) {
      saveClusters(db, "myproj", nameClusters(db, clusters));
    }
  });

  afterEach(() => db.close());

  it("generates cluster index page with frontmatter and wiki links", () => {
    const clusterRow = db.prepare("SELECT * FROM clusters WHERE collection = ? LIMIT 1").get("myproj") as any;
    const memberHashes = db.prepare("SELECT hash FROM cluster_members WHERE cluster_id = ?").all(clusterRow.id) as { hash: string }[];

    const page = generateClusterPage(db, clusterRow.name, memberHashes.map(m => m.hash));
    expect(page).toContain("tags: [cluster, auto-generated]");
    expect(page).toContain("[[");
    // Should have wiki links to member files
    expect(page).toMatch(/\[\[.*store.*\]\]/);
  });

  it("generates file relation page with imports/imported-by wiki links", () => {
    const page = generateRelationPage(db, "hash_a");
    expect(page).toContain("tags:");
    // Should show imports as wiki links
    expect(page).toContain("[[");
    expect(page).toContain("imports:");
    // Should show symbols
    expect(page).toContain("createStore");
  });

  it("generates relation page for file with no relations", () => {
    db.exec(`INSERT INTO content VALUES ('hash_z', 'z', datetime('now'))`);
    db.exec(`INSERT INTO documents (id, collection, path, title, hash, active, modified_at, indexed_at, source_type, project, tags)
      VALUES (4, 'myproj', 'src/lonely.ts', 'lonely', 'hash_z', 1, NULL, NULL, 'docs', NULL, NULL)`);
    const page = generateRelationPage(db, "hash_z");
    expect(page).toContain("lonely");
  });
});
