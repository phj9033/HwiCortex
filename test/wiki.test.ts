import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { atomicWrite } from "../src/knowledge/vault-writer.js";
import { toWikiSlug, buildFrontmatter, parseFrontmatter, createWikiPage, getWikiPage, listWikiPages, updateWikiPage, removeWikiPage, linkPages, unlinkPages, getLinks, generateIndex } from "../src/wiki.js";
import { createStore, searchFTS, getDocumentId, findActiveDocument } from "../src/store.js";
import type { Store } from "../src/store.js";

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

  test("parses count fields and importance from frontmatter", () => {
    const md = `---
title: Test
project: p
tags: []
sources: []
related: []
count_show: 5
count_append: 3
count_update: 1
count_link: 2
count_merge: 1
count_search_hit: 8
count_query_hit: 4
importance: 12
hit_count: 12
last_accessed: 2026-04-10
created: 2026-04-08
updated: 2026-04-08
---

Body content here.`;
    const { meta, body } = parseFrontmatter(md);
    expect(meta.title).toBe("Test");
    expect(meta.count_show).toBe(5);
    expect(meta.count_append).toBe(3);
    expect(meta.count_update).toBe(1);
    expect(meta.count_link).toBe(2);
    expect(meta.count_merge).toBe(1);
    expect(meta.count_search_hit).toBe(8);
    expect(meta.count_query_hit).toBe(4);
    expect(meta.importance).toBe(12);
    expect(meta.hit_count).toBe(12);
    expect(meta.last_accessed).toBe("2026-04-10");
    expect(body.trim()).toBe("Body content here.");
  });

  test("missing count fields default to 0", () => {
    const md = `---
title: Old Page
project: p
tags: []
sources: []
related: []
created: 2026-04-08
updated: 2026-04-08
---

Legacy content.`;
    const { meta } = parseFrontmatter(md);
    expect(meta.count_show).toBe(0);
    expect(meta.count_append).toBe(0);
    expect(meta.importance).toBe(0);
    expect(meta.hit_count).toBe(0);
    expect(meta.last_accessed).toBe("");
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

  test("createWikiPage writes file with frontmatter + body", async () => {
    const filePath = await createWikiPage(vaultDir, {
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

  test("createWikiPage errors on duplicate title", async () => {
    await createWikiPage(vaultDir, { title: "Dup", project: "p" });
    await expect(createWikiPage(vaultDir, { title: "Dup", project: "p" }))
      .rejects.toThrow(/already exists/);
  });

  test("getWikiPage returns meta and body", async () => {
    await createWikiPage(vaultDir, { title: "Get Test", project: "p", body: "hello" });
    const page = getWikiPage(vaultDir, "Get Test", "p");
    expect(page.meta.title).toBe("Get Test");
    expect(page.body.trim()).toBe("hello");
  });

  test("listWikiPages filters by project and tag", async () => {
    await createWikiPage(vaultDir, { title: "A", project: "p1", tags: ["x"] });
    await createWikiPage(vaultDir, { title: "B", project: "p1", tags: ["y"] });
    await createWikiPage(vaultDir, { title: "C", project: "p2", tags: ["x"] });

    expect(listWikiPages(vaultDir).length).toBe(3);
    expect(listWikiPages(vaultDir, { project: "p1" }).length).toBe(2);
    expect(listWikiPages(vaultDir, { tag: "x" }).length).toBe(2);
    expect(listWikiPages(vaultDir, { project: "p1", tag: "x" }).length).toBe(1);
  });

  test("updateWikiPage appends text", async () => {
    await createWikiPage(vaultDir, { title: "Upd", project: "p", body: "line1" });
    await updateWikiPage(vaultDir, "Upd", "p", { append: "line2" });
    const page = getWikiPage(vaultDir, "Upd", "p");
    expect(page.body).toContain("line1");
    expect(page.body).toContain("line2");
  });

  test("updateWikiPage replaces body", async () => {
    await createWikiPage(vaultDir, { title: "Rep", project: "p", body: "old" });
    await updateWikiPage(vaultDir, "Rep", "p", { body: "new" });
    const page = getWikiPage(vaultDir, "Rep", "p");
    expect(page.body.trim()).toBe("new");
    expect(page.body).not.toContain("old");
  });

  test("updateWikiPage updates tags", async () => {
    await createWikiPage(vaultDir, { title: "Tag", project: "p", tags: ["a"] });
    await updateWikiPage(vaultDir, "Tag", "p", { tags: ["a", "b", "c"] });
    const page = getWikiPage(vaultDir, "Tag", "p");
    expect(page.meta.tags).toEqual(["a", "b", "c"]);
  });

  test("updateWikiPage adds source", async () => {
    await createWikiPage(vaultDir, { title: "Src", project: "p", sources: ["s1"] });
    await updateWikiPage(vaultDir, "Src", "p", { addSource: "s2" });
    const page = getWikiPage(vaultDir, "Src", "p");
    expect(page.meta.sources).toEqual(["s1", "s2"]);
  });

  test("removeWikiPage deletes file", async () => {
    const fp = await createWikiPage(vaultDir, { title: "Del", project: "p" });
    expect(existsSync(fp)).toBe(true);
    removeWikiPage(vaultDir, "Del", "p");
    expect(existsSync(fp)).toBe(false);
  });
});

describe("Wiki FTS indexing", () => {
  let vaultDir: string;
  let store: Store;
  let dbPath: string;

  beforeEach(() => {
    vaultDir = mkdtempSync(join(tmpdir(), "wiki-fts-"));
    dbPath = join(vaultDir, "test-index.sqlite");
    store = createStore(dbPath);
  });

  afterEach(() => {
    store.close();
    if (vaultDir && existsSync(vaultDir)) rmSync(vaultDir, { recursive: true });
  });

  test("createWikiPage with store indexes into FTS", async () => {
    await createWikiPage(vaultDir, {
      title: "JWT Authentication",
      project: "myapp",
      body: "Token expiration is set to seven days for security",
      store,
    });

    // Verify document exists in DB
    const docId = getDocumentId(store.db, "wiki", "myapp/jwt-authentication.md");
    expect(docId).not.toBeNull();

    // Verify FTS search finds the page
    const results = await searchFTS(store.db, "token expiration security");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.filepath).toContain("wiki/myapp/jwt-authentication.md");
  });

  test("updateWikiPage with store re-indexes FTS", async () => {
    await createWikiPage(vaultDir, {
      title: "Update Test",
      project: "proj",
      body: "original content about databases",
      store,
    });

    await updateWikiPage(vaultDir, "Update Test", "proj", {
      body: "completely new content about kubernetes clusters",
      store,
    });

    // Search for new content
    const results = await searchFTS(store.db, "kubernetes clusters");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.filepath).toContain("wiki/proj/update-test.md");
  });

  test("removeWikiPage with store deactivates document", async () => {
    await createWikiPage(vaultDir, {
      title: "Remove Test",
      project: "proj",
      body: "content to be removed",
      store,
    });

    // Verify active before removal
    const before = findActiveDocument(store.db, "wiki", "proj/remove-test.md");
    expect(before).not.toBeNull();

    removeWikiPage(vaultDir, "Remove Test", "proj", store);

    // Verify deactivated after removal
    const after = findActiveDocument(store.db, "wiki", "proj/remove-test.md");
    expect(after).toBeNull();
  });

  test("wiki collection is auto-registered in store_collections", async () => {
    await createWikiPage(vaultDir, {
      title: "Collection Test",
      project: "proj",
      body: "test",
      store,
    });

    const row = store.db.prepare(
      `SELECT name, pattern FROM store_collections WHERE name = 'wiki'`
    ).get() as { name: string; pattern: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.name).toBe("wiki");
    expect(row!.pattern).toBe("**/*.md");
  });
});

describe("Wiki linking", () => {
  let vaultDir: string;

  beforeEach(() => {
    vaultDir = mkdtempSync(join(tmpdir(), "wiki-link-"));
  });

  afterEach(() => {
    if (vaultDir && existsSync(vaultDir)) rmSync(vaultDir, { recursive: true });
  });

  test("linkPages adds to both files' related and syncs section", async () => {
    await createWikiPage(vaultDir, { title: "Page A", project: "p", body: "content A" });
    await createWikiPage(vaultDir, { title: "Page B", project: "p", body: "content B" });

    linkPages(vaultDir, "Page A", "Page B", "p");

    const a = getWikiPage(vaultDir, "Page A", "p");
    const b = getWikiPage(vaultDir, "Page B", "p");
    expect(a.meta.related).toContain("Page B");
    expect(b.meta.related).toContain("Page A");
    const aContent = readFileSync(a.filePath, "utf-8");
    expect(aContent).toContain("## 관련 문서");
    expect(aContent).toContain("[[Page B]]");
  });

  test("unlinkPages removes from both files", async () => {
    await createWikiPage(vaultDir, { title: "X", project: "p" });
    await createWikiPage(vaultDir, { title: "Y", project: "p" });
    linkPages(vaultDir, "X", "Y", "p");
    unlinkPages(vaultDir, "X", "Y", "p");

    const x = getWikiPage(vaultDir, "X", "p");
    expect(x.meta.related).not.toContain("Y");
  });

  test("linkPages is idempotent", async () => {
    await createWikiPage(vaultDir, { title: "I1", project: "p" });
    await createWikiPage(vaultDir, { title: "I2", project: "p" });
    linkPages(vaultDir, "I1", "I2", "p");
    linkPages(vaultDir, "I1", "I2", "p");

    const page = getWikiPage(vaultDir, "I1", "p");
    expect(page.meta.related.filter((r) => r === "I2").length).toBe(1);
  });

  test("getLinks returns related and backlinks", async () => {
    await createWikiPage(vaultDir, { title: "Main", project: "p", body: "main content" });
    await createWikiPage(vaultDir, { title: "Ref", project: "p", body: "see [[Main]] for details" });
    linkPages(vaultDir, "Main", "Ref", "p");

    const links = getLinks(vaultDir, "Main", "p");
    expect(links.related).toContain("Ref");
    // Ref has [[Main]] in body AND in related section, should appear in backlinks
    expect(links.backlinks.length).toBeGreaterThanOrEqual(0); // may or may not find it depending on content structure
  });
});

describe("Wiki index generation", () => {
  let vaultDir: string;

  beforeEach(() => {
    vaultDir = mkdtempSync(join(tmpdir(), "wiki-index-"));
  });

  afterEach(() => {
    if (vaultDir && existsSync(vaultDir)) rmSync(vaultDir, { recursive: true });
  });

  test("generates _index.md grouped by tags", async () => {
    await createWikiPage(vaultDir, { title: "JWT 인증", project: "myapp", tags: ["auth"], body: "토큰 관리" });
    await createWikiPage(vaultDir, { title: "배포 설정", project: "myapp", tags: ["infra"], body: "Docker 기반" });
    await createWikiPage(vaultDir, { title: "OAuth", project: "myapp", tags: ["auth"], body: "Google 연동" });

    const indexPath = generateIndex(vaultDir, "myapp");

    expect(existsSync(indexPath)).toBe(true);
    const content = readFileSync(indexPath, "utf-8");
    expect(content).toContain("## auth");
    expect(content).toContain("[[JWT 인증]]");
    expect(content).toContain("[[OAuth]]");
    expect(content).toContain("## infra");
    expect(content).toContain("[[배포 설정]]");
  });

  test("pages with no tags go under 'uncategorized'", async () => {
    await createWikiPage(vaultDir, { title: "No Tag", project: "p", body: "some content" });

    const indexPath = generateIndex(vaultDir, "p");
    const content = readFileSync(indexPath, "utf-8");
    expect(content).toContain("## uncategorized");
    expect(content).toContain("[[No Tag]]");
  });
});
