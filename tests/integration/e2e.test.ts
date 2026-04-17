/**
 * e2e.test.ts — End-to-end integration tests for HwiCortex
 *
 * Tests the full pipelines: ingest → search, extract → search, rebuild, and
 * error handling. Uses mock LLM and temp directories throughout.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";

import {
  createStore,
  insertDocument,
  insertContent,
  hashContent,
  searchFTS,
  upsertFTS,
  getDocumentId,
} from "../../src/store.js";
import { StateManager } from "../../src/state/state-manager.js";
import {
  processSession,
  discoverSessionFiles,
  type ExtractDeps,
} from "../../src/cli/extract.js";
import type { LlmProvider } from "../../src/knowledge/llm-provider.js";
import type { HwiCortexConfig } from "../../src/config/config-loader.js";
import { VaultWriter } from "../../src/knowledge/vault-writer.js";

// ============================================================================
// Helpers
// ============================================================================

const BASE_DIR = resolve("tests/integration/.tmp-e2e");

function tmpDir(suffix: string): string {
  return join(BASE_DIR, suffix);
}

const MOCK_KNOWLEDGE_RESPONSE = JSON.stringify({
  title: "Test Knowledge",
  summary: "A test summary about project structure",
  keyInsights: ["insight about structure", "insight about testing"],
  tags: ["test", "integration"],
  relatedTopics: ["testing"],
});

function createMockProvider(response?: string): LlmProvider {
  return {
    name: "mock",
    complete: async () => response ?? MOCK_KNOWLEDGE_RESPONSE,
    estimateTokens: (text: string) => Math.ceil(text.length / 4),
  };
}

function createConfig(vaultDir: string, sessionsDir?: string): HwiCortexConfig {
  return {
    vault: { path: vaultDir },
    sessions: {
      watch_dirs: sessionsDir ? [sessionsDir] : [],
      idle_timeout_minutes: 10,
    },
    llm: {
      default: "claude",
      claude: { api_key: "test-key", model: "test-model" },
      local: { model_path: "" },
      budget: { max_tokens_per_run: 1000000, warn_threshold: 800000 },
    },
    ingest: { collections: [] },
  };
}

const SAMPLE_CLAUDE_SESSION = [
  JSON.stringify({
    type: "user",
    message: { role: "user", content: "Explain the project structure" },
    timestamp: "2026-03-15T10:00:00.000Z",
    sessionId: "e2e-session-001",
  }),
  JSON.stringify({
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        {
          type: "text",
          text: "The project has a src directory with modules for ingest, knowledge, and CLI commands.",
        },
      ],
    },
    timestamp: "2026-03-15T10:00:01.000Z",
    sessionId: "e2e-session-001",
  }),
].join("\n");

// ============================================================================
// 1. Ingest → Search flow
// ============================================================================

describe("E2E: ingest → search flow", () => {
  const testDir = tmpDir("ingest-search");
  const vaultDir = join(testDir, "vault");
  const docsDir = join(vaultDir, "docs");
  const docsSourceDir = join(testDir, "source-docs");
  const dbPath = join(testDir, "test.sqlite");

  beforeEach(() => {
    mkdirSync(docsSourceDir, { recursive: true });
    mkdirSync(docsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should ingest a markdown file and find it via searchFTS", async () => {
    // 1. Write a markdown file to source directory
    const mdContent = `# Authentication Guide

This document explains how to set up authentication using JWT tokens.
Users must first register, then login to obtain an access token.
The token is passed in the Authorization header for subsequent requests.
`;
    writeFileSync(join(docsSourceDir, "auth-guide.md"), mdContent);

    // 2. Use store modules directly to ingest (simulates handleIngest logic)
    const store = createStore(dbPath);
    const db = store.db;

    const destPath = join(docsDir, "auth-guide.md");
    writeFileSync(destPath, mdContent, "utf-8");

    const now = new Date().toISOString();
    const hash = await hashContent(mdContent);
    const title = "auth-guide";

    insertContent(db, hash, mdContent, now);
    insertDocument(db, "e2e-test", destPath, title, hash, now, now, {
      source_type: "docs",
    });
    const docId = getDocumentId(db, "e2e-test", destPath);
    await upsertFTS(db, docId!, destPath, title, mdContent);

    // 3. Search for it using FTS
    const results = await searchFTS(db, "authentication JWT tokens", 10, undefined, "docs");
    expect(results.length).toBeGreaterThan(0);

    // The result should reference our ingested document
    const found = results.some(
      (r) => r.filepath.includes("auth-guide") || r.title === "auth-guide",
    );
    expect(found).toBe(true);

    store.close();
  });

  it("should ingest multiple files and filter by source_type", async () => {
    const store = createStore(dbPath);
    const db = store.db;
    const now = new Date().toISOString();

    // Ingest a "docs" file
    const docsContent = "Guide to deploying applications with Docker containers.";
    const docsHash = await hashContent(docsContent);
    insertContent(db, docsHash, docsContent, now);
    insertDocument(db, "e2e-test", "/tmp/deploy.md", "deploy", docsHash, now, now, {
      source_type: "docs",
    });
    const docsDocId = getDocumentId(db, "e2e-test", "/tmp/deploy.md");
    await upsertFTS(db, docsDocId!, "/tmp/deploy.md", "deploy", docsContent);

    // Ingest a "knowledge" file
    const knowledgeContent = "Knowledge about Docker container orchestration patterns.";
    const knowledgeHash = await hashContent(knowledgeContent);
    insertContent(db, knowledgeHash, knowledgeContent, now);
    insertDocument(db, "e2e-test", "/tmp/k-docker.md", "docker-knowledge", knowledgeHash, now, now, {
      source_type: "knowledge",
    });
    const knowledgeDocId = getDocumentId(db, "e2e-test", "/tmp/k-docker.md");
    await upsertFTS(db, knowledgeDocId!, "/tmp/k-docker.md", "docker-knowledge", knowledgeContent);

    // Search with source_type "docs" should only find the docs entry
    const docsResults = await searchFTS(db, "Docker", 10, undefined, "docs");
    expect(docsResults.length).toBe(1);
    expect(docsResults[0].title).toBe("deploy");

    // Search with source_type "knowledge" should only find the knowledge entry
    const knowledgeResults = await searchFTS(db, "Docker", 10, undefined, "knowledge");
    expect(knowledgeResults.length).toBe(1);
    expect(knowledgeResults[0].title).toBe("docker-knowledge");

    store.close();
  });
});

// ============================================================================
// 2. Extract → Search knowledge flow (with mock LLM)
// ============================================================================

describe("E2E: extract → search knowledge flow", () => {
  const testDir = tmpDir("extract-search");
  const vaultDir = join(testDir, "vault");
  const sessionsDir = join(testDir, "sessions");
  const dbPath = join(testDir, "test.sqlite");
  const statePath = join(vaultDir, ".state.json");

  beforeEach(() => {
    mkdirSync(sessionsDir, { recursive: true });
    mkdirSync(vaultDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should extract session, write to vault, and be searchable", async () => {
    // 1. Place fixture session file
    writeFileSync(
      join(sessionsDir, "e2e-session-001.jsonl"),
      SAMPLE_CLAUDE_SESSION,
    );

    // 2. Run extract pipeline with mock LLM
    const config = createConfig(vaultDir, sessionsDir);
    const stateManager = new StateManager(statePath);
    const store = createStore(dbPath);
    const vaultWriter = new VaultWriter(vaultDir);

    const deps: ExtractDeps = {
      config,
      stateManager,
      llmProvider: createMockProvider(),
      vaultWriter,
      store,
    };

    await processSession(join(sessionsDir, "e2e-session-001.jsonl"), deps);

    // 3. Verify vault/sessions/ has parsed markdown
    const sessionsVaultDir = join(vaultDir, "sessions");
    expect(existsSync(sessionsVaultDir)).toBe(true);

    // 4. Verify vault/knowledge/ has extracted knowledge
    const knowledgeVaultDir = join(vaultDir, "knowledge");
    expect(existsSync(knowledgeVaultDir)).toBe(true);

    // 5. Search with sourceType "sessions" should find indexed session
    const sessionResults = await searchFTS(
      store.db,
      "project structure",
      10,
      undefined,
      "sessions",
    );
    expect(sessionResults.length).toBeGreaterThan(0);

    // 6. Search with sourceType "knowledge" should find extracted knowledge
    const knowledgeResults = await searchFTS(
      store.db,
      "test summary",
      10,
      undefined,
      "knowledge",
    );
    expect(knowledgeResults.length).toBeGreaterThan(0);

    // 7. Verify state was updated
    const state = stateManager.load();
    expect(state.processedSessions).toContain("e2e-session-001");

    store.close();
  });

  it("should use fixture session file from tests/fixtures", async () => {
    // Use the real fixture file
    const fixtureDir = resolve("tests/fixtures/sessions");
    const fixturePath = join(fixtureDir, "claude-sample.jsonl");

    if (!existsSync(fixturePath)) {
      // Skip if fixture doesn't exist
      console.log("Skipping: fixture file not found");
      return;
    }

    const config = createConfig(vaultDir, fixtureDir);
    const stateManager = new StateManager(statePath);
    const store = createStore(dbPath);
    const vaultWriter = new VaultWriter(vaultDir);

    const deps: ExtractDeps = {
      config,
      stateManager,
      llmProvider: createMockProvider(),
      vaultWriter,
      store,
    };

    await processSession(fixturePath, deps);

    // The session should be in the vault and searchable
    const sessionsVaultDir = join(vaultDir, "sessions");
    expect(existsSync(sessionsVaultDir)).toBe(true);

    // State should record it as processed
    const state = stateManager.load();
    expect(state.processedSessions).toContain("claude-sample");

    store.close();
  });
});

// ============================================================================
// 3. Rebuild restores index from vault
// ============================================================================

describe("E2E: rebuild restores index from vault", () => {
  const testDir = tmpDir("rebuild");
  const vaultDir = join(testDir, "vault");
  const docsDir = join(vaultDir, "docs");
  const dbPath = join(testDir, "test.sqlite");

  beforeEach(() => {
    mkdirSync(docsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should rebuild index from vault files after DB is deleted", async () => {
    // 1. Ingest some documents into vault and index
    const docContent = `# Kubernetes Deployment

This guide covers deploying applications to Kubernetes clusters.
Use kubectl apply to deploy manifests.
`;
    writeFileSync(join(docsDir, "k8s-deploy.md"), docContent);

    const store1 = createStore(dbPath);
    const db1 = store1.db;
    const now = new Date().toISOString();
    const hash = await hashContent(docContent);
    insertContent(db1, hash, docContent, now);
    const k8sPath = join(docsDir, "k8s-deploy.md");
    insertDocument(db1, "hwicortex", k8sPath, "k8s-deploy", hash, now, now, {
      source_type: "docs",
    });
    const k8sDocId = getDocumentId(db1, "hwicortex", k8sPath);
    await upsertFTS(db1, k8sDocId!, k8sPath, "k8s-deploy", docContent);

    // Verify search works before
    const beforeResults = await searchFTS(db1, "Kubernetes deploy", 10, undefined, "docs");
    expect(beforeResults.length).toBeGreaterThan(0);
    store1.close();

    // 2. Delete the SQLite index
    unlinkSync(dbPath);
    expect(existsSync(dbPath)).toBe(false);

    // 3. Create fresh store (simulates rebuild)
    const store2 = createStore(dbPath);
    const db2 = store2.db;

    // 4. Re-index vault/docs/ (rebuild logic)
    const files = [join(docsDir, "k8s-deploy.md")];
    for (const filePath of files) {
      const content = readFileSync(filePath, "utf-8");
      const fileHash = await hashContent(content);
      const title = "k8s-deploy";
      const rebuildNow = new Date().toISOString();

      insertContent(db2, fileHash, content, rebuildNow);
      insertDocument(db2, "hwicortex", filePath, title, fileHash, rebuildNow, rebuildNow, {
        source_type: "docs",
      });
      const rebuildDocId = getDocumentId(db2, "hwicortex", filePath);
      await upsertFTS(db2, rebuildDocId!, filePath, title, content);
    }

    // 5. Search should work again
    const afterResults = await searchFTS(db2, "Kubernetes deploy", 10, undefined, "docs");
    expect(afterResults.length).toBeGreaterThan(0);
    expect(afterResults[0].title).toBe("k8s-deploy");

    store2.close();
  });

  it("should rebuild index including sessions and knowledge", async () => {
    // Create vault structure with all three types
    const sessionsDir = join(vaultDir, "sessions", "myproject");
    const knowledgeDir = join(vaultDir, "knowledge", "myproject");
    mkdirSync(sessionsDir, { recursive: true });
    mkdirSync(knowledgeDir, { recursive: true });

    writeFileSync(
      join(docsDir, "api-reference.md"),
      "# API Reference\nEndpoints for the REST API.",
    );
    writeFileSync(
      join(sessionsDir, "session-rebuild.md"),
      "# Session\nDiscussed API design patterns.",
    );
    writeFileSync(
      join(knowledgeDir, "api-patterns.md"),
      "# API Patterns\nRESTful API design best practices.",
    );

    // Simulate rebuild: create fresh store and re-index all vault dirs
    const store = createStore(dbPath);
    const db = store.db;

    async function indexDir(dir: string, sourceType: string) {
      if (!existsSync(dir)) return;
      const { readdirSync } = await import("node:fs");
      const { join: pJoin, basename: pBasename } = await import("node:path");

      function walkSync(d: string): string[] {
        const entries = readdirSync(d, { withFileTypes: true });
        const result: string[] = [];
        for (const e of entries) {
          const full = pJoin(d, e.name);
          if (e.isDirectory()) result.push(...walkSync(full));
          else if (e.name.endsWith(".md")) result.push(full);
        }
        return result;
      }

      const files = walkSync(dir);
      for (const filePath of files) {
        const content = readFileSync(filePath, "utf-8");
        const h = await hashContent(content);
        const title = pBasename(filePath, ".md");
        const now = new Date().toISOString();
        insertContent(db, h, content, now);
        insertDocument(db, "hwicortex", filePath, title, h, now, now, {
          source_type: sourceType,
        });
        const idxDocId = getDocumentId(db, "hwicortex", filePath);
        await upsertFTS(db, idxDocId!, filePath, title, content);
      }
    }

    await indexDir(docsDir, "docs");
    await indexDir(join(vaultDir, "sessions"), "sessions");
    await indexDir(join(vaultDir, "knowledge"), "knowledge");

    // Verify all three types are searchable
    const docsResults = await searchFTS(db, "API", 10, undefined, "docs");
    expect(docsResults.length).toBeGreaterThan(0);

    const sessionResults = await searchFTS(db, "API", 10, undefined, "sessions");
    expect(sessionResults.length).toBeGreaterThan(0);

    const knowledgeResults = await searchFTS(db, "API", 10, undefined, "knowledge");
    expect(knowledgeResults.length).toBeGreaterThan(0);

    store.close();
  });
});

// ============================================================================
// 4. Extract handles failures gracefully
// ============================================================================

describe("E2E: extract handles failures gracefully", () => {
  const testDir = tmpDir("extract-failures");
  const vaultDir = join(testDir, "vault");
  const sessionsDir = join(testDir, "sessions");
  const dbPath = join(testDir, "test.sqlite");
  const statePath = join(vaultDir, ".state.json");

  beforeEach(() => {
    mkdirSync(sessionsDir, { recursive: true });
    mkdirSync(vaultDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should process valid session and handle LLM failure gracefully", async () => {
    // 1. Place 1 valid session + 1 session that triggers LLM failure
    writeFileSync(
      join(sessionsDir, "valid-session.jsonl"),
      SAMPLE_CLAUDE_SESSION,
    );
    const failSessionContent = [
      JSON.stringify({
        type: "user",
        message: { role: "user", content: "TRIGGER_ERROR" },
        timestamp: "2026-03-15T10:00:00.000Z",
        sessionId: "err-session",
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Response" }],
        },
        timestamp: "2026-03-15T10:00:01.000Z",
        sessionId: "err-session",
      }),
    ].join("\n");
    writeFileSync(
      join(sessionsDir, "err-session.jsonl"),
      failSessionContent,
    );

    const config = createConfig(vaultDir, sessionsDir);
    const stateManager = new StateManager(statePath);
    const store = createStore(dbPath);
    const vaultWriter = new VaultWriter(vaultDir);

    // LLM provider that fails for sessions containing "TRIGGER_ERROR"
    const failingProvider: LlmProvider = {
      name: "failing-mock",
      complete: async (prompt: string) => {
        if (prompt.includes("TRIGGER_ERROR")) {
          throw new Error("Simulated LLM API failure");
        }
        return MOCK_KNOWLEDGE_RESPONSE;
      },
      estimateTokens: (text: string) => Math.ceil(text.length / 4),
    };

    const deps: ExtractDeps = {
      config,
      stateManager,
      llmProvider: failingProvider,
      vaultWriter,
      store,
    };

    // 2. Process valid session — should succeed
    await processSession(join(sessionsDir, "valid-session.jsonl"), deps);

    // 3. Process error session — should throw
    let errorOccurred = false;
    try {
      await processSession(join(sessionsDir, "err-session.jsonl"), deps);
    } catch (err) {
      errorOccurred = true;
      // Record failure like the CLI does
      stateManager.addToFailedQueue(
        "err-session",
        err instanceof Error ? err.message : String(err),
      );
    }
    expect(errorOccurred).toBe(true);

    // 4. Valid one should be marked as processed
    const state = stateManager.load();
    expect(state.processedSessions).toContain("valid-session");

    // 5. Error session should be in failed queue
    expect(state.failedQueue.length).toBeGreaterThan(0);
    const failedEntry = state.failedQueue.find(
      (f) => f.sessionId === "err-session",
    );
    expect(failedEntry).toBeDefined();
    expect(failedEntry!.error).toContain("Simulated LLM API failure");

    store.close();
  });

  it("should continue processing after encountering a failure", async () => {
    // Place a valid session and simulate a failure via a flaky LLM provider.
    // The CLI loop should process files that succeed and record failures for
    // files where the LLM throws an error.
    writeFileSync(
      join(sessionsDir, "session-ok.jsonl"),
      SAMPLE_CLAUDE_SESSION,
    );
    // This session is valid JSONL but we'll make the LLM provider fail for it
    const badSessionContent = [
      JSON.stringify({
        type: "user",
        message: { role: "user", content: "FAIL_THIS_SESSION" },
        timestamp: "2026-03-16T10:00:00.000Z",
        sessionId: "session-fail",
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "This will fail during extraction" }],
        },
        timestamp: "2026-03-16T10:00:01.000Z",
        sessionId: "session-fail",
      }),
    ].join("\n");
    writeFileSync(
      join(sessionsDir, "session-fail.jsonl"),
      badSessionContent,
    );

    const config = createConfig(vaultDir, sessionsDir);
    const stateManager = new StateManager(statePath);
    const store = createStore(dbPath);
    const vaultWriter = new VaultWriter(vaultDir);

    // Create an LLM provider that fails for the "FAIL_THIS_SESSION" content
    let callCount = 0;
    const flakyProvider: LlmProvider = {
      name: "flaky-mock",
      complete: async (prompt: string) => {
        callCount++;
        if (prompt.includes("FAIL_THIS_SESSION")) {
          throw new Error("LLM API error: simulated failure");
        }
        return MOCK_KNOWLEDGE_RESPONSE;
      },
      estimateTokens: (text: string) => Math.ceil(text.length / 4),
    };

    const deps: ExtractDeps = {
      config,
      stateManager,
      llmProvider: flakyProvider,
      vaultWriter,
      store,
    };

    // Simulate the CLI loop: process all discovered files, handling errors
    const allFiles = discoverSessionFiles([sessionsDir]);
    expect(allFiles.length).toBe(2);

    let processed = 0;
    let failures = 0;

    for (const filePath of allFiles) {
      const sessionId = filePath.replace(/.*\//, "").replace(".jsonl", "");
      try {
        await processSession(filePath, deps);
        processed++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        stateManager.addToFailedQueue(sessionId, msg);
        failures++;
      }
    }

    // One should succeed, one should fail
    expect(processed).toBe(1);
    expect(failures).toBe(1);

    // State should reflect: valid session processed, failed session in failed queue
    const state = stateManager.load();
    expect(state.processedSessions).toContain("session-ok");
    expect(state.failedQueue.some((f) => f.sessionId === "session-fail")).toBe(
      true,
    );
    // The error message should be preserved
    const failedEntry = state.failedQueue.find(
      (f) => f.sessionId === "session-fail",
    );
    expect(failedEntry!.error).toContain("simulated failure");

    store.close();
  });

  it("should persist failure state to .state.json file", async () => {
    const stateManager = new StateManager(statePath);

    stateManager.addToFailedQueue("fail-session", "Parse error: invalid JSON");

    // Verify the state file was written to disk
    expect(existsSync(statePath)).toBe(true);

    const raw = readFileSync(statePath, "utf-8");
    const persisted = JSON.parse(raw);
    expect(persisted.failedQueue).toHaveLength(1);
    expect(persisted.failedQueue[0].sessionId).toBe("fail-session");
    expect(persisted.failedQueue[0].error).toBe("Parse error: invalid JSON");
  });
});
