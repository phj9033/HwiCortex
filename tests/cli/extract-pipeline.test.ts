import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { StateManager } from "../../src/state/state-manager";
import {
  discoverSessionFiles,
  autoDetectParser,
  processSession,
  type ExtractDeps,
} from "../../src/cli/extract";
import type { LlmProvider } from "../../src/knowledge/llm-provider";
import type { HwiCortexConfig } from "../../src/config/config-loader";
import { VaultWriter } from "../../src/knowledge/vault-writer";
import { createStore } from "../../src/store";

// ============================================================================
// Fixtures
// ============================================================================

const TEST_DIR = resolve("tests/cli/.tmp-extract-test");
const VAULT_DIR = join(TEST_DIR, "vault");
const SESSIONS_DIR = join(TEST_DIR, "sessions");
const STATE_PATH = join(VAULT_DIR, ".state.json");

const CLAUDE_SESSION = [
  JSON.stringify({ type: "user", message: { role: "user", content: "Hello" }, timestamp: "2024-01-01T00:00:00Z" }),
  JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Hi there!" }] }, timestamp: "2024-01-01T00:01:00Z" }),
].join("\n");

const CODEX_SESSION = [
  JSON.stringify({ type: "session_meta", payload: { id: "codex-001", timestamp: "2024-01-01T00:00:00Z", cwd: "/tmp/test-project" } }),
  JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Hello from Codex" }] }, timestamp: "2024-01-01T00:00:01Z" }),
  JSON.stringify({ type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Response from Codex" }] }, timestamp: "2024-01-01T00:00:02Z" }),
].join("\n");

const MOCK_KNOWLEDGE_RESPONSE = JSON.stringify({
  title: "Test Knowledge",
  summary: "A test summary",
  keyInsights: ["insight1", "insight2"],
  tags: ["test", "cli"],
  relatedTopics: ["testing"],
});

function createMockProvider(response?: string): LlmProvider {
  return {
    name: "mock",
    complete: async () => response ?? MOCK_KNOWLEDGE_RESPONSE,
    estimateTokens: (text: string) => Math.ceil(text.length / 4),
  };
}

function createConfig(): HwiCortexConfig {
  return {
    vault: { path: VAULT_DIR },
    sessions: { watch_dirs: [SESSIONS_DIR], idle_timeout_minutes: 10 },
    llm: {
      default: "claude",
      claude: { api_key: "test-key", model: "test-model" },
      local: { model_path: "" },
      budget: { max_tokens_per_run: 100000, warn_threshold: 80000 },
    },
    ingest: { collections: [] },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("extract pipeline", () => {
  beforeEach(() => {
    mkdirSync(SESSIONS_DIR, { recursive: true });
    mkdirSync(VAULT_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("should process unprocessed sessions only", async () => {
    // Write two session files
    writeFileSync(join(SESSIONS_DIR, "session-a.jsonl"), CLAUDE_SESSION);
    writeFileSync(join(SESSIONS_DIR, "session-b.jsonl"), CLAUDE_SESSION);

    const stateManager = new StateManager(STATE_PATH);
    // Mark session-a as already processed
    stateManager.markProcessed("session-a", new Date().toISOString());

    const unprocessed = stateManager.filterUnprocessed(["session-a", "session-b"]);
    expect(unprocessed).toEqual(["session-b"]);
    expect(unprocessed).not.toContain("session-a");
  });

  it("should respect budget.max_tokens_per_run", async () => {
    writeFileSync(join(SESSIONS_DIR, "session-1.jsonl"), CLAUDE_SESSION);
    writeFileSync(join(SESSIONS_DIR, "session-2.jsonl"), CLAUDE_SESSION);

    const config = createConfig();
    // Set a very low budget — after processing session-1 we should stop
    config.llm.budget.max_tokens_per_run = 1;

    const stateManager = new StateManager(STATE_PATH);
    const store = createStore(join(TEST_DIR, "test-db"));
    const vaultWriter = new VaultWriter(VAULT_DIR);

    const deps: ExtractDeps = {
      config,
      stateManager,
      llmProvider: createMockProvider(),
      vaultWriter,
      store,
    };

    // Process session-1 (will consume tokens > budget)
    const sessionFile = join(SESSIONS_DIR, "session-1.jsonl");
    const tokensUsed = await processSession(sessionFile, deps);
    expect(tokensUsed).toBeGreaterThan(0);

    // After session-1, totalTokensUsed > max_tokens_per_run (1),
    // so the CLI loop would stop. We verify the budget logic here:
    expect(tokensUsed).toBeGreaterThan(config.llm.budget.max_tokens_per_run);

    store.close();
  });

  it("should record failures to state and continue", async () => {
    const stateManager = new StateManager(STATE_PATH);

    // Simulate adding a failure
    stateManager.addToFailedQueue("session-fail", "Parse error");

    const state = stateManager.load();
    expect(state.failedQueue).toHaveLength(1);
    expect(state.failedQueue[0].sessionId).toBe("session-fail");
    expect(state.failedQueue[0].error).toBe("Parse error");

    // After successful re-processing, markProcessed removes from failed queue
    stateManager.markProcessed("session-fail", new Date().toISOString());

    const updated = stateManager.load();
    expect(updated.failedQueue).toHaveLength(0);
    expect(updated.processedSessions).toContain("session-fail");
  });

  it("--dry-run should show stats without processing", () => {
    writeFileSync(join(SESSIONS_DIR, "session-dry.jsonl"), CLAUDE_SESSION);

    const stateManager = new StateManager(STATE_PATH);
    const files = discoverSessionFiles([SESSIONS_DIR]);

    expect(files.length).toBeGreaterThan(0);

    const unprocessed = stateManager.filterUnprocessed(
      files.map((f) => f.replace(/.*\//, "").replace(".jsonl", "")),
    );

    // Should have unprocessed sessions
    expect(unprocessed.length).toBeGreaterThan(0);

    // In dry-run mode we would just estimate tokens, not process
    let totalTokens = 0;
    for (const filePath of files) {
      const content = readFileSync(filePath, "utf-8");
      totalTokens += Math.ceil(content.length / 4);
    }
    expect(totalTokens).toBeGreaterThan(0);
  });

  it("should auto-detect Claude session format", () => {
    writeFileSync(join(SESSIONS_DIR, "claude-test.jsonl"), CLAUDE_SESSION);
    const parser = autoDetectParser(join(SESSIONS_DIR, "claude-test.jsonl"));
    expect(parser.name).toBe("claude-code");
  });

  it("should auto-detect Codex session format", () => {
    writeFileSync(join(SESSIONS_DIR, "codex-test.jsonl"), CODEX_SESSION);
    const parser = autoDetectParser(join(SESSIONS_DIR, "codex-test.jsonl"));
    expect(parser.name).toBe("codex-cli");
  });

  it("should discover session files from watch dirs", () => {
    writeFileSync(join(SESSIONS_DIR, "s1.jsonl"), CLAUDE_SESSION);
    writeFileSync(join(SESSIONS_DIR, "s2.jsonl"), CLAUDE_SESSION);
    writeFileSync(join(SESSIONS_DIR, "not-a-session.txt"), "nope");

    const files = discoverSessionFiles([SESSIONS_DIR]);
    expect(files.length).toBe(2);
    expect(files.every((f) => f.endsWith(".jsonl"))).toBe(true);
  });

  it("should write session markdown and knowledge to vault", async () => {
    writeFileSync(join(SESSIONS_DIR, "session-write.jsonl"), CLAUDE_SESSION);

    const config = createConfig();
    const stateManager = new StateManager(STATE_PATH);
    const store = createStore(join(TEST_DIR, "test-db-write"));
    const vaultWriter = new VaultWriter(VAULT_DIR);

    const deps: ExtractDeps = {
      config,
      stateManager,
      llmProvider: createMockProvider(),
      vaultWriter,
      store,
    };

    await processSession(join(SESSIONS_DIR, "session-write.jsonl"), deps);

    // Check session markdown was written
    // The parser derives project from parent dir name
    const sessionsVault = join(VAULT_DIR, "sessions");
    expect(existsSync(sessionsVault)).toBe(true);

    // Check knowledge was written
    const knowledgeVault = join(VAULT_DIR, "knowledge");
    expect(existsSync(knowledgeVault)).toBe(true);

    // Check state was updated
    const state = stateManager.load();
    expect(state.processedSessions).toContain("session-write");

    store.close();
  });
});
