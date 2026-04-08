import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { atomicWrite } from "../src/knowledge/vault-writer.js";
import { toWikiSlug, buildFrontmatter, parseFrontmatter, createWikiPage, getWikiPage, listWikiPages, updateWikiPage, removeWikiPage } from "../src/wiki.js";

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

describe("Wiki CRUD", () => {
  let vaultDir: string;

  beforeEach(() => {
    vaultDir = mkdtempSync(join(tmpdir(), "wiki-crud-"));
  });

  afterEach(() => {
    if (vaultDir && existsSync(vaultDir)) rmSync(vaultDir, { recursive: true });
  });

  test("createWikiPage writes file with frontmatter + body", () => {
    const filePath = createWikiPage(vaultDir, {
      title: "JWT 인증",
      project: "myapp",
      tags: ["auth"],
      sources: [],
      body: "토큰 만료 7일",
    });
    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("title: JWT 인증");
    expect(content).toContain("토큰 만료 7일");
  });

  test("createWikiPage errors on duplicate title", () => {
    createWikiPage(vaultDir, { title: "Dup", project: "p" });
    expect(() => createWikiPage(vaultDir, { title: "Dup", project: "p" }))
      .toThrow(/already exists/);
  });

  test("getWikiPage returns meta and body", () => {
    createWikiPage(vaultDir, { title: "Get Test", project: "p", body: "hello" });
    const page = getWikiPage(vaultDir, "Get Test", "p");
    expect(page.meta.title).toBe("Get Test");
    expect(page.body.trim()).toBe("hello");
  });

  test("listWikiPages filters by project and tag", () => {
    createWikiPage(vaultDir, { title: "A", project: "p1", tags: ["x"] });
    createWikiPage(vaultDir, { title: "B", project: "p1", tags: ["y"] });
    createWikiPage(vaultDir, { title: "C", project: "p2", tags: ["x"] });

    expect(listWikiPages(vaultDir).length).toBe(3);
    expect(listWikiPages(vaultDir, { project: "p1" }).length).toBe(2);
    expect(listWikiPages(vaultDir, { tag: "x" }).length).toBe(2);
    expect(listWikiPages(vaultDir, { project: "p1", tag: "x" }).length).toBe(1);
  });

  test("updateWikiPage appends text", () => {
    createWikiPage(vaultDir, { title: "Upd", project: "p", body: "line1" });
    updateWikiPage(vaultDir, "Upd", "p", { append: "line2" });
    const page = getWikiPage(vaultDir, "Upd", "p");
    expect(page.body).toContain("line1");
    expect(page.body).toContain("line2");
  });

  test("updateWikiPage replaces body", () => {
    createWikiPage(vaultDir, { title: "Rep", project: "p", body: "old" });
    updateWikiPage(vaultDir, "Rep", "p", { body: "new" });
    const page = getWikiPage(vaultDir, "Rep", "p");
    expect(page.body.trim()).toBe("new");
    expect(page.body).not.toContain("old");
  });

  test("updateWikiPage updates tags", () => {
    createWikiPage(vaultDir, { title: "Tag", project: "p", tags: ["a"] });
    updateWikiPage(vaultDir, "Tag", "p", { tags: ["a", "b", "c"] });
    const page = getWikiPage(vaultDir, "Tag", "p");
    expect(page.meta.tags).toEqual(["a", "b", "c"]);
  });

  test("updateWikiPage adds source", () => {
    createWikiPage(vaultDir, { title: "Src", project: "p", sources: ["s1"] });
    updateWikiPage(vaultDir, "Src", "p", { addSource: "s2" });
    const page = getWikiPage(vaultDir, "Src", "p");
    expect(page.meta.sources).toEqual(["s1", "s2"]);
  });

  test("removeWikiPage deletes file", () => {
    const fp = createWikiPage(vaultDir, { title: "Del", project: "p" });
    expect(existsSync(fp)).toBe(true);
    removeWikiPage(vaultDir, "Del", "p");
    expect(existsSync(fp)).toBe(false);
  });
});
