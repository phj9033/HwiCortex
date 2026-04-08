import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { atomicWrite } from "../src/knowledge/vault-writer.js";

describe("atomicWrite", () => {
  let testDir: string;

  afterEach(() => {
    if (testDir && existsSync(testDir)) rmSync(testDir, { recursive: true });
  });

  test("writes file atomically with no leftover .tmp", () => {
    testDir = mkdtempSync(join(tmpdir(), "wiki-test-"));
    const filePath = join(testDir, "sub", "test.md");
    atomicWrite(filePath, "hello world");
    expect(readFileSync(filePath, "utf-8")).toBe("hello world");
    expect(existsSync(filePath + ".tmp")).toBe(false);
  });

  test("creates parent directories if missing", () => {
    testDir = mkdtempSync(join(tmpdir(), "wiki-test-"));
    const filePath = join(testDir, "a", "b", "c", "deep.md");
    atomicWrite(filePath, "deep file");
    expect(readFileSync(filePath, "utf-8")).toBe("deep file");
  });
});
