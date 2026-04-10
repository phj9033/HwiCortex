# Wiki Importance Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-action count tracking, importance/hit_count aggregation, similarity detection with merge, and reset-importance to wiki pages.

**Architecture:** Extend WikiMeta with flat `count_*` fields and computed `importance`/`hit_count`. Add `bumpCount()` and `recalcImportance()` to `src/wiki.ts`. Wire count bumping into CLI handlers for show/update/link/create(merge) and search/query results. Similarity detection uses existing FTS on `wiki create`.

**Tech Stack:** TypeScript, Bun, vitest, SQLite FTS5

**Spec:** `docs/superpowers/specs/2026-04-10-wiki-importance-design.md`

---

## File Structure

| File | Role |
|------|------|
| `src/wiki.ts` | Core library: WikiMeta type, frontmatter parse/build, CRUD, new count/importance/similarity functions |
| `src/cli/wiki.ts` | CLI handler: wire bumpCount into show/update/link/create, add reset-importance subcommand, --no-count/--auto-merge/--force flags |
| `src/cli/qmd.ts` | Main CLI entry: wire hit_count bumping into search/query result post-processing |
| `test/wiki.test.ts` | Unit tests for count/importance/similarity/reset logic |
| `test/wiki-cli.test.ts` | CLI integration tests for new flags and reset-importance |
| `CLAUDE.md` | Document new commands and flags |

---

### Task 1: Extend WikiMeta type and parseFrontmatter

**Files:**
- Modify: `src/wiki.ts:31-39` (WikiMeta type)
- Modify: `src/wiki.ts:72-105` (parseFrontmatter)
- Test: `test/wiki.test.ts`

- [ ] **Step 1: Write failing test for count fields in parseFrontmatter**

In `test/wiki.test.ts`, add to the `parseFrontmatter` describe block:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/wiki.test.ts -t "parses count fields"`
Expected: FAIL — `count_show` property does not exist on WikiMeta

- [ ] **Step 3: Extend WikiMeta type**

In `src/wiki.ts`, replace the WikiMeta type (lines 31-39):

```typescript
export type WikiMeta = {
  title: string;
  project: string;
  tags: string[];
  sources: string[];
  related: string[];
  count_show: number;
  count_append: number;
  count_update: number;
  count_link: number;
  count_merge: number;
  count_search_hit: number;
  count_query_hit: number;
  importance: number;
  hit_count: number;
  last_accessed: string;
  created?: string;
  updated?: string;
};
```

- [ ] **Step 4: Update parseFrontmatter to parse count fields**

In `src/wiki.ts`, add a `getInt` helper inside `parseFrontmatter` and extend the return object:

```typescript
const getInt = (key: string): number => {
  const raw = get(key);
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  return isNaN(n) ? 0 : n;
};

return {
  meta: {
    title: get("title"),
    project: get("project"),
    tags: getArray("tags"),
    sources: getArray("sources"),
    related: getArray("related"),
    count_show: getInt("count_show"),
    count_append: getInt("count_append"),
    count_update: getInt("count_update"),
    count_link: getInt("count_link"),
    count_merge: getInt("count_merge"),
    count_search_hit: getInt("count_search_hit"),
    count_query_hit: getInt("count_query_hit"),
    importance: getInt("importance"),
    hit_count: getInt("hit_count"),
    last_accessed: get("last_accessed"),
    created: get("created"),
    updated: get("updated"),
  },
  body,
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/wiki.test.ts -t "parses count fields|missing count fields"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/wiki.ts test/wiki.test.ts
git commit -m "feat(wiki): extend WikiMeta with count fields and parse them from frontmatter"
```

---

### Task 2: Update buildFrontmatter to output count fields

**Files:**
- Modify: `src/wiki.ts:48-66` (buildFrontmatter)
- Test: `test/wiki.test.ts`

- [ ] **Step 1: Write failing test for buildFrontmatter with counts**

In `test/wiki.test.ts`, add to the `buildFrontmatter` describe block:

```typescript
test("builds frontmatter with count fields", () => {
  const fm = buildFrontmatter({
    title: "Test",
    project: "p",
    tags: [],
    sources: [],
    related: [],
    count_show: 5,
    count_append: 3,
    count_update: 1,
    count_link: 2,
    count_merge: 1,
    count_search_hit: 8,
    count_query_hit: 4,
    importance: 12,
    hit_count: 12,
    last_accessed: "2026-04-10",
  });
  expect(fm).toContain("count_show: 5");
  expect(fm).toContain("count_append: 3");
  expect(fm).toContain("importance: 12");
  expect(fm).toContain("hit_count: 12");
  expect(fm).toContain("last_accessed: 2026-04-10");
});

test("omits count fields when all zero", () => {
  const fm = buildFrontmatter({
    title: "Test",
    project: "p",
    tags: [],
    sources: [],
    related: [],
    count_show: 0,
    count_append: 0,
    count_update: 0,
    count_link: 0,
    count_merge: 0,
    count_search_hit: 0,
    count_query_hit: 0,
    importance: 0,
    hit_count: 0,
    last_accessed: "",
  });
  expect(fm).not.toContain("count_");
  expect(fm).not.toContain("importance:");
  expect(fm).not.toContain("hit_count:");
  expect(fm).not.toContain("last_accessed:");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/wiki.test.ts -t "builds frontmatter with count"`
Expected: FAIL — buildFrontmatter does not accept count fields

- [ ] **Step 3: Update buildFrontmatter**

In `src/wiki.ts`, update the `buildFrontmatter` function signature and body. The function should accept the full WikiMeta (minus required created/updated) and conditionally output count fields only when non-zero:

```typescript
export function buildFrontmatter(meta: Omit<WikiMeta, "created" | "updated"> & { created?: string; updated?: string }): string {
  const created = meta.created || today();
  const updated = meta.updated || today();
  const tags = meta.tags.length > 0 ? `[${meta.tags.join(", ")}]` : "[]";
  const sources = meta.sources.length > 0 ? `[${meta.sources.join(", ")}]` : "[]";
  const related = meta.related.length > 0 ? `[${meta.related.join(", ")}]` : "[]";

  const lines = [
    "---",
    `title: ${meta.title}`,
    `project: ${meta.project}`,
    `tags: ${tags}`,
    `sources: ${sources}`,
    `related: ${related}`,
  ];

  // Only emit count fields if any count is non-zero
  const hasAnyCounts = meta.count_show || meta.count_append || meta.count_update ||
    meta.count_link || meta.count_merge || meta.count_search_hit || meta.count_query_hit;

  if (hasAnyCounts) {
    lines.push(`count_show: ${meta.count_show}`);
    lines.push(`count_append: ${meta.count_append}`);
    lines.push(`count_update: ${meta.count_update}`);
    lines.push(`count_link: ${meta.count_link}`);
    lines.push(`count_merge: ${meta.count_merge}`);
    lines.push(`count_search_hit: ${meta.count_search_hit}`);
    lines.push(`count_query_hit: ${meta.count_query_hit}`);
    lines.push(`importance: ${meta.importance}`);
    lines.push(`hit_count: ${meta.hit_count}`);
  }

  if (meta.last_accessed) {
    lines.push(`last_accessed: ${meta.last_accessed}`);
  }

  lines.push(`created: ${created}`);
  lines.push(`updated: ${updated}`);
  lines.push("---");

  return lines.join("\n");
}
```

- [ ] **Step 4: Fix existing callers of buildFrontmatter**

All callers of `buildFrontmatter` now need to provide count fields. Update `createWikiPage` (line ~199) to include zero-initialized counts:

```typescript
const fm = buildFrontmatter({
  title: opts.title,
  project: opts.project,
  tags: opts.tags ?? [],
  sources: opts.sources ?? [],
  related: [],
  count_show: 0,
  count_append: 0,
  count_update: 0,
  count_link: 0,
  count_merge: 0,
  count_search_hit: 0,
  count_query_hit: 0,
  importance: 0,
  hit_count: 0,
  last_accessed: "",
});
```

The following callers of `buildFrontmatter` use `page.meta` from `getWikiPage` → `parseFrontmatter`, which now includes count fields. They pass through without changes:
- `updateWikiPage` (line ~296): uses `meta` from `getWikiPage`
- `syncRelatedSection` (line ~336): uses `meta` from `parseFrontmatter`
- `linkPages` (line ~353, ~359): uses `pageA.meta` / `pageB.meta` from `getWikiPage`
- `unlinkPages` (line ~372): uses `page.meta` from `getWikiPage`

No changes needed for these callers since `parseFrontmatter` now populates all count fields (defaulting to 0).

- [ ] **Step 5: Run all wiki tests**

Run: `npx vitest run test/wiki.test.ts --reporter=verbose`
Expected: ALL PASS (including existing tests — backward compat)

- [ ] **Step 6: Commit**

```bash
git add src/wiki.ts test/wiki.test.ts
git commit -m "feat(wiki): output count/importance fields in buildFrontmatter"
```

---

### Task 3: Add bumpCount and recalcImportance

**Files:**
- Modify: `src/wiki.ts` (add new exported functions)
- Test: `test/wiki.test.ts`

- [ ] **Step 1: Write failing tests for bumpCount and recalcImportance**

Add a new describe block in `test/wiki.test.ts`:

```typescript
describe("Wiki importance tracking", () => {
  let vaultDir: string;

  beforeEach(() => {
    vaultDir = mkdtempSync(join(tmpdir(), "wiki-importance-"));
  });

  afterEach(() => {
    if (vaultDir && existsSync(vaultDir)) rmSync(vaultDir, { recursive: true });
  });

  test("recalcImportance computes weighted sum", () => {
    const meta = {
      title: "T", project: "p", tags: [], sources: [], related: [],
      count_show: 5, count_append: 3, count_update: 1,
      count_link: 2, count_merge: 1,
      count_search_hit: 8, count_query_hit: 4,
      importance: 0, hit_count: 0, last_accessed: "",
    };
    const result = recalcImportance(meta);
    // importance = 5×1 + 3×2 + 1×1 + 2×1 + 1×3 = 5+6+1+2+3 = 17
    expect(result.importance).toBe(17);
    // hit_count = 8 + 4 = 12
    expect(result.hit_count).toBe(12);
  });

  test("bumpCount increments show and updates importance", async () => {
    await createWikiPage(vaultDir, { title: "Bump Test", project: "p", body: "hello" });
    bumpCount(vaultDir, "Bump Test", "p", "show");
    const page = getWikiPage(vaultDir, "Bump Test", "p");
    expect(page.meta.count_show).toBe(1);
    expect(page.meta.importance).toBe(1);
    expect(page.meta.last_accessed).toBe(new Date().toISOString().slice(0, 10));
  });

  test("bumpCount increments append with correct weight", async () => {
    await createWikiPage(vaultDir, { title: "Append Bump", project: "p", body: "hello" });
    bumpCount(vaultDir, "Append Bump", "p", "append");
    bumpCount(vaultDir, "Append Bump", "p", "append");
    const page = getWikiPage(vaultDir, "Append Bump", "p");
    expect(page.meta.count_append).toBe(2);
    expect(page.meta.importance).toBe(4); // 2×2
  });

  test("bumpCount increments search_hit without updating last_accessed", async () => {
    await createWikiPage(vaultDir, { title: "Hit Test", project: "p", body: "hello" });
    bumpCount(vaultDir, "Hit Test", "p", "search_hit");
    const page = getWikiPage(vaultDir, "Hit Test", "p");
    expect(page.meta.count_search_hit).toBe(1);
    expect(page.meta.hit_count).toBe(1);
    expect(page.meta.last_accessed).toBe(""); // search hits don't update last_accessed
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/wiki.test.ts -t "Wiki importance tracking"`
Expected: FAIL — bumpCount and recalcImportance not exported

- [ ] **Step 3: Implement recalcImportance**

Add to `src/wiki.ts` after the parseFrontmatter function:

```typescript
const IMPORTANCE_WEIGHTS: Record<string, number> = {
  count_show: 1,
  count_append: 2,
  count_update: 1,
  count_link: 1,
  count_merge: 3,
};

export function recalcImportance(meta: WikiMeta): WikiMeta {
  const importance =
    meta.count_show * IMPORTANCE_WEIGHTS.count_show! +
    meta.count_append * IMPORTANCE_WEIGHTS.count_append! +
    meta.count_update * IMPORTANCE_WEIGHTS.count_update! +
    meta.count_link * IMPORTANCE_WEIGHTS.count_link! +
    meta.count_merge * IMPORTANCE_WEIGHTS.count_merge!;
  const hit_count = meta.count_search_hit + meta.count_query_hit;
  return { ...meta, importance, hit_count };
}
```

- [ ] **Step 4: Implement bumpCount**

Add to `src/wiki.ts`:

```typescript
type CountAction = "show" | "append" | "update" | "link" | "merge" | "search_hit" | "query_hit";

const DIRECT_ACTIONS: Set<CountAction> = new Set(["show", "append", "update", "link", "merge"]);

export function bumpCount(vaultDir: string, title: string, project: string, action: CountAction): void {
  const page = getWikiPage(vaultDir, title, project);
  const meta = { ...page.meta };
  const key = `count_${action}` as keyof WikiMeta;
  (meta as any)[key] = ((meta as any)[key] as number) + 1;

  // Only update last_accessed for direct actions (not search/query hits)
  if (DIRECT_ACTIONS.has(action)) {
    meta.last_accessed = today();
  }

  const updated = recalcImportance(meta);
  const fm = buildFrontmatter(updated);
  const content = `${fm}\n${page.body}`;
  atomicWrite(page.filePath, content);
}
```

Also export `CountAction` type.

- [ ] **Step 5: Run tests**

Run: `npx vitest run test/wiki.test.ts -t "Wiki importance tracking"`
Expected: PASS

- [ ] **Step 6: Run all wiki tests to check nothing broke**

Run: `npx vitest run test/wiki.test.ts --reporter=verbose`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add src/wiki.ts test/wiki.test.ts
git commit -m "feat(wiki): add bumpCount and recalcImportance functions"
```

---

### Task 4: Add resetImportance

**Files:**
- Modify: `src/wiki.ts` (add resetImportance function)
- Test: `test/wiki.test.ts`

- [ ] **Step 1: Write failing tests**

Add to the "Wiki importance tracking" describe block:

```typescript
test("resetImportance resets importance counts only", async () => {
  await createWikiPage(vaultDir, { title: "Reset Test", project: "p", body: "hello" });
  bumpCount(vaultDir, "Reset Test", "p", "show");
  bumpCount(vaultDir, "Reset Test", "p", "show");
  bumpCount(vaultDir, "Reset Test", "p", "search_hit");
  bumpCount(vaultDir, "Reset Test", "p", "search_hit");
  bumpCount(vaultDir, "Reset Test", "p", "search_hit");

  resetImportance(vaultDir, { project: "p", allCounts: false });

  const page = getWikiPage(vaultDir, "Reset Test", "p");
  expect(page.meta.count_show).toBe(0);
  expect(page.meta.importance).toBe(0);
  // hit counts preserved
  expect(page.meta.count_search_hit).toBe(3);
  expect(page.meta.hit_count).toBe(3);
  // last_accessed preserved
  expect(page.meta.last_accessed).not.toBe("");
});

test("resetImportance --all-counts resets everything", async () => {
  await createWikiPage(vaultDir, { title: "Full Reset", project: "p", body: "hello" });
  bumpCount(vaultDir, "Full Reset", "p", "show");
  bumpCount(vaultDir, "Full Reset", "p", "search_hit");

  resetImportance(vaultDir, { project: "p", allCounts: true });

  const page = getWikiPage(vaultDir, "Full Reset", "p");
  expect(page.meta.count_show).toBe(0);
  expect(page.meta.count_search_hit).toBe(0);
  expect(page.meta.importance).toBe(0);
  expect(page.meta.hit_count).toBe(0);
});

test("resetImportance with --all resets all projects", async () => {
  await createWikiPage(vaultDir, { title: "P1 Page", project: "proj1", body: "a" });
  await createWikiPage(vaultDir, { title: "P2 Page", project: "proj2", body: "b" });
  bumpCount(vaultDir, "P1 Page", "proj1", "show");
  bumpCount(vaultDir, "P2 Page", "proj2", "append");

  resetImportance(vaultDir, { allCounts: false }); // no project = all projects

  expect(getWikiPage(vaultDir, "P1 Page", "proj1").meta.count_show).toBe(0);
  expect(getWikiPage(vaultDir, "P2 Page", "proj2").meta.count_append).toBe(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/wiki.test.ts -t "resetImportance"`
Expected: FAIL — resetImportance not exported

- [ ] **Step 3: Implement resetImportance**

Add to `src/wiki.ts`:

```typescript
export type ResetOpts = {
  project?: string;  // undefined = all projects
  allCounts: boolean; // true = reset everything, false = importance only
};

export function resetImportance(vaultDir: string, opts: ResetOpts): number {
  const pages = listWikiPages(vaultDir, { project: opts.project });
  let count = 0;

  for (const pageMeta of pages) {
    const content = readFileSync(pageMeta.filePath, "utf-8");
    const { meta, body } = parseFrontmatter(content);

    // Reset importance-related counts
    meta.count_show = 0;
    meta.count_append = 0;
    meta.count_update = 0;
    meta.count_link = 0;
    meta.count_merge = 0;

    if (opts.allCounts) {
      meta.count_search_hit = 0;
      meta.count_query_hit = 0;
    }

    const updated = recalcImportance(meta);
    const fm = buildFrontmatter(updated);
    atomicWrite(pageMeta.filePath, `${fm}\n${body}`);
    count++;
  }

  return count;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/wiki.test.ts -t "resetImportance"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/wiki.ts test/wiki.test.ts
git commit -m "feat(wiki): add resetImportance function"
```

---

### Task 5: Add findSimilar for similarity detection

**Files:**
- Modify: `src/wiki.ts` (add findSimilar function)
- Test: `test/wiki.test.ts`

- [ ] **Step 1: Write failing tests**

Add a new describe block in `test/wiki.test.ts`:

```typescript
describe("Wiki similarity detection", () => {
  let vaultDir: string;
  let store: Store;

  beforeEach(() => {
    vaultDir = mkdtempSync(join(tmpdir(), "wiki-similar-"));
    store = createStore(join(vaultDir, "test-index.sqlite"));
  });

  afterEach(() => {
    store.close();
    if (vaultDir && existsSync(vaultDir)) rmSync(vaultDir, { recursive: true });
  });

  test("findSimilar returns matching wiki page by title", async () => {
    await createWikiPage(vaultDir, {
      title: "JWT 인증 흐름",
      project: "demo",
      body: "토큰 만료 갱신 로직",
      store,
    });

    const results = await findSimilar(store, "demo", "JWT 토큰 갱신", "만료 시 리프레시");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.title).toBe("JWT 인증 흐름");
  });

  test("findSimilar returns empty when no wiki pages indexed", async () => {
    const results = await findSimilar(store, "demo", "Some title", "Some body");
    expect(results).toEqual([]);
  });

  test("findSimilar returns empty for unrelated content", async () => {
    await createWikiPage(vaultDir, {
      title: "Docker 배포 설정",
      project: "demo",
      body: "컨테이너 오케스트레이션",
      store,
    });

    const results = await findSimilar(store, "demo", "요리 레시피", "파스타 만드는 법");
    expect(results).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/wiki.test.ts -t "Wiki similarity detection"`
Expected: FAIL — findSimilar not exported

- [ ] **Step 3: Implement findSimilar**

Add to `src/wiki.ts`:

```typescript
import { searchFTS } from "./store.js";

export type SimilarResult = {
  title: string;
  project: string;
  score: number;
  filePath: string;
};

export async function findSimilar(
  store: Store,
  project: string,
  title: string,
  body?: string,
): Promise<SimilarResult[]> {
  const db = store.db;

  // Search by title (weighted ×2)
  const titleResults = await searchFTS(db, title, 3, WIKI_COLLECTION);
  // Search by body
  const bodyResults = body ? await searchFTS(db, body, 3, WIKI_COLLECTION) : [];

  // Filter to wiki collection in same project, merge scores
  // Use collectionName (not filepath) to identify wiki results,
  // and displayPath (format: "{project}/{slug}.md") for project filtering
  const scoreMap = new Map<string, { score: number; title: string; displayPath: string }>();

  for (const r of titleResults) {
    if (r.collectionName !== "wiki") continue;
    if (!r.displayPath.startsWith(`${project}/`)) continue;
    const key = r.displayPath;
    const existing = scoreMap.get(key);
    const titleScore = r.score * 2; // title weight ×2
    if (existing) {
      existing.score += titleScore;
    } else {
      scoreMap.set(key, { score: titleScore, title: r.title, displayPath: r.displayPath });
    }
  }

  for (const r of bodyResults) {
    if (r.collectionName !== "wiki") continue;
    if (!r.displayPath.startsWith(`${project}/`)) continue;
    const key = r.displayPath;
    const existing = scoreMap.get(key);
    if (existing) {
      existing.score += r.score;
    } else {
      scoreMap.set(key, { score: r.score, title: r.title, displayPath: r.displayPath });
    }
  }

  // Filter by threshold and sort by score descending
  const SIMILARITY_THRESHOLD = 0.5; // Tunable starting point, may need adjustment with real data
  const threshold = SIMILARITY_THRESHOLD;
  return [...scoreMap.values()]
    .filter((r) => r.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .map((r) => ({
      title: r.title,
      project,
      score: r.score,
      filePath: r.displayPath,
    }));
}
```

Note: The threshold of 0.5 is a starting point. The FTS BM25 scores vary. This may need tuning after testing with real data. For the test, we rely on title overlap producing a score above threshold.

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/wiki.test.ts -t "Wiki similarity detection"`
Expected: PASS (the "unrelated content" test may need threshold adjustment — if it fails, lower/raise threshold or accept that BM25 scores for Korean may differ)

- [ ] **Step 5: Commit**

```bash
git add src/wiki.ts test/wiki.test.ts
git commit -m "feat(wiki): add findSimilar for wiki page similarity detection"
```

---

### Task 6: Wire bumpCount into CLI show/update/link handlers

**Files:**
- Modify: `src/cli/wiki.ts`
- Test: `test/wiki-cli.test.ts`

- [ ] **Step 1: Write test for --no-count flag behavior**

Add to `test/wiki.test.ts` in the "Wiki importance tracking" describe block:

```typescript
test("bumpCount can be skipped (simulating --no-count)", async () => {
  await createWikiPage(vaultDir, { title: "No Count Test", project: "p", body: "hello" });
  // Show the page without bumping (simulates --no-count flag)
  const page = getWikiPage(vaultDir, "No Count Test", "p");
  expect(page.meta.count_show).toBe(0);
  expect(page.meta.importance).toBe(0);
  // Now bump once to verify the mechanism works
  bumpCount(vaultDir, "No Count Test", "p", "show");
  const after = getWikiPage(vaultDir, "No Count Test", "p");
  expect(after.meta.count_show).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it passes** (validates library-level logic from Task 3)

Run: `npx vitest run test/wiki.test.ts -t "No Count Test"`
Expected: PASS

- [ ] **Step 3: Wire bumpCount into CLI show handler**

In `src/cli/wiki.ts`, import `bumpCount` and add to the `show` case after getting the page:

```typescript
case "show": {
  const title = args[1];
  if (!title) { console.error("Usage: hwicortex wiki show <title> --project <name>"); process.exit(1); }
  const project = flags.project as string;
  if (!project) { console.error("Error: --project is required"); process.exit(1); }

  const page = getWikiPage(vaultDir, title, project);
  if (flags.json) {
    console.log(JSON.stringify(page.meta, null, 2));
  } else {
    console.log(page.body);
  }

  // Bump count unless --no-count
  if (!flags["no-count"]) {
    bumpCount(vaultDir, title, project, "show");
  }
  break;
}
```

- [ ] **Step 4: Wire bumpCount into CLI update handler**

In the `update` case, after the `updateWikiPage` call:

```typescript
// Bump count unless --no-count
if (!flags["no-count"]) {
  const action = (flags.append ? "append" : "update") as CountAction;
  bumpCount(vaultDir, title, project, action);
}
```

- [ ] **Step 5: Wire bumpCount into CLI link handler**

In the `link` case, after the `linkPages` call:

```typescript
// Bump count for both pages
if (!flags["no-count"]) {
  bumpCount(vaultDir, titleA, project, "link");
  bumpCount(vaultDir, titleB, project, "link");
}
```

- [ ] **Step 6: Add import for bumpCount and CountAction**

At the top of `src/cli/wiki.ts`:

```typescript
import {
  createWikiPage,
  getWikiPage,
  listWikiPages,
  updateWikiPage,
  removeWikiPage,
  linkPages,
  unlinkPages,
  getLinks,
  generateIndex,
  bumpCount,
  type CountAction,
} from "../wiki.js";
```

- [ ] **Step 7: Run all wiki tests**

Run: `npx vitest run test/wiki.test.ts test/wiki-cli.test.ts --reporter=verbose`
Expected: ALL PASS

- [ ] **Step 8: Commit**

```bash
git add src/cli/wiki.ts
git commit -m "feat(wiki): wire bumpCount into show/update/link CLI handlers"
```

---

### Task 7: Add reset-importance CLI subcommand

**Files:**
- Modify: `src/cli/wiki.ts`
- Test: `test/wiki.test.ts` (library-level tests already done in Task 4)

- [ ] **Step 1: Add reset-importance case to switch**

In `src/cli/wiki.ts`, add before the `default` case:

```typescript
case "reset-importance": {
  const project = flags.project as string | undefined;
  if (!project && !flags.all) {
    console.error("Usage: hwicortex wiki reset-importance --project <name> or --all");
    process.exit(1);
  }
  const allCounts = !!flags["all-counts"];
  const count = resetImportance(vaultDir, {
    project: flags.all ? undefined : project,
    allCounts,
  });
  const scope = allCounts ? "all counts" : "importance";
  console.log(`Reset ${scope} for ${count} page(s).`);
  break;
}
```

- [ ] **Step 2: Add resetImportance to imports**

Add `resetImportance` to the import from `"../wiki.js"`.

- [ ] **Step 3: Update usage help**

Add to the usage lines:

```typescript
console.error("  hwicortex wiki reset-importance --project <name> | --all [--all-counts]");
```

- [ ] **Step 4: Run all tests**

Run: `npx vitest run test/wiki.test.ts test/wiki-cli.test.ts --reporter=verbose`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/wiki.ts
git commit -m "feat(wiki): add reset-importance CLI subcommand"
```

---

### Task 8: Add similarity detection + merge to wiki create

**Files:**
- Modify: `src/cli/wiki.ts` (create case)
- Modify: `src/wiki.ts` (add mergeIntoPage helper)
- Test: `test/wiki.test.ts`

- [ ] **Step 1: Write failing test for mergeIntoPage**

Add to `test/wiki.test.ts`:

```typescript
describe("Wiki merge", () => {
  let vaultDir: string;

  beforeEach(() => {
    vaultDir = mkdtempSync(join(tmpdir(), "wiki-merge-"));
  });

  afterEach(() => {
    if (vaultDir && existsSync(vaultDir)) rmSync(vaultDir, { recursive: true });
  });

  test("mergeIntoPage appends content with merge marker", async () => {
    await createWikiPage(vaultDir, { title: "Target", project: "p", tags: ["auth"], body: "original" });
    await mergeIntoPage(vaultDir, "Target", "p", {
      sourceTitle: "New Page",
      body: "new content",
      tags: ["jwt"],
    });

    const page = getWikiPage(vaultDir, "Target", "p");
    expect(page.body).toContain("original");
    expect(page.body).toContain("new content");
    expect(page.body).toContain('병합됨: "New Page"');
    expect(page.meta.count_merge).toBe(1);
    expect(page.meta.importance).toBe(3); // merge ×3
    expect(page.meta.tags).toContain("auth");
    expect(page.meta.tags).toContain("jwt");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/wiki.test.ts -t "mergeIntoPage"`
Expected: FAIL

- [ ] **Step 3: Implement mergeIntoPage**

Add to `src/wiki.ts`:

```typescript
export type MergeOpts = {
  sourceTitle: string;
  body: string;
  tags?: string[];
  store?: Store; // Optional: re-index merged content in FTS
};

export async function mergeIntoPage(vaultDir: string, targetTitle: string, project: string, opts: MergeOpts): Promise<void> {
  const page = getWikiPage(vaultDir, targetTitle, project);
  const meta = { ...page.meta };

  // Append body with merge marker
  const mergeDate = today();
  const mergeSection = `\n---\n> 병합됨: "${opts.sourceTitle}" (${mergeDate})\n\n${opts.body}\n`;
  const body = page.body.trimEnd() + "\n" + mergeSection;

  // Merge tags (deduplicate)
  if (opts.tags && opts.tags.length > 0) {
    const tagSet = new Set([...meta.tags, ...opts.tags]);
    meta.tags = [...tagSet];
  }

  // Bump merge count
  meta.count_merge += 1;
  meta.last_accessed = mergeDate;
  meta.updated = mergeDate;

  const updated = recalcImportance(meta);
  const fm = buildFrontmatter(updated);
  const content = `${fm}\n${body}`;
  atomicWrite(page.filePath, content);

  // Re-index in FTS so merged content is searchable
  if (opts.store) {
    ensureWikiCollection(opts.store, vaultDir);
    const slug = toWikiSlug(targetTitle);
    await indexWikiPage(opts.store, project, `${slug}.md`, targetTitle, content);
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/wiki.test.ts -t "mergeIntoPage"`
Expected: PASS

- [ ] **Step 5: Wire similarity detection into CLI create handler**

In `src/cli/wiki.ts`, update the `create` case:

```typescript
case "create": {
  const title = args[1];
  if (!title) { console.error("Usage: hwicortex wiki create <title> --project <name>"); process.exit(1); }
  const project = flags.project as string;
  if (!project) { console.error("Error: --project is required"); process.exit(1); }
  const tags = flags.tags ? (flags.tags as string).split(",").map(t => t.trim()) : [];
  const sources = flags.source ? [flags.source as string] : [];
  let body = flags.body as string | undefined;
  if (flags.stdin) body = readStdin();

  // Similarity detection (skip with --force, requires store)
  if (!flags.force && store) {
    const similar = await findSimilar(store, project, title, body);
    if (similar.length > 0) {
      const top = similar[0]!;
      const isTTY = process.stdin.isTTY;
      const autoMerge = !!flags["auto-merge"];

      if (autoMerge) {
        // Auto merge
        await mergeIntoPage(vaultDir, top.title, project, { sourceTitle: title, body: body || "", tags, store });
        console.log(`✓ "${top.title}"에 내용 병합 (importance: ${getWikiPage(vaultDir, top.title, project).meta.importance})`);
        break;
      }

      if (isTTY) {
        // Interactive prompt
        console.error(`⚠ 유사 페이지 발견: "${top.title}" (score: ${top.score.toFixed(2)})`);
        process.stderr.write("  병합할까요? [Y/n]: ");
        // Read single line from stdin
        const answer = await new Promise<string>((resolve) => {
          const rl = require("readline").createInterface({ input: process.stdin, output: process.stderr });
          rl.question("", (ans: string) => { rl.close(); resolve(ans.trim()); });
        });

        if (answer === "" || answer.toLowerCase() === "y") {
          await mergeIntoPage(vaultDir, top.title, project, { sourceTitle: title, body: body || "", tags, store });
          console.log(`✓ "${top.title}"에 내용 병합 (importance: ${getWikiPage(vaultDir, top.title, project).meta.importance})`);
          break;
        }
        // User said N — fall through to create + auto-link
        const filePath = await createWikiPage(vaultDir, { title, project, tags, sources, body, store });
        linkPages(vaultDir, title, top.title, project);
        console.log(`Created: ${filePath} (linked to "${top.title}")`);
        break;
      }

      // Non-TTY, no --auto-merge: warn and create new page
      console.error(`⚠ 유사 페이지 발견: "${top.title}" (score: ${top.score.toFixed(2)}) — 새 페이지로 생성합니다 (--auto-merge 로 자동 병합 가능)`);
    }
  }

  // Default: create new page
  const filePath = await createWikiPage(vaultDir, { title, project, tags, sources, body, store });
  console.log(`Created: ${filePath}`);
  break;
}
```

- [ ] **Step 6: Add findSimilar and mergeIntoPage to imports**

```typescript
import {
  // ... existing imports ...
  findSimilar,
  mergeIntoPage,
} from "../wiki.js";
```

- [ ] **Step 7: Run all tests**

Run: `npx vitest run test/wiki.test.ts test/wiki-cli.test.ts --reporter=verbose`
Expected: ALL PASS

- [ ] **Step 8: Commit**

```bash
git add src/wiki.ts src/cli/wiki.ts test/wiki.test.ts
git commit -m "feat(wiki): add similarity detection and merge on wiki create"
```

---

### Task 9: Wire search/query hit_count into CLI

**Files:**
- Modify: `src/cli/qmd.ts` (search and query cases)

- [ ] **Step 1: Identify the search result post-processing point**

In `src/cli/qmd.ts`, after `searchFTS` is called (~line 2239) and results are filtered, the results contain `collectionName` field. Wiki results have `collectionName === "wiki"`.

- [ ] **Step 2: Add bumpHitCount helper to qmd.ts**

Near the search handling section in `src/cli/qmd.ts`, add an import for `bumpCount` and a helper:

```typescript
import { bumpCount } from "../wiki.js";

function bumpWikiHitCounts(results: SearchResult[], hitType: "search_hit" | "query_hit", vaultDir: string): void {
  for (const r of results) {
    if (r.collectionName !== "wiki") continue;
    // Extract project and title from filepath: wiki/{project}/{slug}.md
    const parts = r.displayPath.split("/");
    if (parts.length < 2) continue;
    try {
      bumpCount(vaultDir, r.title, parts[0]!, hitType);
    } catch {
      // Ignore — wiki page may not exist on disk
    }
  }
}
```

- [ ] **Step 3: Call bumpWikiHitCounts after search results are produced**

In the `search` case, after results are filtered and before outputResults is called, add:

```typescript
const vaultDir = process.env.QMD_VAULT_DIR;
if (!cli.flags["no-count"] && vaultDir) {
  bumpWikiHitCounts(results, "search_hit", vaultDir);
}
```

Similarly in the `query` case after results are produced, use `"query_hit"` instead of `"search_hit"`.

Note: `QMD_VAULT_DIR` env var is the standard way to resolve vault dir (used in `src/cli/wiki.ts:getVaultDir`). If unset, skip hit counting silently.

- [ ] **Step 4: Run existing search tests to check nothing broke**

Run: `npx vitest run test/ --reporter=verbose`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/qmd.ts
git commit -m "feat(wiki): bump hit_count for wiki pages in search/query results"
```

---

### Task 10: Update CLAUDE.md with new commands

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add new commands to CLAUDE.md wiki section**

Add under the Wiki Commands section:

```markdown
hwicortex wiki reset-importance --project <name> | --all [--all-counts]
```

Add a new section for wiki options/flags:

```markdown
### Wiki Options
- `--no-count`: Skip importance/hit count tracking (for scripts/automation)
- `--auto-merge`: Auto-merge into similar page on create (for MCP/SDK)
- `--force`: Skip similarity check on create
- `--all-counts`: Reset all counts including hit_count (for reset-importance)
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add wiki importance commands and flags to CLAUDE.md"
```

---

### Task 11: Write Obsidian visualization guide

**Files:**
- Create: `vault/wiki/obsidian-importance-guide.md`

- [ ] **Step 1: Write the guide**

Create `vault/wiki/obsidian-importance-guide.md` with the Dataview examples from the spec (section 5). This is a reference document for users, not code.

Include:
- Dataview TABLE query for importance dashboard
- Dataview JS bar chart
- Graph View tips (Juggl plugin)
- Insight interpretation table

- [ ] **Step 2: Commit**

```bash
git add vault/wiki/obsidian-importance-guide.md
git commit -m "docs: add Obsidian importance visualization guide"
```
