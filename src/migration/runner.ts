/**
 * migration/runner.ts — Schema migration runner for HwiCortex
 *
 * Tracks database schema version in a `schema_version` table and runs
 * pending migrations in order. Each migration runs in its own transaction;
 * on failure the transaction is rolled back and remaining migrations are
 * skipped.
 */

import { copyFileSync, existsSync } from "fs";
import type { Database } from "../db.js";

// ── Types ──────────────────────────────────────────────────────────────

export interface Migration {
  /** Monotonically increasing version number (1, 2, 3 …) */
  version: number;
  /** Human-readable description for logs */
  description: string;
  /** Forward migration function — receives a Database handle */
  up(db: Database): void;
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Ensure the schema_version table exists. */
function ensureSchemaVersionTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

/** Check whether a column exists on a table. */
function columnExists(db: Database, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some((c) => c.name === column);
}

/**
 * Return the current schema version (highest applied version).
 * Returns 0 if the schema_version table doesn't exist or is empty.
 */
export function getCurrentVersion(db: Database): number {
  try {
    const row = db.prepare(
      "SELECT MAX(version) as v FROM schema_version"
    ).get() as { v: number | null } | undefined;
    return row?.v ?? 0;
  } catch {
    // Table doesn't exist yet
    return 0;
  }
}

// ── Runner ─────────────────────────────────────────────────────────────

/**
 * Run all pending migrations against `db`.
 *
 * - Creates the schema_version table if needed
 * - Backs up the database file before the first pending migration
 * - Runs each migration in its own transaction
 * - On failure: rolls back the failing migration and stops
 */
export function runMigrations(
  db: Database,
  dbPath: string,
  migrations: Migration[],
): void {
  ensureSchemaVersionTable(db);

  const current = getCurrentVersion(db);

  // Filter and sort pending migrations
  const pending = migrations
    .filter((m) => m.version > current)
    .sort((a, b) => a.version - b.version);

  if (pending.length === 0) return;

  // Backup before applying any migrations
  if (dbPath !== ":memory:" && existsSync(dbPath)) {
    copyFileSync(dbPath, dbPath + ".bak");
  }

  for (const migration of pending) {
    try {
      db.exec("BEGIN");
      migration.up(db);
      db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(
        migration.version,
      );
      db.exec("COMMIT");
    } catch (err) {
      try { db.exec("ROLLBACK"); } catch { /* already rolled back */ }
      console.error(
        `Migration v${migration.version} (${migration.description}) failed:`,
        err,
      );
      // Stop processing further migrations
      break;
    }
  }
}

// ── Default migrations ─────────────────────────────────────────────────

export const DEFAULT_MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: "Add source_type, project, tags columns to documents",
    up(db: Database) {
      if (!columnExists(db, "documents", "source_type")) {
        db.exec("ALTER TABLE documents ADD COLUMN source_type TEXT DEFAULT 'docs'");
      }
      if (!columnExists(db, "documents", "project")) {
        db.exec("ALTER TABLE documents ADD COLUMN project TEXT");
      }
      if (!columnExists(db, "documents", "tags")) {
        db.exec("ALTER TABLE documents ADD COLUMN tags TEXT"); // JSON array
      }
      db.exec(
        "CREATE INDEX IF NOT EXISTS idx_documents_source_type ON documents(source_type, active)"
      );
      db.exec(
        "CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project, active)"
      );
    },
  },
  {
    version: 2,
    description: "Add type, parser, watch_dir columns to store_collections",
    up(db: Database) {
      // store_collections may not exist yet if DB was created before collections feature
      const tableCheck = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='store_collections'"
      ).get();
      if (!tableCheck) return; // Table doesn't exist; columns will be in CREATE TABLE when it's created

      if (!columnExists(db, "store_collections", "type")) {
        db.exec("ALTER TABLE store_collections ADD COLUMN type TEXT DEFAULT 'static'");
      }
      if (!columnExists(db, "store_collections", "parser")) {
        db.exec("ALTER TABLE store_collections ADD COLUMN parser TEXT");
      }
      if (!columnExists(db, "store_collections", "watch_dir")) {
        db.exec("ALTER TABLE store_collections ADD COLUMN watch_dir TEXT");
      }
    },
  },
  {
    version: 3,
    description: "Add graph tables: symbols, relations, clusters, cluster_members",
    up(db: Database) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS symbols (
          id INTEGER PRIMARY KEY,
          hash TEXT NOT NULL,
          name TEXT NOT NULL,
          kind TEXT NOT NULL,
          line INTEGER,
          FOREIGN KEY (hash) REFERENCES content(hash)
        );
        CREATE INDEX IF NOT EXISTS idx_symbols_hash ON symbols(hash);
        CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);

        CREATE TABLE IF NOT EXISTS relations (
          id INTEGER PRIMARY KEY,
          source_hash TEXT NOT NULL,
          target_hash TEXT,
          target_ref TEXT NOT NULL,
          type TEXT NOT NULL,
          source_symbol TEXT,
          target_symbol TEXT,
          confidence REAL DEFAULT 1.0,
          FOREIGN KEY (source_hash) REFERENCES content(hash)
        );
        CREATE INDEX IF NOT EXISTS idx_relations_source ON relations(source_hash);
        CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(target_hash);
        CREATE INDEX IF NOT EXISTS idx_relations_type ON relations(type);

        CREATE TABLE IF NOT EXISTS clusters (
          id INTEGER PRIMARY KEY,
          collection TEXT NOT NULL,
          name TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now')),
          UNIQUE(collection, name)
        );

        CREATE TABLE IF NOT EXISTS cluster_members (
          cluster_id INTEGER NOT NULL,
          hash TEXT NOT NULL,
          PRIMARY KEY (cluster_id, hash),
          FOREIGN KEY (cluster_id) REFERENCES clusters(id),
          FOREIGN KEY (hash) REFERENCES content(hash)
        );
      `);
    },
  },
  {
    version: 4,
    description: "Add kind column to clusters for code/doc separation",
    up(db: Database) {
      db.exec(`
        -- Recreate clusters table with kind column and updated unique constraint
        CREATE TABLE clusters_new (
          id INTEGER PRIMARY KEY,
          collection TEXT NOT NULL,
          name TEXT NOT NULL,
          kind TEXT DEFAULT 'code',
          created_at TEXT DEFAULT (datetime('now')),
          UNIQUE(collection, name, kind)
        );
        INSERT INTO clusters_new (id, collection, name, kind, created_at)
          SELECT id, collection, name, 'code', created_at FROM clusters;
        DROP TABLE clusters;
        ALTER TABLE clusters_new RENAME TO clusters;
      `);
    },
  },
];
