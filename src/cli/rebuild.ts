/**
 * rebuild.ts — CLI handler for `hwicortex rebuild`
 *
 * 1. Backup existing DB
 * 2. Create fresh DB
 * 3. Scan vault/docs/ → index as "docs"
 * 4. Scan vault/sessions/ → index as "sessions"
 * 5. Scan vault/knowledge/ → index as "knowledge"
 */

import { resolve, join, basename, relative } from "node:path";
import {
  existsSync,
  readFileSync,
  copyFileSync,
  mkdirSync,
} from "node:fs";
import fastGlob from "fast-glob";
import { loadConfig } from "../config/config-loader.js";
import {
  insertDocument,
  hashContent,
  insertContent,
  createStore,
  getDefaultDbPath,
  upsertFTS,
  getDocumentId,
  setKoreanTokenizerState,
} from "../store.js";

export interface RebuildOptions {
  configPath?: string;
}

export async function handleRebuild(options: RebuildOptions): Promise<void> {
  const configPath = options.configPath ?? resolve("hwicortex.yaml");
  if (!existsSync(configPath)) {
    console.error(`Config not found: ${configPath}`);
    process.exit(1);
  }

  const config = loadConfig(configPath);
  const vaultPath = resolve(config.vault.path);

  // 1. Backup existing DB
  const dbPath = getDefaultDbPath();
  if (existsSync(dbPath)) {
    const backupPath = `${dbPath}.backup-${Date.now()}`;
    copyFileSync(dbPath, backupPath);
    console.log(`Backed up DB to ${backupPath}`);
  }

  // 2. Create fresh store
  const store = createStore();
  const db = store.db;

  const collectionName = "hwicortex";

  // Helper: scan a vault subdirectory and index all .md files
  async function indexDir(
    subDir: string,
    sourceType: string,
  ): Promise<number> {
    const dir = join(vaultPath, subDir);
    if (!existsSync(dir)) {
      console.log(`  ${subDir}/ not found — skipping.`);
      return 0;
    }

    const files = await fastGlob("**/*.md", {
      cwd: dir,
      absolute: true,
      onlyFiles: true,
    });

    let count = 0;
    for (const filePath of files) {
      // Skip error logs
      if (basename(filePath) === "_errors.md") continue;

      try {
        const content = readFileSync(filePath, "utf-8");
        const hash = await hashContent(content);
        const title = basename(filePath, ".md");
        const now = new Date().toISOString();

        // Derive project from folder structure: vault/<subDir>/<project>/<file>.md
        const rel = relative(dir, filePath);
        const parts = rel.split("/");
        const project = parts.length > 1 ? parts[0] : undefined;

        insertContent(db, hash, content, now);
        insertDocument(db, collectionName, filePath, title, hash, now, now, {
          source_type: sourceType,
          project,
        });
        const docId = getDocumentId(db, collectionName, filePath);
        if (docId) await upsertFTS(db, docId, collectionName + "/" + filePath, title, content);
        count++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  [ERROR] ${filePath}: ${msg}`);
      }
    }

    return count;
  }

  // 3-5. Scan and index each vault subdirectory
  console.log("Rebuilding index from vault...\n");

  const docsCount = await indexDir("docs", "docs");
  console.log(`  docs: ${docsCount} file(s) indexed`);

  const sessionsCount = await indexDir("sessions", "sessions");
  console.log(`  sessions: ${sessionsCount} file(s) indexed`);

  const knowledgeCount = await indexDir("knowledge", "knowledge");
  console.log(`  knowledge: ${knowledgeCount} file(s) indexed`);

  setKoreanTokenizerState(db);

  store.close();

  const total = docsCount + sessionsCount + knowledgeCount;
  console.log(`\nDone: ${total} total file(s) indexed.`);
}
