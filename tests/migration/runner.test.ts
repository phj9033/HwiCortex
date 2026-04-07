import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, unlinkSync, copyFileSync } from "fs";
import { openDatabase } from "../../src/db.js";
import type { Database } from "../../src/db.js";
import {
  runMigrations,
  getCurrentVersion,
  type Migration,
} from "../../src/migration/runner.js";

const TEST_DB_PATH = "/tmp/hwicortex-migration-test.db";
const TEST_DB_BAK_PATH = TEST_DB_PATH + ".bak";

function cleanup() {
  for (const p of [TEST_DB_PATH, TEST_DB_BAK_PATH, TEST_DB_PATH + "-wal", TEST_DB_PATH + "-shm"]) {
    if (existsSync(p)) unlinkSync(p);
  }
}

/** Create the base documents table as initializeDatabase() would */
function createBaseSchema(db: Database) {
  db.exec("PRAGMA journal_mode = WAL");
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

describe("Migration Runner", () => {
  let db: Database;

  beforeEach(() => {
    cleanup();
    db = openDatabase(TEST_DB_PATH);
    createBaseSchema(db);
  });

  afterEach(() => {
    try { db.close(); } catch {}
    cleanup();
  });

  describe("schema_version table", () => {
    it("should create schema_version table if it does not exist", () => {
      runMigrations(db, TEST_DB_PATH, []);
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'"
      ).all() as { name: string }[];
      expect(tables).toHaveLength(1);
    });

    it("should return version 0 when schema_version table does not exist", () => {
      expect(getCurrentVersion(db)).toBe(0);
    });

    it("should return version 0 when schema_version table is empty", () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS schema_version (
          version INTEGER PRIMARY KEY,
          applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      expect(getCurrentVersion(db)).toBe(0);
    });
  });

  describe("running migrations", () => {
    it("should run a single migration and update version", () => {
      const migrations: Migration[] = [
        {
          version: 1,
          description: "add test column",
          up(db: Database) {
            db.exec("ALTER TABLE documents ADD COLUMN test_col TEXT");
          },
        },
      ];
      runMigrations(db, TEST_DB_PATH, migrations);

      expect(getCurrentVersion(db)).toBe(1);
      // Verify column exists
      const cols = db.prepare("PRAGMA table_info(documents)").all() as { name: string }[];
      expect(cols.some((c) => c.name === "test_col")).toBe(true);
    });

    it("should run multiple migrations in order", () => {
      const migrations: Migration[] = [
        {
          version: 1,
          description: "add col_a",
          up(db: Database) {
            db.exec("ALTER TABLE documents ADD COLUMN col_a TEXT");
          },
        },
        {
          version: 2,
          description: "add col_b",
          up(db: Database) {
            db.exec("ALTER TABLE documents ADD COLUMN col_b TEXT");
          },
        },
      ];
      runMigrations(db, TEST_DB_PATH, migrations);

      expect(getCurrentVersion(db)).toBe(2);
      const cols = db.prepare("PRAGMA table_info(documents)").all() as { name: string }[];
      expect(cols.some((c) => c.name === "col_a")).toBe(true);
      expect(cols.some((c) => c.name === "col_b")).toBe(true);
    });

    it("should skip already-applied migrations", () => {
      const migration1: Migration = {
        version: 1,
        description: "add col_a",
        up(db: Database) {
          db.exec("ALTER TABLE documents ADD COLUMN col_a TEXT");
        },
      };
      // Run first migration
      runMigrations(db, TEST_DB_PATH, [migration1]);
      expect(getCurrentVersion(db)).toBe(1);

      // Run again with two migrations — only v2 should run
      let v2Ran = false;
      const migrations: Migration[] = [
        migration1,
        {
          version: 2,
          description: "add col_b",
          up(db: Database) {
            db.exec("ALTER TABLE documents ADD COLUMN col_b TEXT");
            v2Ran = true;
          },
        },
      ];
      runMigrations(db, TEST_DB_PATH, migrations);
      expect(getCurrentVersion(db)).toBe(2);
      expect(v2Ran).toBe(true);
    });
  });

  describe("backup", () => {
    it("should create a .bak file before running migrations", () => {
      const migrations: Migration[] = [
        {
          version: 1,
          description: "add test column",
          up(db: Database) {
            db.exec("ALTER TABLE documents ADD COLUMN test_col TEXT");
          },
        },
      ];
      runMigrations(db, TEST_DB_PATH, migrations);
      expect(existsSync(TEST_DB_BAK_PATH)).toBe(true);
    });

    it("should not create backup when no migrations to run", () => {
      // No pending migrations
      runMigrations(db, TEST_DB_PATH, []);
      expect(existsSync(TEST_DB_BAK_PATH)).toBe(false);
    });
  });

  describe("rollback on failure", () => {
    it("should keep original version when migration fails", () => {
      const migrations: Migration[] = [
        {
          version: 1,
          description: "will fail",
          up(db: Database) {
            db.exec("ALTER TABLE nonexistent_table ADD COLUMN oops TEXT");
          },
        },
      ];
      // Should not throw — runner catches and logs
      runMigrations(db, TEST_DB_PATH, migrations);
      expect(getCurrentVersion(db)).toBe(0);
    });

    it("should apply successful migrations before a failing one", () => {
      const migrations: Migration[] = [
        {
          version: 1,
          description: "good migration",
          up(db: Database) {
            db.exec("ALTER TABLE documents ADD COLUMN good_col TEXT");
          },
        },
        {
          version: 2,
          description: "bad migration",
          up(db: Database) {
            db.exec("ALTER TABLE nonexistent_table ADD COLUMN oops TEXT");
          },
        },
      ];
      runMigrations(db, TEST_DB_PATH, migrations);
      // v1 should have committed, v2 should have rolled back
      expect(getCurrentVersion(db)).toBe(1);
    });
  });

  describe("migration v1 — HwiCortex columns", () => {
    it("should add source_type, project, tags columns to documents", async () => {
      // Import the default migrations
      const { DEFAULT_MIGRATIONS } = await import("../../src/migration/runner.js");
      runMigrations(db, TEST_DB_PATH, DEFAULT_MIGRATIONS);

      const cols = db.prepare("PRAGMA table_info(documents)").all() as { name: string; dflt_value: string | null }[];
      const sourceType = cols.find((c) => c.name === "source_type");
      const project = cols.find((c) => c.name === "project");
      const tags = cols.find((c) => c.name === "tags");

      expect(sourceType).toBeDefined();
      expect(sourceType!.dflt_value).toBe("'docs'");
      expect(project).toBeDefined();
      expect(tags).toBeDefined();

      expect(getCurrentVersion(db)).toBe(1);
    });

    it("should create indexes for source_type and project", async () => {
      const { DEFAULT_MIGRATIONS } = await import("../../src/migration/runner.js");
      runMigrations(db, TEST_DB_PATH, DEFAULT_MIGRATIONS);

      const indexes = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='documents'"
      ).all() as { name: string }[];
      const indexNames = indexes.map((i) => i.name);
      expect(indexNames).toContain("idx_documents_source_type");
      expect(indexNames).toContain("idx_documents_project");
    });

    it("should be idempotent — running twice should not fail", async () => {
      const { DEFAULT_MIGRATIONS } = await import("../../src/migration/runner.js");
      runMigrations(db, TEST_DB_PATH, DEFAULT_MIGRATIONS);
      // Second run should be a no-op (migrations already applied)
      runMigrations(db, TEST_DB_PATH, DEFAULT_MIGRATIONS);
      expect(getCurrentVersion(db)).toBe(1);
    });
  });
});
