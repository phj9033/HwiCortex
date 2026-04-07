/**
 * watch.ts — CLI handler for `hwicortex watch`
 *
 * 1. Load config
 * 2. Start SessionWatcher
 * 3. On session-ready → run extract pipeline for that session
 * 4. Ctrl+C → stop
 */

import { resolve, join, basename, extname } from "node:path";
import { existsSync } from "node:fs";
import { loadConfig } from "../config/config-loader.js";
import { StateManager } from "../state/state-manager.js";
import { SessionWatcher } from "../ingest/watcher.js";
import { createLlmProvider } from "../knowledge/llm-provider.js";
import { VaultWriter } from "../knowledge/vault-writer.js";
import { createStore } from "../store.js";
import { processSession, type ExtractDeps } from "./extract.js";

export interface WatchOptions {
  configPath?: string;
}

export async function handleWatch(options: WatchOptions): Promise<void> {
  const configPath = options.configPath ?? resolve("hwicortex.yaml");
  if (!existsSync(configPath)) {
    console.error(`Config not found: ${configPath}`);
    process.exit(1);
  }

  const config = loadConfig(configPath);
  const vaultPath = resolve(config.vault.path);
  const statePath = join(vaultPath, ".state.json");
  const stateManager = new StateManager(statePath);

  const watchDirs = config.sessions?.watch_dirs ?? [];
  if (watchDirs.length === 0) {
    console.error("No watch directories configured in sessions.watch_dirs");
    process.exit(1);
  }

  const idleTimeoutMs = (config.sessions?.idle_timeout_minutes ?? 10) * 60 * 1000;

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

  const watcher = new SessionWatcher({
    watchDirs: watchDirs.map((d) => resolve(d)),
    idleTimeoutMs,
  });

  watcher.on("session-ready", async (filePath: string) => {
    const sessionId = basename(filePath, extname(filePath));

    // Skip already-processed sessions
    const unprocessed = stateManager.filterUnprocessed([sessionId]);
    if (unprocessed.length === 0) {
      return;
    }

    console.log(`Processing session: ${sessionId}`);
    try {
      const tokens = await processSession(filePath, deps);
      console.log(`  [OK] ${sessionId} (${tokens} tokens)`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [FAIL] ${sessionId}: ${msg}`);
      stateManager.addToFailedQueue(sessionId, msg);
    }
  });

  watcher.on("error", (err: Error) => {
    console.error(`Watcher error: ${err.message}`);
  });

  // Graceful shutdown
  const cleanup = () => {
    console.log("\nStopping watcher...");
    watcher.stop();
    store.close();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  console.log(`Watching ${watchDirs.length} directory(ies):`);
  for (const dir of watchDirs) {
    console.log(`  ${resolve(dir)}`);
  }
  console.log("Press Ctrl+C to stop.\n");

  watcher.start();
}
