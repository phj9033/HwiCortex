/**
 * search-filter.test.ts - Tests for source_type filter in searchFTS
 *
 * Verifies that searchFTS can filter results by source_type (docs, sessions, knowledge).
 */

import { describe, test, expect, beforeEach } from "vitest";
import { openDatabase } from "../src/db.js";
import type { Database } from "../src/db.js";
import { runMigrations, DEFAULT_MIGRATIONS } from "../src/migration/runner.js";
import { insertDocument, searchFTS } from "../src/store.js";

/**
 * Set up base schema + FTS for in-memory testing.
 * Mirrors initializeDatabase minus sqlite-vec.
 */
function createSchemaWithFTS(db: Database) {
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS content (
      hash TEXT PRIMARY KEY,
      doc TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  db.exec(`
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
    )
  `);

  // FTS virtual table
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
      filepath, title, body,
      tokenize='porter unicode61'
    )
  `);

  // store_collections (needed by getContextForFile called from searchFTS)
  db.exec(`
    CREATE TABLE IF NOT EXISTS store_collections (
      name TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      pattern TEXT NOT NULL DEFAULT '**/*.md',
      ignore_patterns TEXT,
      include_by_default INTEGER DEFAULT 1,
      update_command TEXT,
      context TEXT
    )
  `);

  // store_config
  db.exec(`
    CREATE TABLE IF NOT EXISTS store_config (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  // Triggers to keep FTS in sync
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents
    WHEN new.active = 1
    BEGIN
      INSERT INTO documents_fts(rowid, filepath, title, body)
      SELECT
        new.id,
        new.collection || '/' || new.path,
        new.title,
        (SELECT doc FROM content WHERE hash = new.hash)
      WHERE new.active = 1;
    END
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE ON documents
    BEGIN
      DELETE FROM documents_fts WHERE rowid = old.id AND new.active = 0;
      INSERT OR REPLACE INTO documents_fts(rowid, filepath, title, body)
      SELECT
        new.id,
        new.collection || '/' || new.path,
        new.title,
        (SELECT doc FROM content WHERE hash = new.hash)
      WHERE new.active = 1;
    END
  `);
}

function insertContent(db: Database, hash: string, doc: string) {
  db.prepare("INSERT OR IGNORE INTO content (hash, doc, created_at) VALUES (?, ?, ?)")
    .run(hash, doc, "2026-01-01T00:00:00Z");
}

describe("searchFTS source_type filter", () => {
  let db: Database;
  const now = "2026-01-01T00:00:00Z";

  beforeEach(() => {
    db = openDatabase(":memory:");
    createSchemaWithFTS(db);
    runMigrations(db, ":memory:", DEFAULT_MIGRATIONS);

    // Insert documents with different source_types, all containing "quantum" for search
    insertContent(db, "hash-docs", "Quantum computing fundamentals for documentation");
    insertDocument(db, "mycol", "docs-article.md", "Quantum Docs", "hash-docs", now, now, {
      source_type: "docs",
    });

    insertContent(db, "hash-session", "Quantum entanglement discussion in session");
    insertDocument(db, "mycol", "session-log.md", "Quantum Session", "hash-session", now, now, {
      source_type: "sessions",
    });

    insertContent(db, "hash-knowledge", "Quantum mechanics knowledge base entry");
    insertDocument(db, "mycol", "knowledge-note.md", "Quantum Knowledge", "hash-knowledge", now, now, {
      source_type: "knowledge",
    });
  });

  test("returns all results when no sourceType filter is provided", () => {
    const results = searchFTS(db, "quantum");
    expect(results.length).toBe(3);
  });

  test("filters by sourceType='knowledge'", () => {
    const results = searchFTS(db, "quantum", 20, undefined, "knowledge");
    expect(results.length).toBe(1);
    expect(results[0]!.title).toBe("Quantum Knowledge");
  });

  test("filters by sourceType='docs'", () => {
    const results = searchFTS(db, "quantum", 20, undefined, "docs");
    expect(results.length).toBe(1);
    expect(results[0]!.title).toBe("Quantum Docs");
  });

  test("filters by sourceType='sessions'", () => {
    const results = searchFTS(db, "quantum", 20, undefined, "sessions");
    expect(results.length).toBe(1);
    expect(results[0]!.title).toBe("Quantum Session");
  });

  test("returns empty when sourceType matches no documents", () => {
    const results = searchFTS(db, "quantum", 20, undefined, "nonexistent");
    expect(results.length).toBe(0);
  });

  test("combines collection and sourceType filters", () => {
    // Add a doc in a different collection with same source_type
    insertContent(db, "hash-other", "Quantum stuff in other collection");
    insertDocument(db, "othercol", "other.md", "Quantum Other", "hash-other", now, now, {
      source_type: "knowledge",
    });

    // Filter by both collection and sourceType
    const results = searchFTS(db, "quantum", 20, "mycol", "knowledge");
    expect(results.length).toBe(1);
    expect(results[0]!.title).toBe("Quantum Knowledge");
  });
});
