import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { StateManager } from "../../src/state/state-manager.js";
import type { AppState } from "../../src/state/state-manager.js";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("StateManager", () => {
  let tmpDir: string;
  let statePath: string;
  let manager: StateManager;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "state-manager-test-"));
    statePath = join(tmpDir, "state.json");
    manager = new StateManager(statePath);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should initialize empty state file", () => {
    const state = manager.load();
    expect(state.lastProcessedAt).toBeNull();
    expect(state.processedSessions).toEqual([]);
    expect(state.failedQueue).toEqual([]);
    expect(state.watcherRunning).toBe(false);
  });

  it("should record last processed session", () => {
    const timestamp = "2026-04-07T10:00:00Z";
    manager.markProcessed("session-1", timestamp);

    const state = manager.load();
    expect(state.processedSessions).toContain("session-1");
    expect(state.lastProcessedAt).toBe(timestamp);
  });

  it("should add to failed queue", () => {
    manager.addToFailedQueue("session-2", "timeout error");

    const state = manager.load();
    expect(state.failedQueue).toHaveLength(1);
    expect(state.failedQueue[0]!.sessionId).toBe("session-2");
    expect(state.failedQueue[0]!.error).toBe("timeout error");
    expect(state.failedQueue[0]!.failedAt).toBeDefined();
  });

  it("should remove from failed queue after retry success", () => {
    manager.addToFailedQueue("session-3", "network error");
    let state = manager.load();
    expect(state.failedQueue).toHaveLength(1);

    manager.markProcessed("session-3", "2026-04-07T12:00:00Z");
    state = manager.load();
    expect(state.failedQueue).toHaveLength(0);
    expect(state.processedSessions).toContain("session-3");
  });

  it("should return unprocessed sessions from a list", () => {
    manager.markProcessed("session-a", "2026-04-07T10:00:00Z");
    manager.markProcessed("session-b", "2026-04-07T10:01:00Z");

    const unprocessed = manager.filterUnprocessed([
      "session-a",
      "session-b",
      "session-c",
      "session-d",
    ]);
    expect(unprocessed).toEqual(["session-c", "session-d"]);
  });

  it("should persist state across reloads", () => {
    manager.markProcessed("session-x", "2026-04-07T09:00:00Z");
    manager.addToFailedQueue("session-y", "parse error");

    // Create a new manager instance pointing to the same file
    const manager2 = new StateManager(statePath);
    const state = manager2.load();

    expect(state.processedSessions).toContain("session-x");
    expect(state.lastProcessedAt).toBe("2026-04-07T09:00:00Z");
    expect(state.failedQueue).toHaveLength(1);
    expect(state.failedQueue[0]!.sessionId).toBe("session-y");
  });
});
