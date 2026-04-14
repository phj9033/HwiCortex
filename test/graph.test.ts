import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations, DEFAULT_MIGRATIONS } from "../src/migration/runner";

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
