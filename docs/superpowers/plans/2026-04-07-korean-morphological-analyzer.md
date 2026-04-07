# Korean Morphological Analyzer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate mecab-ko morphological analyzer into FTS5 indexing and search so Korean text is tokenized into content morphemes, improving BM25 search quality for Korean documents.

**Architecture:** Preprocess text with mecab-ko before FTS5 insertion. A new `src/korean.ts` module handles mecab process lifecycle, Korean text detection, POS filtering, and fallback when mecab is not installed. FTS5 triggers are replaced with app-level insertion that calls the preprocessor. Search queries go through the same preprocessor before `buildFTS5Query()`.

**Tech Stack:** mecab-ko (system binary), child_process.spawn (persistent process), SQLite FTS5 (unchanged tokenizer)

**Spec:** `docs/superpowers/specs/2026-04-07-korean-morphological-analyzer-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/korean.ts` | Create | mecab detection, process lifecycle, Korean text tokenization, POS filtering, fallback |
| `test/korean.test.ts` | Create | Unit tests for Korean tokenizer module |
| `src/store.ts` | Modify | Remove INSERT/UPDATE FTS5 triggers, add app-level FTS5 insert with preprocessing, preprocess search queries |
| `test/korean-search.test.ts` | Create | Integration tests for Korean FTS5 search |
| `src/cli/rebuild.ts` | Modify | Use new FTS5 insertion path |
| `src/cli/qmd.ts` | Modify | Wire FTS upsert into `indexFiles` function (~line 1504) |

---

### Task 1: Korean tokenizer module — mecab detection and fallback

**Files:**
- Create: `src/korean.ts`
- Create: `test/korean.test.ts`

- [ ] **Step 1: Write failing tests for mecab detection and fallback**

```typescript
// test/korean.test.ts
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { execSync } from "child_process";

describe("korean tokenizer", () => {
  describe("mecab detection", () => {
    test("detects mecab when available", async () => {
      const { isMecabAvailable } = await import("../src/korean.js");
      // This test passes if mecab is installed, skip otherwise
      try {
        execSync("which mecab", { stdio: "ignore" });
        expect(isMecabAvailable()).toBe(true);
      } catch {
        expect(isMecabAvailable()).toBe(false);
      }
    });
  });

  describe("fallback mode", () => {
    test("returns input unchanged when mecab is not available", async () => {
      const { tokenizeKorean, _setFallbackMode } = await import("../src/korean.js");
      _setFallbackMode(true);
      expect(await tokenizeKorean("검색했다")).toBe("검색했다");
      _setFallbackMode(false);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/korean.test.ts --reporter=verbose`
Expected: FAIL — module `../src/korean.js` not found

- [ ] **Step 3: Implement mecab detection and fallback skeleton**

```typescript
// src/korean.ts
import { execSync } from "child_process";

let mecabAvailable: boolean | null = null;
let fallbackMode = false;

/**
 * Check if mecab binary is available on PATH.
 * Result is cached after first call.
 */
export function isMecabAvailable(): boolean {
  if (fallbackMode) return false;
  if (mecabAvailable !== null) return mecabAvailable;
  try {
    execSync("which mecab", { stdio: "ignore" });
    mecabAvailable = true;
  } catch {
    mecabAvailable = false;
  }
  return mecabAvailable;
}

/** Print install instructions when mecab is missing. Called once. */
let warnedOnce = false;
export function warnMecabMissing(): void {
  if (warnedOnce) return;
  warnedOnce = true;
  console.warn(
    `⚠ mecab not found — Korean search quality will be limited.\n` +
    `  Install for better results:\n` +
    `    macOS:  brew install mecab mecab-ko-dic\n` +
    `    Ubuntu: sudo apt install mecab libmecab-dev && install-mecab-ko-dic\n`
  );
}

/**
 * Tokenize text for FTS5 indexing. Korean text is split into content morphemes
 * via mecab-ko. Non-Korean text passes through unchanged.
 *
 * In fallback mode (mecab not installed), returns input unchanged.
 */
export async function tokenizeKorean(text: string): Promise<string> {
  if (!isMecabAvailable()) {
    if (!fallbackMode) warnMecabMissing();
    return text;
  }
  // Placeholder — implemented in Task 2
  return text;
}

/** For testing only: force fallback mode on/off. */
export function _setFallbackMode(enabled: boolean): void {
  fallbackMode = enabled;
  if (enabled) mecabAvailable = false;
  else mecabAvailable = null;
}

/** Reset cached state. For testing. */
export function _resetState(): void {
  mecabAvailable = null;
  fallbackMode = false;
  warnedOnce = false;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/korean.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/korean.ts test/korean.test.ts
git commit -m "feat(korean): add mecab detection and fallback skeleton"
```

---

### Task 2: Korean text detection and mecab output parsing

**Files:**
- Modify: `src/korean.ts`
- Modify: `test/korean.test.ts`

- [ ] **Step 1: Write failing tests for Korean detection and parsing**

```typescript
// Append to test/korean.test.ts
describe("Korean text detection", () => {
  test("detects Korean characters", async () => {
    const { containsKorean } = await import("../src/korean.js");
    expect(containsKorean("검색")).toBe(true);
    expect(containsKorean("hello")).toBe(false);
    expect(containsKorean("React컴포넌트")).toBe(true);
    expect(containsKorean("12345")).toBe(false);
    expect(containsKorean("")).toBe(false);
  });

  test("splits text into Korean and non-Korean segments", async () => {
    const { splitByScript } = await import("../src/korean.js");
    const segments = splitByScript("React컴포넌트 검색");
    expect(segments).toEqual([
      { text: "React", isKorean: false },
      { text: "컴포넌트", isKorean: true },
      { text: " ", isKorean: false },
      { text: "검색", isKorean: true },
    ]);
  });

  test("handles pure English text", async () => {
    const { splitByScript } = await import("../src/korean.js");
    const segments = splitByScript("hello world");
    expect(segments).toEqual([
      { text: "hello world", isKorean: false },
    ]);
  });

  test("handles pure Korean text", async () => {
    const { splitByScript } = await import("../src/korean.js");
    const segments = splitByScript("검색했다");
    expect(segments).toEqual([
      { text: "검색했다", isKorean: true },
    ]);
  });
});

describe("mecab output parsing", () => {
  test("parses mecab output keeping content POS tags", async () => {
    const { parseMecabOutput } = await import("../src/korean.js");
    const mecabOutput = [
      "검색\tNNG,*,T,검색,*,*,*,*",
      "했\tXSV+EP,*,T,했,하/XSV/*+았/EP/*,*,*,*",
      "다\tEF,*,F,다,*,*,*,*",
      "EOS",
    ].join("\n");
    expect(parseMecabOutput(mecabOutput)).toBe("검색");
  });

  test("keeps nouns, verbs, adjectives, adverbs", async () => {
    const { parseMecabOutput } = await import("../src/korean.js");
    // "빠른 검색을 시작합니다" → 빠르(VA) 검색(NNG) 시작(NNG)
    const mecabOutput = [
      "빠른\tVA+ETM,*,T,빠른,빠르/VA/*+ㄴ/ETM/*,*,*,*",
      "검색\tNNG,*,T,검색,*,*,*,*",
      "을\tJKO,*,T,을,*,*,*,*",
      "시작\tNNG,*,T,시작,*,*,*,*",
      "합니다\tXSV+EF,*,F,합니다,하/XSV/*+ㅂ니다/EF/*,*,*,*",
      "EOS",
    ].join("\n");
    // VA+ETM is compound — first POS is VA (adjective), keep it
    expect(parseMecabOutput(mecabOutput)).toBe("빠른 검색 시작");
  });

  test("returns empty string for grammar-only input", async () => {
    const { parseMecabOutput } = await import("../src/korean.js");
    const mecabOutput = [
      "을\tJKO,*,T,을,*,*,*,*",
      "EOS",
    ].join("\n");
    expect(parseMecabOutput(mecabOutput)).toBe("");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/korean.test.ts --reporter=verbose`
Expected: FAIL — `containsKorean`, `splitByScript`, `parseMecabOutput` not found

- [ ] **Step 3: Implement Korean detection and mecab parsing**

Add to `src/korean.ts`:

```typescript
// Hangul Syllables range: U+AC00 to U+D7AF
const HANGUL_RE = /[\uAC00-\uD7AF]/;
const HANGUL_BLOCK_RE = /[\uAC00-\uD7AF]+/g;

/** Check if text contains any Korean (Hangul Syllables) characters. */
export function containsKorean(text: string): boolean {
  return HANGUL_RE.test(text);
}

export type ScriptSegment = { text: string; isKorean: boolean };

/**
 * Split text into alternating Korean and non-Korean segments.
 * Korean = Hangul Syllables (U+AC00-U+D7AF) only.
 */
export function splitByScript(text: string): ScriptSegment[] {
  const segments: ScriptSegment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(HANGUL_BLOCK_RE)) {
    const start = match.index!;
    if (start > lastIndex) {
      segments.push({ text: text.slice(lastIndex, start), isKorean: false });
    }
    segments.push({ text: match[0], isKorean: true });
    lastIndex = start + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), isKorean: false });
  }

  return segments;
}

// POS tags to keep (content words)
const CONTENT_POS = new Set([
  "NNG",  // 일반명사
  "NNP",  // 고유명사
  "NNB",  // 의존명사
  "VV",   // 동사
  "VA",   // 형용사
  "MAG",  // 일반부사
  "XR",   // 어근
]);

/**
 * Parse mecab output, keeping only content-word morphemes.
 * Returns space-separated surface forms of content words.
 */
export function parseMecabOutput(output: string): string {
  const morphemes: string[] = [];
  for (const line of output.split("\n")) {
    if (line === "EOS" || line === "") continue;
    const [surface, features] = line.split("\t");
    if (!surface || !features) continue;
    // First field of features is POS tag (may be compound like "VA+ETM")
    const posTag = features.split(",")[0]!;
    // For compound POS (e.g., "XSV+EP"), check the first tag
    const primaryPos = posTag.split("+")[0]!;
    if (CONTENT_POS.has(primaryPos)) {
      morphemes.push(surface);
    }
  }
  return morphemes.join(" ");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/korean.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/korean.ts test/korean.test.ts
git commit -m "feat(korean): add text detection and mecab output parsing"
```

---

### Task 3: Persistent mecab process and full tokenization

**Files:**
- Modify: `src/korean.ts`
- Modify: `test/korean.test.ts`

- [ ] **Step 1: Write failing test for end-to-end tokenization**

```typescript
// Append to test/korean.test.ts
import { execSync } from "child_process";

function mecabInstalled(): boolean {
  try { execSync("which mecab", { stdio: "ignore" }); return true; }
  catch { return false; }
}

describe("tokenizeKorean (end-to-end)", () => {
  const skipIfNoMecab = mecabInstalled() ? test : test.skip;

  skipIfNoMecab("tokenizes Korean text into content morphemes", async () => {
    const { tokenizeKorean, _resetState } = await import("../src/korean.js");
    _resetState();
    const result = await tokenizeKorean("검색했다");
    // Should contain "검색" as a content morpheme
    expect(result).toContain("검색");
    // Should NOT contain the full agglutinated form
    expect(result).not.toBe("검색했다");
  });

  skipIfNoMecab("passes through English text unchanged", async () => {
    const { tokenizeKorean, _resetState } = await import("../src/korean.js");
    _resetState();
    const result = await tokenizeKorean("hello world");
    expect(result).toBe("hello world");
  });

  skipIfNoMecab("handles mixed Korean/English text", async () => {
    const { tokenizeKorean, _resetState } = await import("../src/korean.js");
    _resetState();
    const result = await tokenizeKorean("React컴포넌트를 검색했다");
    expect(result).toContain("React");
    expect(result).toContain("검색");
    // Particle "를" should be removed
    expect(result).not.toContain("를");
  });

  skipIfNoMecab("handles empty input", async () => {
    const { tokenizeKorean, _resetState } = await import("../src/korean.js");
    _resetState();
    expect(await tokenizeKorean("")).toBe("");
  });

  skipIfNoMecab("reuses persistent process across calls", async () => {
    const { tokenizeKorean, shutdownMecab, _resetState } = await import("../src/korean.js");
    _resetState();
    const r1 = await tokenizeKorean("검색");
    const r2 = await tokenizeKorean("시작");
    expect(r1).toContain("검색");
    expect(r2).toContain("시작");
    shutdownMecab();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/korean.test.ts --reporter=verbose`
Expected: FAIL — `shutdownMecab` not found, `tokenizeKorean` returns input unchanged (placeholder)

- [ ] **Step 3: Implement persistent mecab process and full tokenization**

Replace the placeholder `tokenizeKorean` and add process management in `src/korean.ts`:

```typescript
import { spawn, execSync } from "child_process";
import type { ChildProcess } from "child_process";

let mecabProcess: ChildProcess | null = null;

const MECAB_TIMEOUT_MS = 5000;
let exitHandlerRegistered = false;

/**
 * Get or start the persistent mecab process.
 * Reuses a single process across all calls for performance.
 * Registers process exit cleanup lazily on first spawn.
 */
function getMecabProcess(): ChildProcess {
  if (mecabProcess && !mecabProcess.killed) return mecabProcess;
  mecabProcess = spawn("mecab", [], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  mecabProcess.on("exit", () => { mecabProcess = null; });
  mecabProcess.on("error", () => { mecabProcess = null; });
  if (!exitHandlerRegistered) {
    process.on("exit", shutdownMecab);
    exitHandlerRegistered = true;
  }
  return mecabProcess;
}

/**
 * Send text to mecab and get parsed output.
 * Uses the persistent process with stdin/stdout streaming.
 * Times out after MECAB_TIMEOUT_MS and rejects if process crashes.
 */
function runMecab(text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = getMecabProcess();
    if (!proc.stdout || !proc.stdin) {
      reject(new Error("mecab process has no stdio"));
      return;
    }

    let output = "";
    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
      proc.stdout!.off("data", onData);
      proc.off("error", onError);
      proc.off("close", onClose);
    };

    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes("EOS\n")) {
        settled = true;
        cleanup();
        resolve(output);
      }
    };

    const onError = (err: Error) => {
      if (!settled) { settled = true; cleanup(); reject(err); }
    };

    const onClose = () => {
      if (!settled) { settled = true; cleanup(); reject(new Error("mecab process exited unexpectedly")); }
    };

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        shutdownMecab(); // kill stuck process
        reject(new Error("mecab timed out"));
      }
    }, MECAB_TIMEOUT_MS);

    proc.stdout.on("data", onData);
    proc.on("error", onError);
    proc.on("close", onClose);
    proc.stdin.write(text + "\n");
  });
}

/** Shut down the persistent mecab process. */
export function shutdownMecab(): void {
  if (mecabProcess && !mecabProcess.killed) {
    mecabProcess.kill();
    mecabProcess = null;
  }
}

/**
 * Tokenize text for FTS5 indexing. Korean segments are split into content
 * morphemes via mecab-ko. Non-Korean segments pass through unchanged.
 */
export async function tokenizeKorean(text: string): Promise<string> {
  if (!text) return text;
  if (!isMecabAvailable()) {
    if (!fallbackMode) warnMecabMissing();
    return text;
  }
  if (!containsKorean(text)) return text;

  const segments = splitByScript(text);
  const result: string[] = [];

  for (const seg of segments) {
    if (!seg.isKorean) {
      result.push(seg.text);
    } else {
      try {
        const mecabOutput = await runMecab(seg.text);
        const parsed = parseMecabOutput(mecabOutput);
        result.push(parsed || seg.text); // fallback to original if all filtered
      } catch {
        result.push(seg.text); // on error, keep original
      }
    }
  }

  return result.join("");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/korean.test.ts --reporter=verbose`
Expected: PASS (or skip if mecab not installed)

- [ ] **Step 5: Commit**

```bash
git add src/korean.ts test/korean.test.ts
git commit -m "feat(korean): implement persistent mecab process and full tokenization"
```

---

### Task 4: Replace FTS5 triggers with app-level insertion

**Files:**
- Modify: `src/store.ts`

- [ ] **Step 1: Add `upsertFTS` helper function**

Add after the existing `insertDocument` function (~line 2119) in `src/store.ts`:

```typescript
import { tokenizeKorean } from "./korean.js";

/**
 * Insert or replace a document's FTS5 entry with Korean-preprocessed text.
 * Called after insertDocument/updateDocument/updateDocumentTitle.
 */
export async function upsertFTS(
  db: Database,
  documentId: number,
  filepath: string,
  title: string,
  body: string
): Promise<void> {
  const processedTitle = await tokenizeKorean(title);
  const processedBody = await tokenizeKorean(body);
  db.prepare(`
    INSERT OR REPLACE INTO documents_fts(rowid, filepath, title, body)
    VALUES (?, ?, ?, ?)
  `).run(documentId, filepath, processedTitle, processedBody);
}
```

- [ ] **Step 2: Remove INSERT trigger, keep DELETE trigger, remove UPDATE trigger**

In `initializeDatabase()` (~line 833), replace the three trigger definitions:

```typescript
  // Keep DELETE trigger — no preprocessing needed
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
      DELETE FROM documents_fts WHERE rowid = old.id;
    END
  `);

  // Deactivation trigger — delete from FTS when document becomes inactive
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS documents_au_deactivate AFTER UPDATE ON documents
    WHEN new.active = 0 AND old.active = 1
    BEGIN
      DELETE FROM documents_fts WHERE rowid = old.id;
    END
  `);
```

Remove `documents_ai` (INSERT trigger) and the old `documents_au` (full UPDATE trigger). Drop them if they exist from previous schema:

```typescript
  // Drop old triggers that are replaced by app-level FTS insertion
  db.exec(`DROP TRIGGER IF EXISTS documents_ai`);
  db.exec(`DROP TRIGGER IF EXISTS documents_au`);
```

- [ ] **Step 3: Add `getDocumentId` helper for reliable ID retrieval**

`insertDocument` uses `ON CONFLICT DO UPDATE`, so `lastInsertRowid` is unreliable on the UPDATE path. Instead, add a helper that queries the ID after upsert:

```typescript
/**
 * Get the document ID after an insertDocument upsert.
 * Needed because ON CONFLICT DO UPDATE does not reliably return lastInsertRowid.
 */
export function getDocumentId(db: Database, collectionName: string, path: string): number | null {
  const row = db.prepare(`SELECT id FROM documents WHERE collection = ? AND path = ? AND active = 1`).get(collectionName, path) as { id: number } | undefined;
  return row?.id ?? null;
}
```

`insertDocument` itself stays `void` — callers use `getDocumentId` after insert to get the ID for `upsertFTS`. Alternatively, callers that already have `existing` from `findActiveDocument` can use `existing.id` directly.

Note: The actual FTS upsert is called by the callers after getting the document ID and content. See Task 5 for wiring this up.

- [ ] **Step 4: Add FTS upsert calls to `updateDocumentTitle` and `updateDocument`**

For `updateDocumentTitle` (~line 2140), the caller must call `upsertFTS` after title change. Similarly for `updateDocument` (~line 2154). These functions only update the `documents` table; FTS sync happens at the call site where we have access to the content.

- [ ] **Step 5: Commit**

```bash
git add src/store.ts
git commit -m "feat(korean): replace FTS5 triggers with app-level insertion"
```

---

### Task 5: Wire FTS upsert into all call sites

**Files:**
- Modify: `src/store.ts` (reindexCollection, QMDStore interface)
- Modify: `src/cli/rebuild.ts`
- Modify: `src/cli/ingest.ts`
- Modify: `src/cli/extract.ts`
- Modify: `src/cli/qmd.ts` (indexFiles ~line 1504)

- [ ] **Step 1: Update `reindexCollection` in `src/store.ts` (~line 1200)**

After each `insertDocument`, `updateDocument`, and `updateDocumentTitle` call, add `upsertFTS`. Use `existing.id` where available, `getDocumentId()` for new inserts:

```typescript
// In the existing block (~line 1243-1265):
if (existing) {
  if (existing.hash === hash) {
    if (existing.title !== title) {
      updateDocumentTitle(db, existing.id, title, now);
      const existingContent = db.prepare(`SELECT doc FROM content WHERE hash = ?`).get(existing.hash) as { doc: string } | undefined;
      if (existingContent) {
        await upsertFTS(db, existing.id, collectionName + "/" + path, title, existingContent.doc);
      }
      updated++;
    } else {
      unchanged++;
    }
  } else {
    insertContent(db, hash, content, now);
    const stat = statSync(filepath);
    updateDocument(db, existing.id, title, hash,
      stat ? new Date(stat.mtime).toISOString() : now);
    await upsertFTS(db, existing.id, collectionName + "/" + path, title, content);
    updated++;
  }
} else {
  indexed++;
  insertContent(db, hash, content, now);
  const stat = statSync(filepath);
  insertDocument(db, collectionName, path, title, hash,
    stat ? new Date(stat.birthtime).toISOString() : now,
    stat ? new Date(stat.mtime).toISOString() : now);
  const docId = getDocumentId(db, collectionName, path);
  if (docId) await upsertFTS(db, docId, collectionName + "/" + path, title, content);
}
```

Note: `reindexCollection` must become `async` since `upsertFTS` is async (mecab).

- [ ] **Step 2: Update `src/cli/rebuild.ts`**

After each `insertDocument` call (~line 90), add FTS upsert:

```typescript
import { insertDocument, hashContent, insertContent, createStore, getDefaultDbPath, upsertFTS, getDocumentId } from "../store.js";

// Inside indexDir loop, after insertDocument:
insertDocument(db, collectionName, filePath, title, hash, now, now, {
  source_type: sourceType,
  project,
});
const docId = getDocumentId(db, collectionName, filePath);
if (docId) await upsertFTS(db, docId, collectionName + "/" + filePath, title, content);
```

- [ ] **Step 3: Update `src/cli/ingest.ts`**

After `insertDocument` call (~line 102), add FTS upsert:

```typescript
import { insertDocument, hashContent, insertContent, createStore, upsertFTS, getDocumentId } from "../store.js";

// After insertDocument:
insertDocument(db, collectionName, destPath, title, hash, now, now, { ... });
const docId = getDocumentId(db, collectionName, destPath);
if (docId) await upsertFTS(db, docId, collectionName + "/" + destPath, title, content);
```

- [ ] **Step 4: Update `src/cli/extract.ts`**

After both `insertDocument` calls (~line 124, ~line 168), add FTS upsert:

```typescript
import { insertDocument, hashContent, insertContent, createStore, getDefaultDbPath, upsertFTS, getDocumentId } from "../store.js";

// After session insertDocument (~line 124):
insertDocument(db, "hwicortex", sessionDocPath, sessionId, sessionHash, now, now, { ... });
const sessionDocId = getDocumentId(db, "hwicortex", sessionDocPath);
if (sessionDocId) await upsertFTS(db, sessionDocId, "hwicortex/" + sessionDocPath, sessionId, markdown);

// After knowledge insertDocument (~line 168):
insertDocument(db, "hwicortex", knowledgePath, knowledge.title, knowledgeHash, now, now, { ... });
const knowledgeDocId = getDocumentId(db, "hwicortex", knowledgePath);
if (knowledgeDocId) await upsertFTS(db, knowledgeDocId, "hwicortex/" + knowledgePath, knowledge.title, knowledgeContent);
```

- [ ] **Step 5: Update `src/cli/qmd.ts` indexFiles function (~line 1504)**

The `indexFiles` function in `qmd.ts` has its own `insertDocument`, `updateDocumentTitle`, and `updateDocument` calls that bypass `reindexCollection`. Wire FTS upsert at all three locations:

```typescript
// At ~line 1581 (updateDocumentTitle):
updateDocumentTitle(db, existing.id, title, now);
const existingContent = db.prepare(`SELECT doc FROM content WHERE hash = ?`).get(existing.hash) as { doc: string } | undefined;
if (existingContent) {
  await upsertFTS(db, existing.id, collectionName + "/" + path, title, existingContent.doc);
}

// At ~line 1599 (insertDocument for new docs):
insertDocument(db, collectionName, path, title, hash, ...);
const docId = getDocumentId(db, collectionName, path);
if (docId) await upsertFTS(db, docId, collectionName + "/" + path, title, content);

// At ~line 1590 (updateDocument for changed content):
updateDocument(db, existing.id, title, hash, ...);
await upsertFTS(db, existing.id, collectionName + "/" + path, title, content);
```

- [ ] **Step 6: Update QMDStore interface and `createStore` bindings**

In `src/store.ts`, add `upsertFTS` and `getDocumentId` to the `QMDStore` interface (~line 1149) and `createStore` (~line 1663):

```typescript
// Interface
upsertFTS: (documentId: number, filepath: string, title: string, body: string) => Promise<void>;
getDocumentId: (collectionName: string, path: string) => number | null;

// createStore bindings
upsertFTS: (documentId: number, filepath: string, title: string, body: string) => upsertFTS(db, documentId, filepath, title, body),
getDocumentId: (collectionName: string, path: string) => getDocumentId(db, collectionName, path),
```

- [ ] **Step 7: Commit**

```bash
git add src/store.ts src/cli/rebuild.ts src/cli/ingest.ts src/cli/extract.ts src/cli/qmd.ts
git commit -m "feat(korean): wire FTS upsert into all document insertion call sites"
```

---

### Task 6: Preprocess search queries

**Files:**
- Modify: `src/store.ts`

- [ ] **Step 1: Add Korean preprocessing to `searchFTS`**

At the top of `searchFTS` (~line 2958), preprocess the query:

```typescript
export async function searchFTS(db: Database, query: string, limit: number = 20, collectionName?: string, sourceType?: string): Promise<SearchResult[]> {
  // Preprocess Korean text in query
  const { tokenizeKorean } = await import("./korean.js");
  const processedQuery = await tokenizeKorean(query);
  const ftsQuery = buildFTS5Query(processedQuery);
  if (!ftsQuery) return [];
  // ... rest unchanged
}
```

Note: `searchFTS` becomes `async`. Update all call sites in `src/store.ts` (hybridQuery, structuredSearch) to `await` it. Update the `QMDStore` interface return type to `Promise<SearchResult[]>`.

- [ ] **Step 2: Update all `searchFTS` call sites to use await**

In `src/store.ts`:
- `hybridQuery` (~line 3975): `const initialFts = await store.searchFTS(...)` — already in an async function
- `hybridQuery` (~line 4012): `const ftsResults = await store.searchFTS(...)` — same
- `structuredSearch` (~line 4397): `const ftsResults = await store.searchFTS(...)` — already async

In QMDStore interface (~line 1130):
```typescript
searchFTS: (query: string, limit?: number, collectionName?: string, sourceType?: string) => Promise<SearchResult[]>;
```

- [ ] **Step 3: Commit**

```bash
git add src/store.ts
git commit -m "feat(korean): preprocess search queries with Korean tokenizer"
```

---

### Task 7: Index state tracking in store_config

**Files:**
- Modify: `src/store.ts`

- [ ] **Step 1: Write failing test**

```typescript
// Append to test/korean-search.test.ts
describe("korean tokenizer state tracking", () => {
  let db: Database;
  const dbPath = join(tmpdir(), `korean-state-test-${Date.now()}.sqlite`);

  beforeAll(() => {
    db = openDatabase(dbPath);
    initializeDatabase(db);
  });

  afterAll(async () => {
    db?.close();
    await unlink(dbPath).catch(() => {});
  });

  test("stores and retrieves tokenizer state", async () => {
    const { getKoreanTokenizerState, setKoreanTokenizerState } = await import("../src/store.js");
    // Before setting, default is "none"
    expect(getKoreanTokenizerState(db)).toBe("none");
    // After setting, reflects mecab availability
    setKoreanTokenizerState(db);
    expect(["mecab", "none"]).toContain(getKoreanTokenizerState(db));
  });
});
```

- [ ] **Step 2: Implement state tracking**

Add to `src/store.ts`:

```typescript
import { isMecabAvailable } from "./korean.js";

export function getKoreanTokenizerState(db: Database): string {
  const row = db.prepare(`SELECT value FROM store_config WHERE key = 'korean_tokenizer'`).get() as { value: string } | undefined;
  return row?.value ?? "none";
}

export function setKoreanTokenizerState(db: Database): void {
  const state = isMecabAvailable() ? "mecab" : "none";
  db.prepare(`INSERT OR REPLACE INTO store_config (key, value) VALUES ('korean_tokenizer', ?)`).run(state);
}
```

Call `setKoreanTokenizerState(db)` at the end of `reindexCollection` and in `rebuild.ts` after indexing.

- [ ] **Step 3: Add status display**

In the status output section of `src/cli/qmd.ts`, add Korean tokenizer state display. Find where `qmd status` is handled and add:

```typescript
const koreanState = getKoreanTokenizerState(db);
const mecabNow = isMecabAvailable() ? "mecab" : "none";
if (koreanState !== mecabNow) {
  console.log(`Korean tokenizer: ${mecabNow} (index built with ${koreanState} — run \`hwicortex rebuild\` to update)`);
} else {
  console.log(`Korean tokenizer: ${koreanState}`);
}
```

- [ ] **Step 4: Commit**

```bash
git add src/store.ts src/cli/qmd.ts
git commit -m "feat(korean): track tokenizer state in store_config"
```

---

### Task 8: Integration tests for Korean search

**Files:**
- Create: `test/korean-search.test.ts`

- [ ] **Step 1: Write integration tests**

```typescript
// test/korean-search.test.ts
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { openDatabase } from "../src/db.js";
import type { Database } from "../src/db.js";
import { execSync } from "child_process";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  initializeDatabase,
  insertContent,
  insertDocument,
  upsertFTS,
  searchFTS,
  hashContent,
} from "../src/store.js";

function mecabInstalled(): boolean {
  try { execSync("which mecab", { stdio: "ignore" }); return true; }
  catch { return false; }
}

const describeWithMecab = mecabInstalled() ? describe : describe.skip;

describeWithMecab("Korean FTS5 search integration", () => {
  let db: Database;
  const dbPath = join(tmpdir(), `korean-search-test-${Date.now()}.sqlite`);

  beforeAll(async () => {
    db = openDatabase(dbPath);
    initializeDatabase(db);

    // Index a Korean document
    const content = "프로젝트에서 검색했다. 로그인을 시작합니다. React컴포넌트를 렌더링한다.";
    const hash = await hashContent(content);
    insertContent(db, hash, content, new Date().toISOString());
    const docId = insertDocument(db, "test", "korean-doc.md", "테스트 문서", hash,
      new Date().toISOString(), new Date().toISOString());
    await upsertFTS(db, docId, "test/korean-doc.md", "테스트 문서", content);

    // Index an English document
    const enContent = "Search functionality in the project. Login implementation details.";
    const enHash = await hashContent(enContent);
    insertContent(db, enHash, enContent, new Date().toISOString());
    const enDocId = insertDocument(db, "test", "english-doc.md", "English Doc", enHash,
      new Date().toISOString(), new Date().toISOString());
    await upsertFTS(db, enDocId, "test/english-doc.md", "English Doc", enContent);
  });

  afterAll(async () => {
    db?.close();
    await unlink(dbPath).catch(() => {});
  });

  test("Korean stem search matches agglutinated forms", async () => {
    const results = await searchFTS(db, "검색");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.filepath).toContain("korean-doc.md");
  });

  test("Korean stem search matches different surface forms", async () => {
    const results = await searchFTS(db, "로그인");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.filepath).toContain("korean-doc.md");
  });

  test("English search still works", async () => {
    const results = await searchFTS(db, "search");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.filepath).toContain("english-doc.md");
  });

  test("mixed Korean/English search works", async () => {
    const results = await searchFTS(db, "React");
    expect(results.length).toBeGreaterThan(0);
  });
});

describe("Korean search fallback (no mecab)", () => {
  let db: Database;
  const dbPath = join(tmpdir(), `korean-fallback-test-${Date.now()}.sqlite`);

  beforeAll(async () => {
    const { _setFallbackMode } = await import("../src/korean.js");
    _setFallbackMode(true);

    db = openDatabase(dbPath);
    initializeDatabase(db);

    const content = "검색했다 로그인을 시작합니다";
    const hash = await hashContent(content);
    insertContent(db, hash, content, new Date().toISOString());
    const docId = insertDocument(db, "test", "fallback-doc.md", "폴백 문서", hash,
      new Date().toISOString(), new Date().toISOString());
    await upsertFTS(db, docId, "test/fallback-doc.md", "폴백 문서", content);
  });

  afterAll(async () => {
    const { _setFallbackMode } = await import("../src/korean.js");
    _setFallbackMode(false);
    db?.close();
    await unlink(dbPath).catch(() => {});
  });

  test("search still works in fallback mode (exact match)", async () => {
    const results = await searchFTS(db, "검색했다");
    expect(results.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run all tests**

Run: `npx vitest run test/korean.test.ts test/korean-search.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 3: Run existing tests to verify no regression**

Run: `npx vitest run --reporter=verbose test/`
Expected: All existing tests PASS

- [ ] **Step 4: Commit**

```bash
git add test/korean-search.test.ts
git commit -m "test(korean): add integration tests for Korean FTS5 search"
```

---

### Task 9: Update CHANGELOG

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add entry under [Unreleased]**

```markdown
## [Unreleased]

### Changes

- Korean morphological analysis for BM25 search via mecab-ko. Korean text is
  preprocessed into content morphemes (nouns, verbs, adjectives) at indexing
  time, so searching "검색" matches "검색했다", "검색하는", etc. Requires
  mecab-ko system package; graceful fallback to standard FTS5 tokenization
  when not installed. Run `hwicortex rebuild` after installing mecab to
  reindex existing documents.
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: add Korean morphological analyzer to changelog"
```
