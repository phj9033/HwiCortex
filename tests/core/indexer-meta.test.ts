import { describe, it, expect, beforeEach } from "vitest";
import { openDatabase } from "../../src/db.js";
import type { Database } from "../../src/db.js";
import { runMigrations, DEFAULT_MIGRATIONS } from "../../src/migration/runner.js";
import { insertDocument } from "../../src/store.js";

/** Create the base schema (same as initializeDatabase minus sqlite-vec) */
function createBaseSchema(db: Database) {
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
}

function insertTestContent(db: Database, hash: string) {
  db.prepare("INSERT OR IGNORE INTO content (hash, doc, created_at) VALUES (?, ?, ?)")
    .run(hash, "test content", "2026-01-01T00:00:00Z");
}

describe("Indexer meta fields", () => {
  let db: Database;
  const now = "2026-01-01T00:00:00Z";

  beforeEach(() => {
    db = openDatabase(":memory:");
    createBaseSchema(db);
    runMigrations(db, ":memory:", DEFAULT_MIGRATIONS);
  });

  it("inserts document with source_type", () => {
    insertTestContent(db, "hash1");
    insertDocument(db, "docs", "test.md", "Test", "hash1", now, now, {
      source_type: "session",
    });

    const row = db.prepare("SELECT source_type FROM documents WHERE path = ?").get("test.md") as any;
    expect(row.source_type).toBe("session");
  });

  it("inserts document with project", () => {
    insertTestContent(db, "hash2");
    insertDocument(db, "docs", "test2.md", "Test2", "hash2", now, now, {
      project: "hwicortex",
    });

    const row = db.prepare("SELECT project FROM documents WHERE path = ?").get("test2.md") as any;
    expect(row.project).toBe("hwicortex");
  });

  it("inserts document with tags array", () => {
    insertTestContent(db, "hash3");
    insertDocument(db, "docs", "test3.md", "Test3", "hash3", now, now, {
      tags: ["architecture", "design"],
    });

    const row = db.prepare("SELECT tags FROM documents WHERE path = ?").get("test3.md") as any;
    expect(JSON.parse(row.tags)).toEqual(["architecture", "design"]);
  });

  it("defaults source_type to 'docs' when meta not provided", () => {
    insertTestContent(db, "hash4");
    insertDocument(db, "docs", "test4.md", "Test4", "hash4", now, now);

    const row = db.prepare("SELECT source_type FROM documents WHERE path = ?").get("test4.md") as any;
    expect(row.source_type).toBe("docs");
  });

  it("defaults source_type to 'docs' when meta provided without source_type", () => {
    insertTestContent(db, "hash5");
    insertDocument(db, "docs", "test5.md", "Test5", "hash5", now, now, {
      project: "myproject",
    });

    const row = db.prepare("SELECT source_type FROM documents WHERE path = ?").get("test5.md") as any;
    expect(row.source_type).toBe("docs");
  });

  it("reads back all meta fields together", () => {
    insertTestContent(db, "hash6");
    insertDocument(db, "docs", "test6.md", "Test6", "hash6", now, now, {
      source_type: "session",
      project: "cortex",
      tags: ["llm", "ai"],
    });

    const row = db.prepare(
      "SELECT source_type, project, tags FROM documents WHERE path = ?"
    ).get("test6.md") as any;

    expect(row.source_type).toBe("session");
    expect(row.project).toBe("cortex");
    expect(JSON.parse(row.tags)).toEqual(["llm", "ai"]);
  });

  it("updates meta fields on conflict (upsert)", () => {
    insertTestContent(db, "hash7");
    insertDocument(db, "docs", "test7.md", "Test7", "hash7", now, now, {
      source_type: "session",
      project: "old-project",
      tags: ["old"],
    });

    // Re-insert same collection+path with different meta
    insertDocument(db, "docs", "test7.md", "Test7 Updated", "hash7", now, now, {
      source_type: "knowledge",
      project: "new-project",
      tags: ["new", "updated"],
    });

    const row = db.prepare(
      "SELECT source_type, project, tags, title FROM documents WHERE path = ? AND collection = ?"
    ).get("test7.md", "docs") as any;

    expect(row.title).toBe("Test7 Updated");
    expect(row.source_type).toBe("knowledge");
    expect(row.project).toBe("new-project");
    expect(JSON.parse(row.tags)).toEqual(["new", "updated"]);
  });
});
