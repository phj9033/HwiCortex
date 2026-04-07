import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface AppState {
  lastProcessedAt: string | null;
  processedSessions: string[];
  failedQueue: Array<{ sessionId: string; error: string; failedAt: string }>;
  watcherRunning: boolean;
}

function initialState(): AppState {
  return {
    lastProcessedAt: null,
    processedSessions: [],
    failedQueue: [],
    watcherRunning: false,
  };
}

export class StateManager {
  constructor(private statePath: string) {}

  load(): AppState {
    try {
      const raw = readFileSync(this.statePath, "utf-8");
      return JSON.parse(raw) as AppState;
    } catch {
      return initialState();
    }
  }

  save(state: AppState): void {
    const dir = dirname(this.statePath);
    mkdirSync(dir, { recursive: true });
    const tmpPath = `${this.statePath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(state, null, 2), "utf-8");
    renameSync(tmpPath, this.statePath);
  }

  markProcessed(sessionId: string, timestamp: string): void {
    const state = this.load();
    if (!state.processedSessions.includes(sessionId)) {
      state.processedSessions.push(sessionId);
    }
    state.lastProcessedAt = timestamp;
    // Remove from failed queue if present
    state.failedQueue = state.failedQueue.filter(
      (entry) => entry.sessionId !== sessionId,
    );
    this.save(state);
  }

  addToFailedQueue(sessionId: string, error: string): void {
    const state = this.load();
    state.failedQueue.push({
      sessionId,
      error,
      failedAt: new Date().toISOString(),
    });
    this.save(state);
  }

  filterUnprocessed(sessionIds: string[]): string[] {
    const state = this.load();
    const processed = new Set(state.processedSessions);
    return sessionIds.filter((id) => !processed.has(id));
  }
}
