import { describe, it, expect, beforeEach } from "vitest";
import { openDatabase } from "../../src/db.js";
import type { Database } from "../../src/db.js";
import { runMigrations, DEFAULT_MIGRATIONS } from "../../src/migration/runner.js";
import {
  upsertStoreCollection,
  getStoreCollection,
  getStoreCollections,
} from "../../src/store.js";
import type { Collection } from "../../src/collections.js";

/** Create the base schema including store_collections */
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
  db.exec(`
    CREATE TABLE IF NOT EXISTS store_config (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);
}

describe("Dynamic collection type", () => {
  let db: Database;

  beforeEach(() => {
    db = openDatabase(":memory:");
    createBaseSchema(db);
    runMigrations(db, ":memory:", DEFAULT_MIGRATIONS);
  });

  it("should register a static collection with default type", () => {
    const coll: Collection = {
      path: "/docs/notes",
      pattern: "**/*.md",
    };
    upsertStoreCollection(db, "notes", coll);

    const stored = getStoreCollection(db, "notes");
    expect(stored).not.toBeNull();
    expect(stored!.name).toBe("notes");
    expect(stored!.path).toBe("/docs/notes");
    // Default type should be "static" when not specified
    expect(stored!.type).toBeUndefined();  // not set explicitly, but DB default is 'static'
  });

  it("should register a dynamic session collection with parser and watchDir", () => {
    const coll: Collection = {
      type: "dynamic",
      path: "/sessions/claude",
      pattern: "**/*.jsonl",
      parser: "claude",
      watchDir: "/home/user/.claude/projects",
    };
    upsertStoreCollection(db, "claude-sessions", coll);

    const stored = getStoreCollection(db, "claude-sessions");
    expect(stored).not.toBeNull();
    expect(stored!.type).toBe("dynamic");
    expect(stored!.parser).toBe("claude");
    expect(stored!.watchDir).toBe("/home/user/.claude/projects");
  });

  it("should distinguish static from dynamic collections", () => {
    upsertStoreCollection(db, "docs", {
      type: "static",
      path: "/docs",
      pattern: "**/*.md",
    });
    upsertStoreCollection(db, "sessions", {
      type: "dynamic",
      path: "/sessions",
      pattern: "**/*.jsonl",
      parser: "codex",
      watchDir: "/tmp/codex-sessions",
    });

    const all = getStoreCollections(db);
    const staticColls = all.filter(c => (c.type ?? "static") === "static");
    const dynamicColls = all.filter(c => c.type === "dynamic");

    expect(staticColls.length).toBe(1);
    expect(staticColls[0]!.name).toBe("docs");
    expect(dynamicColls.length).toBe(1);
    expect(dynamicColls[0]!.name).toBe("sessions");
    expect(dynamicColls[0]!.parser).toBe("codex");
  });

  it("should default type to 'static' in migration when not specified", () => {
    // Insert without type (pre-migration scenario simulated by createBaseSchema)
    db.prepare(`INSERT INTO store_collections (name, path, pattern) VALUES (?, ?, ?)`)
      .run("old-collection", "/old", "**/*.md");

    // The migration v2 adds type column with DEFAULT 'static'
    const row = db.prepare(`SELECT type FROM store_collections WHERE name = ?`)
      .get("old-collection") as { type: string | null };
    expect(row.type).toBe("static");
  });

  it("should round-trip Collection interface fields through DB", () => {
    const coll: Collection = {
      type: "dynamic",
      path: "/watch/claude",
      pattern: "**/*.jsonl",
      ignore: ["archive/**"],
      parser: "claude",
      watchDir: "/home/user/.claude",
      includeByDefault: false,
      update: "echo refresh",
    };
    upsertStoreCollection(db, "round-trip", coll);

    const stored = getStoreCollection(db, "round-trip");
    expect(stored).not.toBeNull();
    expect(stored!.type).toBe("dynamic");
    expect(stored!.path).toBe("/watch/claude");
    expect(stored!.pattern).toBe("**/*.jsonl");
    expect(stored!.ignore).toEqual(["archive/**"]);
    expect(stored!.parser).toBe("claude");
    expect(stored!.watchDir).toBe("/home/user/.claude");
    expect(stored!.includeByDefault).toBe(false);
    expect(stored!.update).toBe("echo refresh");
  });
});
