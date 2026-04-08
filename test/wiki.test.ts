import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { atomicWrite } from "../src/knowledge/vault-writer.js";
import { toWikiSlug, buildFrontmatter, parseFrontmatter } from "../src/wiki.js";

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

describe("toWikiSlug", () => {
  test("converts title to kebab-case preserving Korean", () => {
    expect(toWikiSlug("JWT 인증 흐름")).toBe("jwt-인증-흐름");
  });

  test("removes special characters", () => {
    expect(toWikiSlug("Hello World! #1")).toBe("hello-world-1");
  });

  test("collapses multiple hyphens", () => {
    expect(toWikiSlug("a  --  b")).toBe("a-b");
  });
});

describe("buildFrontmatter", () => {
  test("builds YAML frontmatter string", () => {
    const fm = buildFrontmatter({
      title: "JWT 인증",
      project: "myapp",
      tags: ["auth", "jwt"],
      sources: ["session-abc"],
      related: [],
    });
    expect(fm).toContain("title: JWT 인증");
    expect(fm).toContain("project: myapp");
    expect(fm).toContain("tags: [auth, jwt]");
    expect(fm).toContain("sources: [session-abc]");
    expect(fm).toContain("related: []");
    expect(fm).toContain("created:");
    expect(fm).toContain("updated:");
    expect(fm).toMatch(/^---\n/);
    expect(fm).toMatch(/\n---$/);
  });
});

describe("parseFrontmatter", () => {
  test("parses frontmatter and body from markdown", () => {
    const md = `---
title: Test
project: p
tags: [a, b]
sources: []
related: []
created: 2026-04-08
updated: 2026-04-08
---

Body content here.`;
    const { meta, body } = parseFrontmatter(md);
    expect(meta.title).toBe("Test");
    expect(meta.tags).toEqual(["a", "b"]);
    expect(body.trim()).toBe("Body content here.");
  });
});
