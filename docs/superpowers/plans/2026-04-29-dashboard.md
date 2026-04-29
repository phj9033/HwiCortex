# HwiCortex Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `hwicortex dashboard` command that opens a local browser-based dashboard summarizing collections, wiki pages, and operational health, with FTS5 keyword search and read-only drill-down.

**Architecture:** A single new file (`src/cli/dashboard.ts`) hosts a `Bun.serve()` HTTP server bound to `127.0.0.1:7777` and an inline single-page HTML/CSS/JS app. Data is read live from the existing SQLite index and `~/.config/qmd/index.yml` — no new tables, no caching. Drill-down uses hash routing within one HTML document.

**Tech Stack:** Bun, `bun:sqlite` (via existing `src/store.ts`), `Bun.serve()` for HTTP, vanilla JS + CSS in browser, Vitest for tests, no new npm dependencies.

**Spec reference:** `docs/superpowers/specs/2026-04-29-dashboard-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/cli/dashboard.ts` | Create | Data helpers + alert detection + HTML template + `Bun.serve()` server + browser open. Single file by design (spec §4). |
| `src/cli/qmd.ts` | Modify | Add `case "dashboard":` dispatch around line 3026 (alongside `"collection"`). |
| `test/dashboard/data.test.ts` | Create | Unit tests for `getOverview`, `getTags`, `getCollectionDetail`, `getWikiPageDetail`. |
| `test/dashboard/alerts.test.ts` | Create | Unit tests for all 5 alert codes. Highest correctness priority. |
| `test/dashboard/search.test.ts` | Create | Unit tests for the FTS search wrapper, including Korean and special characters. |
| `test/dashboard/server.test.ts` | Create | HTTP integration tests against a live `Bun.serve()` instance on a random port. |
| `test/dashboard/fixtures/` | Create | Helpers to build a temp SQLite DB + temp vault dir for tests. |

Internally `dashboard.ts` is organized as: `// === DATA ===` (helpers) → `// === ALERTS ===` → `// === SEARCH ===` → `// === HTML ===` (template literal) → `// === SERVER ===` (`Bun.serve` + `runDashboard()`). Functions used by tests are exported from the same file.

**Existing helpers to reuse (do not reinvent):**
- `getStoreCollections(db)` — `src/store.ts:888`
- `getStoreContexts(db)` — `src/store.ts:905`
- `searchFTS(db, query, limit, collectionName, sourceType)` — `src/store.ts:3012` (handles mecab-ko)
- `listWikiPages(vaultDir)` — `src/wiki.ts:367`
- `getWikiPage(vaultDir, title, project)` — `src/wiki.ts:355`
- `parseFrontmatter(content)` — `src/wiki.ts:179`
- `createStore(dbPath?)` — `src/store.ts:1596`

---

## Task 1: CLI scaffolding & dispatch

**Files:**
- Create: `src/cli/dashboard.ts`
- Modify: `src/cli/qmd.ts` (add case branch)
- Test: `test/dashboard/server.test.ts` (skeleton)

- [ ] **Step 1: Write failing test — dispatch reaches dashboard module**

Create `test/dashboard/server.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { runDashboard } from "../../src/cli/dashboard.js";

describe("runDashboard", () => {
  it("is a function", () => {
    expect(typeof runDashboard).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --reporter=verbose test/dashboard/server.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create stub `dashboard.ts`**

```ts
// src/cli/dashboard.ts
export type DashboardOptions = { port: number; open: boolean };

export async function runDashboard(_opts: DashboardOptions): Promise<void> {
  throw new Error("not implemented");
}
```

- [ ] **Step 4: Wire into `qmd.ts`**

In `src/cli/qmd.ts`, near the `case "collection":` block (~line 3026), add:

```ts
case "dashboard": {
  const port = Number(cli.values.port ?? 7777);
  const open = cli.values["no-open"] !== true;
  const { runDashboard } = await import("./dashboard.js");
  await runDashboard({ port, open });
  break;
}
```

Also register the flags in the existing `parseArgs` options object near the top of `qmd.ts` (search for `parseArgs` or `options:` to locate it). Add `port: { type: "string" }` and `"no-open": { type: "boolean" }` so `cli.values.port` and `cli.values["no-open"]` are populated. Without registering them, the values will be `undefined` regardless of CLI input.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/dashboard/server.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/cli/dashboard.ts src/cli/qmd.ts test/dashboard/server.test.ts
git commit -m "feat(dashboard): scaffold dashboard CLI command and module"
```

---

## Task 2: Test fixtures helper

**Files:**
- Create: `test/dashboard/fixtures.ts`

- [ ] **Step 1: Write the helpers**

```ts
// test/dashboard/fixtures.ts
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore, type Store } from "../../src/store.js";

export function makeTempVault(): string {
  const dir = mkdtempSync(join(tmpdir(), "hwicortex-dash-vault-"));
  mkdirSync(join(dir, "wiki", "bb3wiki"), { recursive: true });
  return dir;
}

export function makeTempStore(): { store: Store; dbPath: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "hwicortex-dash-db-"));
  const dbPath = join(dir, "index.sqlite");
  process.env.INDEX_PATH = dbPath;
  const store = createStore(dbPath);
  return { store, dbPath, cleanup: () => store.db.close() };
}

export function writeWikiPage(
  vaultDir: string,
  project: string,
  title: string,
  body: string,
  meta: Record<string, unknown> = {}
): string {
  const slug = title.toLowerCase().replace(/[^\w가-힣]+/g, "-");
  const path = join(vaultDir, "wiki", project, `${slug}.md`);
  const fm = ["---", `title: ${title}`, `project: ${project}`, ...Object.entries(meta).map(([k, v]) => `${k}: ${JSON.stringify(v)}`), "---", "", body].join("\n");
  writeFileSync(path, fm);
  return path;
}
```

- [ ] **Step 2: Sanity check (no test yet, just import)**

Run: `npx tsc --noEmit -p tsconfig.json` to verify types.

- [ ] **Step 3: Commit**

```bash
git add test/dashboard/fixtures.ts
git commit -m "test(dashboard): add fixtures helper for vault and store"
```

---

## Task 3: `getOverview()` — vault summary + collections + wiki activity

**Files:**
- Modify: `src/cli/dashboard.ts`
- Test: `test/dashboard/data.test.ts`

Schema is in spec §5. This task does **not** include alerts (Task 6) — populate `alerts: []` for now.

- [ ] **Step 1: Write failing test**

```ts
// test/dashboard/data.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { getOverview } from "../../src/cli/dashboard.js";
import { makeTempStore, makeTempVault, writeWikiPage } from "./fixtures.js";

describe("getOverview", () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => { cleanup?.(); cleanup = null; });

  it("returns vault counters and wiki activity", () => {
    const { store, cleanup: c } = makeTempStore();
    cleanup = c;
    const vault = makeTempVault();
    writeWikiPage(vault, "p1", "Page A", "body", { tags: ["x"], importance: 6, hit_count: 10 });
    writeWikiPage(vault, "p1", "Page B", "body", { tags: ["y"], importance: 1, hit_count: 0 });

    const result = getOverview(store, vault);

    expect(result.vault.path).toBe(vault);
    expect(result.vault.totalWikiPages).toBe(2);
    expect(result.wiki.recent.length).toBeGreaterThan(0);
    expect(result.wiki.topHits[0].hit_count).toBe(10);
    expect(result.wiki.highImportance.some(p => p.title === "Page A")).toBe(true);
    expect(result.alerts).toEqual([]); // alerts come in Task 6
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/dashboard/data.test.ts`
Expected: FAIL — `getOverview` not exported.

- [ ] **Step 3: Read `listWikiPages` return type before implementing**

Open `src/wiki.ts:367` and inspect the returned object shape. Field names below (`w.meta.tags`, `w.slug`, `w.filename`) are best-guesses — replace with actual fields. Do this **before** writing the implementation to avoid a rewrite.

- [ ] **Step 4: Implement `getOverview()`**

In `dashboard.ts` (after the stub):

```ts
import type { Store } from "../store.js";
import { getStoreCollections } from "../store.js";
import { listWikiPages } from "../wiki.js";

export type WikiPageMeta = {
  title: string; project: string; slug: string;
  tags: string[]; importance: number; hit_count: number; updated: string;
};

export type Overview = {
  vault: { path: string; totalDocs: number; totalCollections: number; totalWikiPages: number; lastUpdate: string | null };
  alerts: never[];
  collections: Array<{ name: string; path: string; pattern: string; fileCount: number; lastUpdate: string | null; hasContext: boolean; overlapsWith: string[] }>;
  wiki: { recent: WikiPageMeta[]; topHits: WikiPageMeta[]; highImportance: WikiPageMeta[] };
};

export function getOverview(store: Store, vaultDir: string): Overview {
  const db = store.db;
  const collections = getStoreCollections(db);
  const wiki = listWikiPages(vaultDir);

  const totalDocs = (db.prepare("SELECT COUNT(*) AS n FROM documents WHERE active=1").get() as { n: number }).n;
  const lastUpdate = (db.prepare("SELECT MAX(updated_at) AS t FROM documents WHERE active=1").get() as { t: string | null }).t;

  const wikiMeta: WikiPageMeta[] = wiki.map(w => ({
    title: w.meta.title, project: w.meta.project, slug: w.slug ?? w.filename.replace(/\.md$/, ""),
    tags: w.meta.tags ?? [], importance: w.meta.importance ?? 0, hit_count: w.meta.hit_count ?? 0,
    updated: w.meta.updated ?? "",
  }));

  const collectionRows = collections.map(c => {
    const fileCount = (db.prepare("SELECT COUNT(*) AS n FROM documents WHERE collection=? AND active=1").get(c.name) as { n: number }).n;
    const lu = (db.prepare("SELECT MAX(updated_at) AS t FROM documents WHERE collection=? AND active=1").get(c.name) as { t: string | null }).t;
    return { name: c.name, path: c.path, pattern: c.pattern ?? "**/*.md", fileCount, lastUpdate: lu, hasContext: Boolean(c.context && Object.keys(c.context).length > 0), overlapsWith: [] as string[] };
  });

  return {
    vault: { path: vaultDir, totalDocs, totalCollections: collections.length, totalWikiPages: wiki.length, lastUpdate },
    alerts: [],
    collections: collectionRows,
    wiki: {
      recent: [...wikiMeta].sort((a, b) => (b.updated ?? "").localeCompare(a.updated ?? "")).slice(0, 5),
      topHits: [...wikiMeta].sort((a, b) => b.hit_count - a.hit_count).slice(0, 10),
      highImportance: wikiMeta.filter(w => w.importance >= 5).slice(0, 5),
    },
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/dashboard/data.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/cli/dashboard.ts test/dashboard/data.test.ts
git commit -m "feat(dashboard): implement getOverview data helper"
```

---

## Task 4: `getTags()` — tag aggregation across wiki pages

**Files:**
- Modify: `src/cli/dashboard.ts`
- Modify: `test/dashboard/data.test.ts`

- [ ] **Step 1: Write failing test**

Append to `data.test.ts`:

```ts
describe("getTags", () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => { cleanup?.(); cleanup = null; });

  it("aggregates tag counts across pages and projects", () => {
    const { store, cleanup: c } = makeTempStore(); cleanup = c;
    const vault = makeTempVault();
    writeWikiPage(vault, "p1", "A", "x", { tags: ["popup", "ui"] });
    writeWikiPage(vault, "p1", "B", "x", { tags: ["popup"] });
    writeWikiPage(vault, "p2", "C", "x", { tags: ["ui"] });

    const { tags } = getTags(store, vault);

    const popup = tags.find(t => t.name === "popup")!;
    expect(popup.count).toBe(2);
    expect(popup.projects).toEqual(["p1"]);
    const ui = tags.find(t => t.name === "ui")!;
    expect(ui.count).toBe(2);
    expect(ui.projects.sort()).toEqual(["p1", "p2"]);
  });
});
```

- [ ] **Step 2: Run test — verify FAIL**

- [ ] **Step 3: Implement `getTags`**

```ts
export function getTags(_store: Store, vaultDir: string): { tags: Array<{ name: string; count: number; projects: string[] }> } {
  const wiki = listWikiPages(vaultDir);
  const map = new Map<string, { count: number; projects: Set<string> }>();
  for (const w of wiki) {
    for (const tag of w.meta.tags ?? []) {
      const e = map.get(tag) ?? { count: 0, projects: new Set() };
      e.count++; e.projects.add(w.meta.project);
      map.set(tag, e);
    }
  }
  return {
    tags: [...map.entries()]
      .map(([name, v]) => ({ name, count: v.count, projects: [...v.projects].sort() }))
      .sort((a, b) => b.count - a.count),
  };
}
```

- [ ] **Step 4: Run test — PASS**

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(dashboard): implement getTags aggregation"
```

---

## Task 5: `getCollectionDetail()` and `getWikiPageDetail()`

**Files:**
- Modify: `src/cli/dashboard.ts`
- Modify: `test/dashboard/data.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
describe("getCollectionDetail", () => {
  // existence + missing case
  it("returns null for unknown collection", () => {
    const { store, cleanup } = makeTempStore();
    try { expect(getCollectionDetail(store, "nope")).toBeNull(); }
    finally { cleanup(); }
  });
});

describe("getWikiPageDetail", () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => { cleanup?.(); cleanup = null; });

  it("returns frontmatter, body, and backlinks", () => {
    const { store, cleanup: c } = makeTempStore(); cleanup = c;
    const vault = makeTempVault();
    writeWikiPage(vault, "p1", "Target", "target body");
    writeWikiPage(vault, "p1", "Source", "see [[Target]]");

    const detail = getWikiPageDetail(store, vault, "p1", "target");
    expect(detail?.meta.title).toBe("Target");
    expect(detail?.body).toContain("target body");
    expect(detail?.backlinks.some(b => b.title === "Source")).toBe(true);
  });
});
```

- [ ] **Step 2: Implement** in `dashboard.ts` using `getStoreCollections`, `documents` table, and existing `getWikiPage` + body-scan for `[[title]]` backlinks (mirror the pattern in `src/wiki.ts:521`).

- [ ] **Step 3: Run tests — PASS**

- [ ] **Step 4: Commit**

```bash
git commit -am "feat(dashboard): implement collection and wiki detail helpers"
```

---

## Task 6: Alert detection — all 5 codes

**Files:**
- Modify: `src/cli/dashboard.ts`
- Create: `test/dashboard/alerts.test.ts`

This is the highest-priority correctness surface. Each alert gets its own test case.

- [ ] **Step 1: Write failing tests for all 5 alert codes**

```ts
// test/dashboard/alerts.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { detectAlerts } from "../../src/cli/dashboard.js";
import { makeTempStore, makeTempVault, writeWikiPage } from "./fixtures.js";

describe("detectAlerts", () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => { cleanup?.(); cleanup = null; });

  it("flags overlap when one collection path is a prefix of another", () => {
    /* fixture: register two collections where path A ⊂ path B */
    /* expect alert with code === "overlap" mentioning both names */
  });

  it("does not flag overlap for disjoint paths", () => {
    /* expect no overlap alert */
  });

  it("flags no-context for collections without context entries", () => { /* ... */ });
  it("flags empty for collections with zero documents", () => { /* ... */ });
  it("flags no-embedding for active docs without vec rows", () => { /* ... */ });
  it("flags stale (aggregated) for hit_count=0 wiki pages older than 30d", () => { /* ... */ });
  it("returns empty array on a healthy fixture", () => { /* ... */ });
});
```

- [ ] **Step 2: Run tests — verify FAIL**

- [ ] **Step 3: Implement `detectAlerts`**

```ts
export type Alert = { severity: "warn" | "info"; code: string; message: string; hint?: string; items?: string[] };

export function detectAlerts(store: Store, vaultDir: string): Alert[] {
  const alerts: Alert[] = [];
  const db = store.db;
  const collections = getStoreCollections(db);

  // 1. overlap (per pair)
  for (let i = 0; i < collections.length; i++) {
    for (let j = i + 1; j < collections.length; j++) {
      const a = collections[i].path, b = collections[j].path;
      if (a === b || a.startsWith(b + "/") || b.startsWith(a + "/")) {
        alerts.push({
          severity: "warn", code: "overlap",
          message: `Collections '${collections[i].name}' and '${collections[j].name}' index overlapping paths`,
          hint: `Consider 'hwicortex collection rm' on one of them`,
        });
      }
    }
  }

  // 2. no-context (per collection)
  for (const c of collections) {
    if (!c.context || Object.keys(c.context).length === 0) {
      alerts.push({
        severity: "info", code: "no-context",
        message: `Collection '${c.name}' has no context — search ranking quality reduced`,
        hint: `hwicortex context add qmd://${c.name}/ "<description>"`,
      });
    }
  }

  // 3. empty (per collection)
  for (const c of collections) {
    const n = (db.prepare("SELECT COUNT(*) AS n FROM documents WHERE collection=? AND active=1").get(c.name) as { n: number }).n;
    if (n === 0) {
      alerts.push({
        severity: "warn", code: "empty",
        message: `Collection '${c.name}' is empty — path may be wrong or files missing`,
        hint: `Configured path: ${c.path}`,
      });
    }
  }

  // 4. no-embedding (aggregated count)
  const missing = (db.prepare(`
    SELECT COUNT(*) AS n FROM documents d
    WHERE d.active=1 AND NOT EXISTS (SELECT 1 FROM vec_documents v WHERE v.rowid = d.id)
  `).get() as { n: number }).n;
  if (missing > 0) {
    alerts.push({
      severity: "warn", code: "no-embedding",
      message: `${missing} documents missing embeddings — vector search incomplete`,
      hint: `hwicortex embed --collection <name>`,
    });
  }

  // 5. stale (aggregated, items list slugs)
  const wiki = listWikiPages(vaultDir);
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const staleItems = wiki
    .filter(w => (w.meta.hit_count ?? 0) === 0 && typeof w.meta.created === "string" && w.meta.created < cutoff)
    .map(w => `${w.meta.project}/${w.slug ?? w.filename.replace(/\.md$/, "")}`);
  if (staleItems.length > 0) {
    alerts.push({
      severity: "info", code: "stale",
      message: `${staleItems.length} wiki pages have never been hit (created >30d ago)`,
      items: staleItems,
    });
  }

  return alerts;
}
```

- [ ] **Step 4: Wire `detectAlerts` into `getOverview`**

Replace `alerts: []` in `getOverview` with `alerts: detectAlerts(store, vaultDir)`. Also populate `overlapsWith` on each collection card from the overlap alerts (intersect names). Update the Task 3 test to set `alerts: expect.any(Array)` since healthy temp fixture won't have alerts (or update fixture to a known set).

- [ ] **Step 5: Run all tests — PASS**

- [ ] **Step 6: Commit**

```bash
git commit -am "feat(dashboard): implement alert detection (5 codes)"
```

---

## Task 7: FTS search wrapper

**Files:**
- Modify: `src/cli/dashboard.ts`
- Create: `test/dashboard/search.test.ts`

Reuse `searchFTS(db, query, limit, collectionName, sourceType)` from `src/store.ts:3012`. The wrapper escapes user input as a phrase and shapes the response.

- [ ] **Step 1: Write failing tests**

```ts
// test/dashboard/search.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { searchDashboard } from "../../src/cli/dashboard.js";
import { makeTempStore } from "./fixtures.js";

describe("searchDashboard", () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => { cleanup?.(); cleanup = null; });

  it("returns empty results for empty/whitespace query", async () => {
    const { store, cleanup: c } = makeTempStore(); cleanup = c;
    expect((await searchDashboard(store, "")).results).toEqual([]);
    expect((await searchDashboard(store, "   ")).results).toEqual([]);
  });

  it("does not throw on special characters", async () => {
    const { store, cleanup: c } = makeTempStore(); cleanup = c;
    await expect(searchDashboard(store, 'foo "bar" *baz')).resolves.toBeDefined();
  });

  // Add: korean query test using a fixture with Korean content indexed via store.indexFile
  // Add: collection filter narrows results
});
```

- [ ] **Step 2: Run tests — FAIL**

- [ ] **Step 3: Implement**

```ts
import { searchFTS } from "../store.js";

export async function searchDashboard(
  store: Store,
  q: string,
  collection?: string,
  limit = 20,
  offset = 0,
): Promise<{ query: string; total: number; results: Array<{ collection: string; path: string; title: string | null; snippet: string; score: number }> }> {
  const trimmed = q.trim();
  if (trimmed.length === 0) return { query: q, total: 0, results: [] };

  const phrase = `"${trimmed.replace(/"/g, '""')}"`;
  // Note: read searchFTS signature in src/store.ts:3012 before this — return type and field names below are best-guesses
  const raw = await searchFTS(store.db, phrase, limit + offset, collection);
  const sliced = raw.slice(offset, offset + limit);

  return {
    query: q,
    total: raw.length,
    results: sliced.map(r => ({
      collection: r.collection, path: r.docPath ?? r.path,
      title: r.title ?? null, snippet: r.snippet ?? "", score: r.score ?? 0,
    })),
  };
}
```

Adjust field names after reading `searchFTS`'s return type — fields shown are best-guesses based on `SearchResult`.

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(dashboard): add FTS search wrapper with phrase escape"
```

---

## Task 8: HTTP server — routing skeleton

**Files:**
- Modify: `src/cli/dashboard.ts`
- Modify: `test/dashboard/server.test.ts`

- [ ] **Step 1: Write failing integration tests**

```ts
// test/dashboard/server.test.ts (replace skeleton)
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startServer, type ServerHandle } from "../../src/cli/dashboard.js";
import { makeTempStore, makeTempVault } from "./fixtures.js";

let server: ServerHandle;
let baseUrl: string;
let cleanup: () => void;

beforeAll(async () => {
  const { store, cleanup: c } = makeTempStore(); cleanup = c;
  const vault = makeTempVault();
  server = await startServer({ port: 0, store, vaultDir: vault });
  baseUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(() => { server.stop(); cleanup(); });

describe("HTTP routes", () => {
  it("GET / returns HTML", async () => {
    const r = await fetch(baseUrl + "/");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/html/);
  });

  it("GET /api/overview returns JSON with vault key", async () => {
    const r = await fetch(baseUrl + "/api/overview");
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.vault).toBeDefined();
    expect(body.collections).toBeDefined();
  });

  it("GET /api/collection/<missing> returns 404", async () => {
    const r = await fetch(baseUrl + "/api/collection/does-not-exist");
    expect(r.status).toBe(404);
  });

  it("rejects path traversal in /api/wiki/", async () => {
    const r = await fetch(baseUrl + "/api/wiki/foo/..%2Fetc");
    expect(r.status).toBe(404);
  });

  it("survives a handler exception", async () => {
    // Trigger a malformed request, then verify a normal request still succeeds
    await fetch(baseUrl + "/api/wiki//"); // bad params
    const r = await fetch(baseUrl + "/api/overview");
    expect(r.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement `startServer` and route handlers**

```ts
export type ServerHandle = { port: number; stop: () => void };

export async function startServer(opts: { port: number; store: Store; vaultDir: string }): Promise<ServerHandle> {
  const { port, store, vaultDir } = opts;

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch: async (req) => {
      const url = new URL(req.url);
      try {
        if (url.pathname === "/") return new Response(renderHtml(), { headers: { "content-type": "text/html; charset=utf-8" } });
        if (url.pathname === "/api/overview") return Response.json(getOverview(store, vaultDir));
        if (url.pathname === "/api/tags") return Response.json(getTags(store, vaultDir));
        if (url.pathname === "/api/search") {
          const q = url.searchParams.get("q") ?? "";
          const coll = url.searchParams.get("collection") ?? undefined;
          const limit = Number(url.searchParams.get("limit") ?? 20);
          const offset = Number(url.searchParams.get("offset") ?? 0);
          return Response.json(await searchDashboard(store, q, coll, limit, offset));
        }
        const cm = url.pathname.match(/^\/api\/collection\/([^/]+)$/);
        if (cm) {
          const name = decodeURIComponent(cm[1]);
          if (name.includes("..") || name.includes("/")) return new Response("Not found", { status: 404 });
          const detail = getCollectionDetail(store, name);
          return detail ? Response.json(detail) : new Response(JSON.stringify({ error: "Collection not found" }), { status: 404, headers: { "content-type": "application/json" } });
        }
        const wm = url.pathname.match(/^\/api\/wiki\/([^/]+)\/([^/]+)$/);
        if (wm) {
          const project = decodeURIComponent(wm[1]); const slug = decodeURIComponent(wm[2]);
          if ([project, slug].some(s => !s || s.includes("..") || s.includes("/") || s.includes("\\"))) return new Response("Not found", { status: 404 });
          const detail = getWikiPageDetail(store, vaultDir, project, slug);
          return detail ? Response.json(detail) : new Response(JSON.stringify({ error: "Wiki page not found" }), { status: 404, headers: { "content-type": "application/json" } });
        }
        return new Response("Not found", { status: 404 });
      } catch (err) {
        console.error("[dashboard]", err);
        return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { "content-type": "application/json" } });
      }
    },
  });

  return { port: server.port, stop: () => server.stop() };
}

function renderHtml(): string { return "<!doctype html><html><body><div id=app></div></body></html>"; }
```

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(dashboard): add Bun.serve HTTP routes with path-traversal guard"
```

---

## Task 9: HTML/CSS shell + hash router

**Files:**
- Modify: `src/cli/dashboard.ts` (`renderHtml()` body)

This task and Tasks 10–14 are UI work — verified by manual checklist, not unit tests. Each commit should leave the dashboard in a working state.

- [ ] **Step 1: Replace `renderHtml()` with the full template**

Inline a single HTML document containing:
- `<style>` block (~150 lines) — flex/grid layout, cards, badges, modal, dropdown
- `<header>` with title, tabs (Overview / Tags), refresh button
- `<section id="search-bar">` with input + collection select
- `<main id="view">` populated by JS
- `<script>` (~200 lines) implementing:
  - `route()` reads `location.hash`, dispatches to `renderOverview` / `renderTags` / `renderCollection(name)` / `renderWiki(project, slug)` / `renderSearch(q, coll)`
  - `fetchJson(url)` wrapper with try/catch → renders "Failed to load. [retry]" widget on error
  - `window.addEventListener("hashchange", route)` and initial `route()`

- [ ] **Step 2: Manual smoke test**

Run: `bun src/cli/qmd.ts dashboard --port 7777`
Open `http://127.0.0.1:7777` — verify shell renders, refresh button visible, hash changes when clicking tabs.

- [ ] **Step 3: Commit**

```bash
git commit -am "feat(dashboard): add HTML shell with hash router and styling"
```

---

## Task 10: Overview view widgets (A + B + C + F)

**Files:**
- Modify: `src/cli/dashboard.ts` (`<script>` section)

- [ ] **Step 1: Implement `renderOverview()`**

Fetches `/api/overview`, then renders four sections in order (vault header, alerts (only if non-empty), collection cards 2×2, wiki activity 3-column).

- [ ] **Step 2: Manual smoke test**

Open `/` → all four widgets visible. Click a collection card → URL changes to `#collection/<name>` (next task implements the view).

- [ ] **Step 3: Commit**

```bash
git commit -am "feat(dashboard): render Overview widgets (vault, alerts, collections, wiki)"
```

---

## Task 11: Tags view + Collection detail view + Wiki page view

**Files:**
- Modify: `src/cli/dashboard.ts` (`<script>` section)

These three drill-down views share patterns; bundle into one task.

- [ ] **Step 1: Implement `renderTags`**

Fetches `/api/tags`, renders a CSS bar chart (no library): each row is `<div class=tag-row><span>name</span><div class=bar style="width:Npx"></div><span>count</span></div>`. Click a tag → navigate to `#search?q=tag:<name>` (or filtered wiki list — pick one and document inline).

- [ ] **Step 2: Implement `renderCollection(name)`**

Fetches `/api/collection/:name`, renders header + file list table. File click opens a modal showing raw markdown via `<pre>`.

- [ ] **Step 3: Implement `renderWiki(project, slug)`**

Fetches `/api/wiki/:project/:slug`. For markdown rendering: include `marked` from CDN (`<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js">`). Render `marked.parse(body)` into a sandboxed div. Show frontmatter chips (tags, importance, hit_count) and backlinks list.

- [ ] **Step 4: Manual smoke checks**

Verify each view renders against the real local vault. Backlinks clickable. Modal closes on ESC and click-outside.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(dashboard): add Tags, Collection detail, and Wiki page views"
```

---

## Task 12: Search dropdown + results page

**Files:**
- Modify: `src/cli/dashboard.ts` (`<script>` section)

- [ ] **Step 1: Implement search bar interactions**

- 200ms debounce on `input` event → `fetch /api/search?q=...&collection=...&limit=5`
- Render top 5 results in a dropdown attached to the input
- "View all N results" link → `#search?q=...`
- ESC: close dropdown, clear input
- Enter: navigate to `#search?q=...`

- [ ] **Step 2: Implement `renderSearch(q, collection)`**

Full results page with pagination (20/page, prev/next). Each result clickable → wiki or collection detail. Highlights via `<mark>` from snippet.

- [ ] **Step 3: Manual smoke test**

Type a known query (e.g., "popup") → dropdown after 200ms. Press Enter → results page. Pagination works. Empty query closes dropdown silently.

- [ ] **Step 4: Commit**

```bash
git commit -am "feat(dashboard): add search dropdown and results page"
```

---

## Task 13: `runDashboard` glue — startup, port collision, browser open

**Files:**
- Modify: `src/cli/dashboard.ts`

- [ ] **Step 1: Implement the entry point**

```ts
export async function runDashboard(opts: DashboardOptions): Promise<void> {
  const vaultDir = process.env.QMD_VAULT_DIR;
  if (!vaultDir) { console.error("Error: QMD_VAULT_DIR not set."); process.exit(1); }
  if (!existsSync(vaultDir)) { console.error(`Error: Vault path not found: ${vaultDir}`); process.exit(1); }

  let store: Store;
  try { store = createStore(); } catch { console.error("Error: Index DB not found. Run 'hwicortex collection add ...' first."); process.exit(1); return; }

  let server: ServerHandle;
  try { server = await startServer({ port: opts.port, store, vaultDir }); }
  catch (e: any) {
    if (String(e?.message ?? e).match(/EADDRINUSE|in use/i)) { console.error(`Error: Port ${opts.port} in use. Try --port <n>.`); process.exit(1); }
    throw e;
  }

  const url = `http://127.0.0.1:${server.port}`;
  console.log(`HwiCortex dashboard: ${url}`);
  if (opts.open) { try { spawnOpen(url); } catch { /* swallow — URL already printed */ } }

  process.on("SIGINT", () => { server.stop(); process.exit(0); });
  await new Promise(() => { /* keep alive until SIGINT */ });
}

function spawnOpen(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
}
```

- [ ] **Step 2: Manual end-to-end test**

Run: `bun src/cli/qmd.ts dashboard`
Expected: browser opens to localhost:7777 with full dashboard. SIGINT (Ctrl-C) shuts cleanly.

Run: `bun src/cli/qmd.ts dashboard` (twice, second in another shell)
Expected: second instance prints `Error: Port 7777 in use. Try --port <n>.`

- [ ] **Step 3: Commit**

```bash
git commit -am "feat(dashboard): runDashboard entry with browser open and port handling"
```

---

## Task 14: Full manual checklist + final polish

**Files:**
- (no code changes expected)

- [ ] **Step 1: Run the spec §9 manual checklist end-to-end**

Build & run: `bun run build && bun src/cli/qmd.ts dashboard`. Walk through every box in spec §9. For each failure, file a follow-up commit fixing the smallest possible change.

- [ ] **Step 2: Verify all unit tests pass**

Run: `npx vitest run --reporter=verbose test/dashboard/`
Expected: all tests pass.

- [ ] **Step 3: Verify build still succeeds**

Run: `bun install && bun run build`
Expected: clean compile, `dist/cli/dashboard.js` produced.

- [ ] **Step 4: Update `--help` output**

In `src/cli/qmd.ts`, ensure the help text lists `dashboard` with a one-line description and the `--port`/`--no-open` flags.

- [ ] **Step 5: CHANGELOG entry**

Append under `## [Unreleased]`:

```
- feat(dashboard): add `hwicortex dashboard` — local browser dashboard for collections, wiki activity, alerts, and FTS search
```

- [ ] **Step 6: Final commit**

```bash
git commit -am "docs: add dashboard to help text and CHANGELOG"
```

---

## Done Criteria

- All Vitest tests in `test/dashboard/` pass.
- `bun run build` succeeds.
- Manual checklist (spec §9) all green.
- `hwicortex dashboard` opens browser to a working overview that reflects the current vault.
- No new npm dependencies introduced.
- CHANGELOG updated.
