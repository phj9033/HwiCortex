import { describe, it, expect, afterEach, beforeEach } from "bun:test";
import { SessionWatcher } from "../../src/ingest/watcher.js";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("SessionWatcher", () => {
  let watcher: SessionWatcher;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "watcher-test-"));
  });

  afterEach(async () => {
    if (watcher) {
      watcher.stop();
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should detect new file in watch directory", async () => {
    const detected: string[] = [];

    watcher = new SessionWatcher({
      watchDirs: [tempDir],
      idleTimeoutMs: 300,
      patterns: ["**/*.jsonl"],
    });

    watcher.on("session-ready", (filePath: string) => {
      detected.push(filePath);
    });

    watcher.start();
    // Give chokidar time to initialize
    await sleep(200);

    const testFile = join(tempDir, "session1.jsonl");
    await writeFile(testFile, '{"type":"init"}\n');

    // Wait for idle timeout + buffer
    await sleep(600);

    expect(detected.length).toBe(1);
    expect(detected[0]).toBe(testFile);
  });

  it("should not trigger while file is still being written", async () => {
    const detected: string[] = [];

    watcher = new SessionWatcher({
      watchDirs: [tempDir],
      idleTimeoutMs: 400,
      patterns: ["**/*.jsonl"],
    });

    watcher.on("session-ready", (filePath: string) => {
      detected.push(filePath);
    });

    watcher.start();
    await sleep(200);

    const testFile = join(tempDir, "session2.jsonl");

    // Write multiple times with intervals shorter than idle timeout
    await writeFile(testFile, '{"type":"init"}\n');
    await sleep(150);
    await writeFile(testFile, '{"type":"init"}\n{"type":"msg"}\n');
    await sleep(150);
    await writeFile(testFile, '{"type":"init"}\n{"type":"msg"}\n{"type":"end"}\n');

    // At this point ~300ms have passed since last write, still less than 400ms idle
    expect(detected.length).toBe(0);

    // Now wait for idle timeout to fire
    await sleep(500);
    expect(detected.length).toBe(1);
  });

  it("should emit session-ready after idle timeout", async () => {
    const detected: string[] = [];

    watcher = new SessionWatcher({
      watchDirs: [tempDir],
      idleTimeoutMs: 250,
      patterns: ["**/*.jsonl"],
    });

    watcher.on("session-ready", (filePath: string) => {
      detected.push(filePath);
    });

    watcher.start();
    await sleep(200);

    // Create two different files
    const file1 = join(tempDir, "a.jsonl");
    const file2 = join(tempDir, "b.jsonl");
    await writeFile(file1, '{"data":1}\n');
    await writeFile(file2, '{"data":2}\n');

    // Wait for both to become idle
    await sleep(500);

    expect(detected.length).toBe(2);
    expect(detected).toContain(file1);
    expect(detected).toContain(file2);
  });

  it("should stop cleanly", async () => {
    const detected: string[] = [];

    watcher = new SessionWatcher({
      watchDirs: [tempDir],
      idleTimeoutMs: 200,
      patterns: ["**/*.jsonl"],
    });

    watcher.on("session-ready", (filePath: string) => {
      detected.push(filePath);
    });

    watcher.start();
    await sleep(200);

    const testFile = join(tempDir, "session3.jsonl");
    await writeFile(testFile, '{"type":"init"}\n');
    await sleep(50);

    // Stop before idle timeout fires
    watcher.stop();

    // Wait past the would-be idle timeout
    await sleep(400);

    // Should not have fired because watcher was stopped
    expect(detected.length).toBe(0);
  });
});
