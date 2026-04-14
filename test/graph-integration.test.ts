import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import Database from "better-sqlite3";
import { runMigrations, DEFAULT_MIGRATIONS } from "../src/migration/runner";
import { reindexCollection } from "../src/store";

describe("reindex with graph extraction", () => {
  let db: Database.Database;
  let tempDir: string;
  let store: any;

  beforeEach(() => {
    db = new Database(":memory:");
    // Create all base tables
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
        active INTEGER DEFAULT 1,
        source_type TEXT,
        project TEXT,
        tags TEXT,
        UNIQUE(collection, path)
      );
      CREATE TABLE IF NOT EXISTS store_collections (
        name TEXT PRIMARY KEY, path TEXT NOT NULL, pattern TEXT NOT NULL DEFAULT '**/*.md'
      );
      CREATE TABLE IF NOT EXISTS store_config (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS llm_cache (hash TEXT PRIMARY KEY, result TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS content_vectors (hash TEXT NOT NULL, seq INTEGER NOT NULL DEFAULT 0, pos INTEGER NOT NULL DEFAULT 0, vector BLOB);
    `);
    // Create FTS table
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(filepath, title, body, tokenize='porter unicode61')`);
    runMigrations(db, ":memory:", DEFAULT_MIGRATIONS);

    tempDir = mkdtempSync(join(tmpdir(), "hwicortex-test-"));
    store = { db };
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("populates symbols table after reindex of .ts files", async () => {
    writeFileSync(join(tempDir, "a.ts"), `export function hello() { return "world"; }`);

    await reindexCollection(store, tempDir, "**/*.ts", "test-col");

    const symbols = db.prepare("SELECT * FROM symbols").all();
    expect(symbols.length).toBeGreaterThan(0);
    expect(symbols[0].name).toBe("hello");
  });

  it("populates relations table for import statements", async () => {
    mkdirSync(join(tempDir, "src"), { recursive: true });
    writeFileSync(join(tempDir, "src", "b.ts"), `export function greet() { return "hi"; }`);
    writeFileSync(join(tempDir, "src", "a.ts"), `import { greet } from './b';\nconsole.log(greet());`);

    await reindexCollection(store, tempDir, "**/*.ts", "test-col");

    const relations = db.prepare("SELECT * FROM relations WHERE type = 'imports'").all();
    expect(relations.length).toBeGreaterThan(0);
  });

  it("skips graph extraction for markdown files", async () => {
    writeFileSync(join(tempDir, "readme.md"), "# Hello World");

    await reindexCollection(store, tempDir, "**/*.md", "test-col");

    const symbols = db.prepare("SELECT * FROM symbols").all();
    expect(symbols).toHaveLength(0);
  });

  it("resolves target_hash after all files indexed", async () => {
    mkdirSync(join(tempDir, "src"), { recursive: true });
    writeFileSync(join(tempDir, "src", "b.ts"), `export function greet() { return "hi"; }`);
    writeFileSync(join(tempDir, "src", "a.ts"), `import { greet } from './b';`);

    await reindexCollection(store, tempDir, "**/*.ts", "test-col");

    const resolved = db.prepare("SELECT * FROM relations WHERE target_hash IS NOT NULL").all();
    expect(resolved.length).toBeGreaterThan(0);
  });

  it("skips symbol extraction for unchanged files", async () => {
    writeFileSync(join(tempDir, "a.ts"), `export function hello() {}`);

    // First reindex
    await reindexCollection(store, tempDir, "**/*.ts", "test-col");
    const firstCount = (db.prepare("SELECT COUNT(*) as c FROM symbols").get() as any).c;

    // Second reindex — same file, should skip extraction
    await reindexCollection(store, tempDir, "**/*.ts", "test-col");
    const secondCount = (db.prepare("SELECT COUNT(*) as c FROM symbols").get() as any).c;

    expect(secondCount).toBe(firstCount);
  });
});
