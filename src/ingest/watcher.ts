import { EventEmitter } from "node:events";
import { basename } from "node:path";
import chokidar from "chokidar";
import type { FSWatcher } from "chokidar";

export interface WatcherOptions {
  watchDirs: string[];
  idleTimeoutMs: number; // default 600000 (10 minutes)
  patterns?: string[]; // default ["**/*.jsonl"]
}

// Convert glob patterns (e.g. "*.jsonl") to a file-path matcher
function buildMatcher(patterns: string[]): (filePath: string) => boolean {
  // Extract extensions from simple glob patterns (e.g. "**/*.jsonl" -> ".jsonl")
  const extensions = patterns
    .map((p) => {
      const m = p.match(/\*\.(\w+)$/);
      return m ? `.${m[1]}` : null;
    })
    .filter((e): e is string => e !== null);

  if (extensions.length === 0) {
    // If no recognizable patterns, accept everything
    return () => true;
  }

  return (filePath: string) =>
    extensions.some((ext) => basename(filePath).endsWith(ext));
}

/**
 * Watches session directories for new/changed files and emits "session-ready"
 * once a file has been idle (no writes) for the configured timeout.
 *
 * Events:
 *   "session-ready" (filePath: string) — file has been idle for idleTimeoutMs
 *   "error" (error: Error) — watcher error
 */
export class SessionWatcher extends EventEmitter {
  private watchers: FSWatcher[] = [];
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private stopped = false;
  private matchesPattern: (filePath: string) => boolean;

  constructor(private options: WatcherOptions) {
    super();
    this.matchesPattern = buildMatcher(options.patterns ?? ["**/*.jsonl"]);
  }

  start(): void {
    this.stopped = false;

    for (const dir of this.options.watchDirs) {
      const watcher = chokidar.watch(dir, {
        ignoreInitial: false,
        persistent: true,
        awaitWriteFinish: false,
      });

      watcher.on("add", (filePath: string) => this.handleFileEvent(filePath));
      watcher.on("change", (filePath: string) =>
        this.handleFileEvent(filePath),
      );
      watcher.on("error", (error: Error) => this.emit("error", error));

      this.watchers.push(watcher);
    }
  }

  stop(): void {
    this.stopped = true;

    // Clear all idle timers
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();

    // Close all chokidar watchers
    for (const watcher of this.watchers) {
      void watcher.close();
    }
    this.watchers = [];
  }

  private handleFileEvent(filePath: string): void {
    if (this.stopped) return;
    if (!this.matchesPattern(filePath)) return;

    // Clear existing timer for this file
    const existing = this.timers.get(filePath);
    if (existing) {
      clearTimeout(existing);
    }

    // Set new idle timer
    const timer = setTimeout(() => {
      if (this.stopped) return;
      this.timers.delete(filePath);
      this.emit("session-ready", filePath);
    }, this.options.idleTimeoutMs);

    this.timers.set(filePath, timer);
  }
}
