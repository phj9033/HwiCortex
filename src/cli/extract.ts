/**
 * extract.ts — CLI handler for `hwicortex extract [--session <id>] [--dry-run]`
 *
 * 1. Load config + state manager
 * 2. Find unprocessed sessions (+ failed queue retry)
 * 3. --dry-run: show session count + estimated tokens, exit
 * 4. For each session: parse → markdown → extract knowledge → classify → write → index
 * 5. Budget safety: stop if token limit exceeded
 * 6. Error handling: record failures, continue
 */

import { resolve, join, basename, extname } from "node:path";
import { readdirSync, existsSync, readFileSync } from "node:fs";
import fastGlob from "fast-glob";
import { loadConfig, type HwiCortexConfig } from "../config/config-loader.js";
import { StateManager } from "../state/state-manager.js";
import { ClaudeSessionParser } from "../ingest/session-parser/claude.js";
import { CodexSessionParser } from "../ingest/session-parser/codex.js";
import { sessionToMarkdown } from "../ingest/session-to-markdown.js";
import { createLlmProvider, type LlmProvider } from "../knowledge/llm-provider.js";
import { KnowledgeExtractor } from "../knowledge/extractor.js";
import { classify } from "../knowledge/classifier.js";
import { VaultWriter } from "../knowledge/vault-writer.js";
import {
  insertDocument,
  hashContent,
  insertContent,
  createStore,
  upsertFTS,
  getDocumentId,
} from "../store.js";
import type { SessionParser, ParsedSession } from "../ingest/session-parser/types.js";

export interface ExtractOptions {
  session?: string;
  dryRun?: boolean;
  configPath?: string;
}

/**
 * Core extract pipeline — exported so tests and watch handler can reuse it.
 */
export interface ExtractDeps {
  config: HwiCortexConfig;
  stateManager: StateManager;
  llmProvider: LlmProvider;
  vaultWriter: VaultWriter;
  store: ReturnType<typeof createStore>;
}

/**
 * Discover session files from config watch_dirs.
 */
export function discoverSessionFiles(watchDirs: string[]): string[] {
  const files: string[] = [];
  for (const dir of watchDirs) {
    const absDir = resolve(dir);
    if (!existsSync(absDir)) continue;
    try {
      const found = fastGlob.sync("**/*.jsonl", {
        cwd: absDir,
        absolute: true,
        onlyFiles: true,
      });
      files.push(...found);
    } catch {
      // Skip inaccessible directories
    }
  }
  return files;
}

/**
 * Auto-detect the appropriate parser for a session file.
 */
export function autoDetectParser(filePath: string): SessionParser {
  const claudeParser = new ClaudeSessionParser();
  const codexParser = new CodexSessionParser();

  // Try reading first line for session_meta (Codex indicator)
  try {
    const content = readFileSync(filePath, "utf-8");
    const firstLine = content.split("\n")[0] ?? "";
    const parsed = JSON.parse(firstLine);
    if (parsed.type === "session_meta") {
      return codexParser;
    }
  } catch {
    // Fall through to Claude parser
  }

  return claudeParser;
}

/**
 * Process a single session file through the full extract pipeline.
 * Returns the estimated tokens consumed.
 */
export async function processSession(
  filePath: string,
  deps: ExtractDeps,
): Promise<number> {
  const { config, stateManager, llmProvider, vaultWriter, store } = deps;
  const db = store.db;
  const sessionId = basename(filePath, extname(filePath));

  // 1. Parse session
  const parser = autoDetectParser(filePath);
  const parsed: ParsedSession = await parser.parse(filePath);

  // 2. Convert to markdown → save to vault/sessions/
  const markdown = sessionToMarkdown(parsed);
  const sessionFileName = `${sessionId}.md`;
  await vaultWriter.writeSession(parsed.project, sessionFileName, markdown);

  // Index session markdown
  const sessionDocPath = join(
    resolve(config.vault.path),
    "sessions",
    parsed.project,
    sessionFileName,
  );
  const sessionHash = await hashContent(markdown);
  const now = new Date().toISOString();
  insertContent(db, sessionHash, markdown, now);
  insertDocument(db, "hwicortex", sessionDocPath, sessionId, sessionHash, now, now, {
    source_type: "sessions",
    project: parsed.project,
  });
  const sessionDocId = getDocumentId(db, "hwicortex", sessionDocPath);
  if (sessionDocId) await upsertFTS(db, sessionDocId, "hwicortex/" + sessionDocPath, sessionId, markdown);

  // 3. Extract knowledge via LLM
  const extractor = new KnowledgeExtractor(llmProvider);
  const knowledge = await extractor.extract(markdown);
  const tokensUsed = llmProvider.estimateTokens(markdown);

  // 4. Classify → write to vault/knowledge/
  const classification = classify({
    title: knowledge.title,
    project: parsed.project,
    tags: knowledge.tags,
  });

  const knowledgeEntry = {
    title: knowledge.title,
    project: parsed.project,
    tags: knowledge.tags,
    summary: knowledge.summary,
    keyInsights: knowledge.keyInsights.map((insight) => ({
      date: now.slice(0, 10),
      sessionId,
      content: insight,
    })),
    sourceSession: sessionId,
  };

  await vaultWriter.writeKnowledge(knowledgeEntry);

  // Index knowledge file
  const knowledgePath = join(
    resolve(config.vault.path),
    "knowledge",
    classification.folder,
    classification.fileName,
  );
  const knowledgeContent = existsSync(knowledgePath)
    ? readFileSync(knowledgePath, "utf-8")
    : knowledge.summary;
  const knowledgeHash = await hashContent(knowledgeContent);
  insertContent(db, knowledgeHash, knowledgeContent, now);
  insertDocument(
    db,
    "hwicortex",
    knowledgePath,
    knowledge.title,
    knowledgeHash,
    now,
    now,
    {
      source_type: "knowledge",
      project: parsed.project,
      tags: knowledge.tags,
    },
  );
  const knowledgeDocId = getDocumentId(db, "hwicortex", knowledgePath);
  if (knowledgeDocId) await upsertFTS(db, knowledgeDocId, "hwicortex/" + knowledgePath, knowledge.title, knowledgeContent);

  // 5. Update state
  stateManager.markProcessed(sessionId, now);

  return tokensUsed;
}

export async function handleExtract(options: ExtractOptions): Promise<void> {
  const configPath = options.configPath ?? resolve("hwicortex.yaml");
  if (!existsSync(configPath)) {
    console.error(`Config not found: ${configPath}`);
    process.exit(1);
  }

  const config = loadConfig(configPath);
  const vaultPath = resolve(config.vault.path);
  const statePath = join(vaultPath, ".state.json");
  const stateManager = new StateManager(statePath);

  // Discover session files
  let sessionFiles: string[];
  if (options.session) {
    // Single session mode
    const singlePath = resolve(options.session);
    if (!existsSync(singlePath)) {
      console.error(`Session file not found: ${singlePath}`);
      process.exit(1);
    }
    sessionFiles = [singlePath];
  } else {
    const watchDirs = config.sessions?.watch_dirs ?? [];
    sessionFiles = discoverSessionFiles(watchDirs);
  }

  // Filter to unprocessed only
  const sessionIds = sessionFiles.map((f) => basename(f, extname(f)));
  const unprocessedIds = stateManager.filterUnprocessed(sessionIds);

  // Also include failed queue items for retry
  const state = stateManager.load();
  const failedIds = state.failedQueue.map((f) => f.sessionId);
  const retryIds = failedIds.filter((id) => !unprocessedIds.includes(id));
  const allIds = [...unprocessedIds, ...retryIds];

  // Map IDs back to file paths
  const idToFile = new Map(
    sessionFiles.map((f) => [basename(f, extname(f)), f]),
  );
  const toProcess = allIds
    .map((id) => idToFile.get(id))
    .filter((f): f is string => f !== undefined);

  // --dry-run mode
  if (options.dryRun) {
    let totalTokens = 0;
    for (const filePath of toProcess) {
      const content = readFileSync(filePath, "utf-8");
      totalTokens += Math.ceil(content.length / 4);
    }
    console.log(`Sessions to process: ${toProcess.length}`);
    console.log(`Estimated tokens: ${totalTokens}`);
    console.log(`(${retryIds.length} retries from failed queue)`);
    return;
  }

  if (toProcess.length === 0) {
    console.log("No unprocessed sessions found.");
    return;
  }

  console.log(`Processing ${toProcess.length} session(s)...`);

  // Set up dependencies
  const llmProvider = createLlmProvider(config.llm);
  const vaultWriter = new VaultWriter(vaultPath);
  const store = createStore();

  const deps: ExtractDeps = {
    config,
    stateManager,
    llmProvider,
    vaultWriter,
    store,
  };

  const maxTokens = config.llm.budget?.max_tokens_per_run ?? Infinity;
  let totalTokensUsed = 0;
  let processed = 0;
  let failures = 0;

  for (const filePath of toProcess) {
    const sessionId = basename(filePath, extname(filePath));

    // Budget safety
    if (totalTokensUsed >= maxTokens) {
      console.log(
        `Budget limit reached (${totalTokensUsed}/${maxTokens} tokens). Stopping.`,
      );
      break;
    }

    try {
      const tokens = await processSession(filePath, deps);
      totalTokensUsed += tokens;
      processed++;
      console.log(`  [OK] ${sessionId} (${tokens} tokens)`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [FAIL] ${sessionId}: ${msg}`);
      stateManager.addToFailedQueue(sessionId, msg);
      failures++;
    }
  }

  store.close();

  console.log(
    `\nDone: ${processed} processed, ${failures} failed, ${totalTokensUsed} tokens used.`,
  );
}
