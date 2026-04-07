import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { openDatabase } from "../src/db.js";
import type { Database } from "../src/db.js";
import { execSync } from "child_process";
import { unlink, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import {
  createStore,
  hashContent,
  getKoreanTokenizerState,
  setKoreanTokenizerState,
  searchFTS,
  upsertFTS,
  type Store,
} from "../src/store.js";
import type { CollectionConfig } from "../src/collections.js";

function mecabInstalled(): boolean {
  try { execSync("which mecab", { stdio: "ignore" }); return true; }
  catch { return false; }
}

// Helper to insert a test document directly into the database
async function insertTestDocument(
  db: Database,
  collectionName: string,
  path: string,
  title: string,
  body: string
): Promise<number> {
  const now = new Date().toISOString();
  const hash = await hashContent(body);

  // Insert content
  db.prepare(`
    INSERT OR IGNORE INTO content (hash, doc, created_at)
    VALUES (?, ?, ?)
  `).run(hash, body, now);

  // Insert document
  const result = db.prepare(`
    INSERT INTO documents (collection, path, title, hash, created_at, modified_at, active)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(collectionName, path, title, hash, now, now, 1);

  const docId = Number(result.lastInsertRowid);

  // Upsert to FTS
  await upsertFTS(db, docId, `${collectionName}/${path}`, title, body);

  return docId;
}

const describeWithMecab = mecabInstalled() ? describe : describe.skip;

describeWithMecab("Korean FTS5 search integration", () => {
  let db: Database;
  let testDir: string;
  const dbPath = join(tmpdir(), `korean-search-test-${Date.now()}.sqlite`);

  beforeAll(async () => {
    // Create temp directory
    const tmpPrefix = join(tmpdir(), `korean-search-test-${Date.now()}-`);
    testDir = await mkdtemp(tmpPrefix);

    // Create database
    db = openDatabase(dbPath);
    const store = createStore(dbPath);
    store.close();

    // Re-open for direct access
    db = openDatabase(dbPath);

    // Index a Korean document
    const content = "프로젝트에서 검색했다. 로그인을 시작합니다. React컴포넌트를 렌더링한다.";
    await insertTestDocument(db, "test", "korean-doc.md", "테스트 문서", content);

    // Index an English document
    const enContent = "Search functionality in the project. Login implementation details.";
    await insertTestDocument(db, "test", "english-doc.md", "English Doc", enContent);
  });

  afterAll(async () => {
    db?.close();
    await unlink(dbPath).catch(() => {});
  });

  test("Korean stem search matches agglutinated forms", async () => {
    const results = await searchFTS(db, "검색", 20);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.filepath).toContain("korean-doc.md");
  });

  test("Korean stem search matches different surface forms", async () => {
    const results = await searchFTS(db, "로그인", 20);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.filepath).toContain("korean-doc.md");
  });

  test("English search still works", async () => {
    const results = await searchFTS(db, "search", 20);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.filepath).toContain("english-doc.md");
  });

  test("mixed Korean/English search works", async () => {
    const results = await searchFTS(db, "React", 20);
    expect(results.length).toBeGreaterThan(0);
  });
});

describe("Korean search fallback (no mecab)", () => {
  let db: Database;
  let testDir: string;
  const dbPath = join(tmpdir(), `korean-fallback-test-${Date.now()}.sqlite`);

  beforeAll(async () => {
    const { _setFallbackMode } = await import("../src/korean.js");
    _setFallbackMode(true);

    // Create temp directory
    const tmpPrefix = join(tmpdir(), `korean-fallback-test-${Date.now()}-`);
    testDir = await mkdtemp(tmpPrefix);

    // Create database
    db = openDatabase(dbPath);
    const store = createStore(dbPath);
    store.close();

    // Re-open for direct access
    db = openDatabase(dbPath);

    // Index a document
    const content = "검색했다 로그인을 시작합니다";
    await insertTestDocument(db, "test", "fallback-doc.md", "폴백 문서", content);
  });

  afterAll(async () => {
    const { _setFallbackMode } = await import("../src/korean.js");
    _setFallbackMode(false);
    db?.close();
    await unlink(dbPath).catch(() => {});
  });

  test("search still works in fallback mode (exact match)", async () => {
    const results = await searchFTS(db, "검색했다", 20);
    expect(results.length).toBeGreaterThan(0);
  });
});

describe("korean tokenizer state tracking", () => {
  let db: Database;
  let testDir: string;
  const dbPath = join(tmpdir(), `korean-state-test-${Date.now()}.sqlite`);

  beforeAll(async () => {
    // Create temp directory
    const tmpPrefix = join(tmpdir(), `korean-state-test-${Date.now()}-`);
    testDir = await mkdtemp(tmpPrefix);

    // Create database
    db = openDatabase(dbPath);
    const store = createStore(dbPath);
    store.close();

    // Re-open for direct access
    db = openDatabase(dbPath);
  });

  afterAll(async () => {
    db?.close();
    await unlink(dbPath).catch(() => {});
  });

  test("stores and retrieves tokenizer state", () => {
    expect(getKoreanTokenizerState(db)).toBe("none");
    setKoreanTokenizerState(db);
    expect(["mecab", "none"]).toContain(getKoreanTokenizerState(db));
  });
});
