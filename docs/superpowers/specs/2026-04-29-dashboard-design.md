# HwiCortex Dashboard — Design Spec

**Date**: 2026-04-29
**Status**: Draft (pending implementation)
**Owner**: hwijung-park

## 1. Goal

Provide a single command, `hwicortex dashboard`, that opens a local browser-based dashboard summarizing the current state of HwiCortex's collections, wiki pages, and operational health. The dashboard supports drill-down into collection/wiki page details and FTS5 keyword search across all indexed content. It is **read-only** — all mutations remain on the CLI.

## 2. Non-Goals

- Editing or mutating collections / wiki pages from the browser
- Multi-user, network, or remote access
- Authentication or HTTPS
- Real-time updates (websocket/SSE) or auto-refresh polling
- Vector search, RRF, or LLM reranking in the dashboard search bar
- Charts beyond simple bar charts (no Recharts/Chart.js)
- Documentation editing flow (continues via CLI)

## 3. User-Visible Behavior

### Launch
```sh
hwicortex dashboard          # binds 127.0.0.1:7777, auto-opens default browser
hwicortex dashboard --port 8080
hwicortex dashboard --no-open
```

On startup the CLI:
1. Validates `QMD_VAULT_DIR` and the SQLite index exist; exits with a clear error otherwise.
2. Spawns `Bun.serve()` on `127.0.0.1:7777` (or `--port`).
3. Spawns `open <url>` (macOS) / `xdg-open` (linux) / `start` (windows) unless `--no-open`. Failure to spawn does not crash the server — the URL is printed to stdout.
4. Logs requests to stdout; serves until SIGINT.

### Pages (all hash-routed within a single HTML document)

| Hash | View |
|---|---|
| `#overview` (default) | Vault header + alerts + collection cards + wiki activity |
| `#tags` | Tag distribution bar chart |
| `#collection/:name` | Collection detail with file list |
| `#wiki/:project/:slug` | Wiki page rendered with backlinks |
| `#search?q=&collection=` | Search results page |

### Persistent UI Elements
- **Header**: title, tab links (Overview / Tags), refresh button.
- **Search bar**: directly under header. Debounced 200ms while typing → dropdown of top 5 results. Enter → full results page. ESC → close. Optional `collection` filter dropdown.

### Overview Widgets

1. **Vault Header (A)**: vault path, total docs, total collections, total wiki pages, last update time.
2. **Health Alerts (F)**: hidden when alerts are empty. See §6.
3. **Collection Cards (B)**: 2×2 grid. Each card: name, file count, last update, context status, overlap warning. Click → `#collection/:name`.
4. **Wiki Activity (C)**: 3 columns — Recent (5), Top hits (10), High importance (5, where `importance >= 5`). Item click → `#wiki/:project/:slug`.

### Tags View
Bar chart using HTML/CSS only (no chart library): tag name, count bar, total count. Click tag → wiki list filtered by tag.

### Drill-down Detail Views
- **Collection detail**: path, pattern, context, file list (path / title / size / mtime). File click → modal with raw markdown.
- **Wiki page detail**: frontmatter (title, project, tags, importance, hit_count), rendered markdown body, backlinks list.

## 4. Architecture

### Files
```
src/cli/dashboard.ts          NEW. Server + inline HTML/CSS/JS (~600 lines)
src/cli/qmd.ts                MODIFY. Add 'case "dashboard"' branch
test/dashboard/data.test.ts   NEW. Data collection unit tests
test/dashboard/alerts.test.ts NEW. Alert detection tests (priority)
test/dashboard/search.test.ts NEW. FTS search tests
test/dashboard/server.test.ts NEW. HTTP integration tests
```

`dashboard.ts` internal layout:
- Top ~50 lines: data collection helpers (`getOverview`, `getTags`, `getCollectionDetail`, `getWikiPageDetail`, `searchFTS`).
- Middle ~100 lines: HTML template literal with `<style>` (~150 lines) and `<script>` (~200 lines) inlined.
- Bottom ~50 lines: `Bun.serve()` router with try/catch per handler.

### Why single file
Approach 1 was chosen for minimal change and at-a-glance comprehension. At ~600 lines this remains readable; if it grows past ~1000 lines, split into `src/dashboard/{server,data,html}.ts`.

### Routes

| Route | Description |
|---|---|
| `GET /` | `index.html` (single-page app shell) |
| `GET /api/overview` | Combined payload for the Overview view (one round trip) |
| `GET /api/tags` | Tag aggregation across all wiki pages |
| `GET /api/collection/:name` | Collection metadata + file list |
| `GET /api/wiki/:project/:slug` | Wiki page metadata + body + backlinks |
| `GET /api/search?q=&collection=&limit=&offset=` | FTS5 keyword search |

### Bindings & Ports
- Default `127.0.0.1:7777`. `0.0.0.0` is **not** supported in v1 — would require an explicit `--unsafe-bind-all` flag, out of scope here.
- Port collision: exits with `Error: Port N in use. Try --port <n>.` No automatic port discovery.

## 5. Data Sources & API Schemas

All data comes from existing SQLite tables (`documents`, `documents_fts`, `vec_documents`, `store_collections`) and `~/.config/qmd/index.yml`. **No new tables, no new persistence.**

### `GET /api/overview` response
```ts
{
  vault: {
    path: string,                  // process.env.QMD_VAULT_DIR
    totalDocs: number,             // SELECT COUNT(*) FROM documents WHERE active=1
    totalCollections: number,      // listCollections().length
    totalWikiPages: number,        // listWikiPages(vaultDir).length
    lastUpdate: string,            // ISO; MAX(updated_at) across documents
  },
  alerts: Alert[],                 // §6
  collections: [{
    name: string,
    path: string,
    pattern: string,
    fileCount: number,
    lastUpdate: string,
    hasContext: boolean,
    overlapsWith: string[],        // names of other collections sharing files
  }],
  wiki: {
    recent: WikiPageMeta[],        // sorted by mtime desc, 5
    topHits: WikiPageMeta[],       // sorted by hit_count desc, 10
    highImportance: WikiPageMeta[],// importance >= 5, 5
  }
}

WikiPageMeta {
  title: string, project: string, slug: string,
  tags: string[], importance: number, hit_count: number,
  updated: string
}
```

### `GET /api/tags`
```ts
{
  tags: [{ name: string, count: number, projects: string[] }]
}
```

### `GET /api/collection/:name`
```ts
{
  name: string, path: string, pattern: string, context: string | null,
  files: [{ path: string, title: string | null, size: number, modified: string }]
}
```

### `GET /api/wiki/:project/:slug`
```ts
{
  meta: { title, project, tags, importance, hit_count, sources, created, updated },
  body: string,                    // raw markdown
  backlinks: [{ title: string, slug: string }]
}
```

Reuses existing `getWikiPage(vaultDir, title, project)` and the existing backlink computation in `src/wiki.ts`.

### `GET /api/search?q=&collection=&limit=20&offset=0`
```ts
{
  query: string,
  total: number,
  results: [{
    collection: string, path: string, title: string | null,
    snippet: string,               // FTS5 snippet() with <mark> tags
    score: number                  // bm25
  }]
}
```

Implementation: prefer reusing the existing keyword search path in `src/store.ts` (so mecab-ko Korean tokenization is consistently applied). If no suitable function exists, the SQL is:
```sql
SELECT d.collection, d.doc_path, d.title,
       snippet(documents_fts, 1, '<mark>', '</mark>', '...', 12) AS snippet,
       bm25(documents_fts) AS score
FROM documents_fts
JOIN documents d ON d.id = documents_fts.rowid
WHERE documents_fts MATCH ?
  AND d.active = 1
  AND (? IS NULL OR d.collection = ?)
ORDER BY score
LIMIT ? OFFSET ?;
```

User input is wrapped as a phrase (`"..."`) before passing to `MATCH` to avoid FTS5 syntax errors on special characters.

### Caching
None. Each request hits SQLite. Dashboard usage frequency makes the query cost negligible; cache invalidation bugs cost more than the save.

## 6. Health Alerts

```ts
type Alert = {
  severity: "warn" | "info";
  code: string;       // stable id
  message: string;    // user-facing one-liner
  hint?: string;      // remediation, often a CLI command
};
```

### MVP Detections

| code | severity | trigger | message example | hint |
|---|---|---|---|---|
| `overlap` | warn | collection A's path is a prefix of collection B's path | `Collections 'bb3wiki' and 'wiki' index overlapping paths (20 files duplicated)` | `hwicortex collection rm bb3wiki` |
| `no-context` | info | YAML has no `context` for collection | `Collection 'bb3specs' has no context — search ranking quality reduced` | `hwicortex context add qmd://bb3specs/ "<description>"` |
| `empty` | warn | `fileCount === 0` | `Collection 'foo' is empty — path may be wrong or files missing` | shows configured path |
| `no-embedding` | warn | active docs without rows in `vec_documents` | `15 documents missing embeddings — vector search incomplete` | `hwicortex embed --collection <name>` |
| `stale` | info | wiki page with `hit_count == 0` AND `created` >30 days ago | `5 wiki pages have never been hit (created >30d ago)` | links to filtered wiki list |

### Display Rules
- Empty alerts → widget hidden entirely.
- `warn` = yellow badge, `info` = gray badge.
- Click an alert → expand to show `hint` and (if applicable) the affected items.
- **No automatic remediation buttons** — read-only principle.

### Explicitly Excluded
- "Import failure" alerts (no failure log exists).
- "Stale collection" by mtime alone (high false positive rate; spec docs legitimately don't change).
- Self-healing actions.

## 7. Search Behavior

- Debounce: 200ms after last keystroke.
- Inline dropdown: top 5 results with title + snippet. "View all N results" link → `#search?q=...`.
- Enter key (anywhere in search input): immediate jump to `#search?q=...`.
- ESC: close dropdown and clear input.
- Empty query: dropdown closed.
- Zero results: "No results for '<q>'" message.
- Special chars: input wrapped as FTS5 phrase to escape.
- Korean: relies on existing mecab-ko tokenization on the indexing side; the dashboard query path must use the same store-level search function as the CLI to keep tokenization consistent.

Pagination on the results page: 20 per page, prev/next buttons.

## 8. Error Handling

### Startup Errors (exit immediately)

| Condition | Message |
|---|---|
| `QMD_VAULT_DIR` not set | `Error: QMD_VAULT_DIR not set. Set it or pass --vault <path>.` |
| Vault path missing | `Error: Vault path not found: <path>` |
| Port in use | `Error: Port N in use. Try --port <n>.` |
| SQLite index missing | `Error: Index DB not found. Run 'hwicortex collection add ...' first.` |

Browser auto-open failure does **not** exit — the URL is logged and the server continues.

### Runtime Errors

| Condition | Response |
|---|---|
| Handler exception | `500 + { error: <message> }` JSON; stack to stdout; UI shows "Failed to load" + retry per widget |
| Unknown route | `404` with static "Page not found" |
| Unknown collection | `404 + { error: "Collection not found" }` |
| Unknown wiki slug | `404 + { error: "Wiki page not found" }` |
| FTS5 syntax error | catch → wrap input as phrase → retry → if still fails, return empty results with a warning |

The server **must not crash** on a single handler error. All handlers are wrapped in try/catch; a failure in one widget's data must not break the others.

### Empty States (UI)

| Widget | Empty message |
|---|---|
| Collection cards (none) | "No collections yet. Run `hwicortex collection add <path>`" |
| Wiki recent / top hits (none) | "No wiki pages. Run `hwicortex wiki create ...`" |
| Tags (none) | "No tags found in wiki frontmatter" |
| Health alerts (none) | widget hidden |
| Search results (none) | "No results for '<q>'" |

### Safety

- All SQL is `SELECT` only. Write functions are not imported.
- Path traversal: `:project` and `:slug` reject `..`, `/`, and other separators (404).
- Localhost binding by default; `0.0.0.0` is out of scope for v1.
- FTS5 input is escaped via phrase wrapping.

## 9. Testing

### Vitest Unit Tests

`test/dashboard/data.test.ts`
- `getOverview()` returns expected shape against a fixture DB.
- `getTags()` correctly aggregates tags across multiple projects.
- `getCollectionDetail(name)` returns null/404 for missing names.
- `getWikiPageDetail(project, slug)` parses frontmatter and computes backlinks.

`test/dashboard/alerts.test.ts` (priority — alerts are the main correctness surface)
- `bb3wiki` ⊂ `wiki/bb3wiki` → `overlap` alert.
- Disjoint paths → no `overlap`.
- Missing context → `no-context`.
- Empty collection → `empty`.
- Active docs without embeddings → `no-embedding`.
- Wiki page with `hit_count == 0` and age >30d → `stale`.
- Healthy fixture → empty alerts array.

`test/dashboard/search.test.ts`
- Korean query (e.g., "팝업") returns matching pages.
- English query returns matching pages.
- Special characters do not crash (phrase escape).
- Collection filter narrows results.
- Empty query → empty results, no error.
- Zero-match query → empty results.

### HTTP Integration Tests

`test/dashboard/server.test.ts`
- Spin up `Bun.serve()` on a random port; tear down after each test.
- `GET /api/overview` → 200 with schema.
- `GET /api/collection/<missing>` → 404.
- `GET /api/wiki/foo/..%2Fetc` → 404 (path traversal rejected).
- `GET /api/search?q=` → 200 + empty results.
- Forced handler exception → 500 + error JSON; subsequent requests still succeed (server alive).

### Manual Browser Checklist (pre-merge)

```
[ ] hwicortex dashboard → 7777 auto-opens
[ ] Overview: 5 widgets render
[ ] Health alert widget shows current overlap warning
[ ] Tags tab → bar chart renders
[ ] Tag click → filtered wiki list
[ ] Collection card click → detail view
[ ] File click in collection → modal raw markdown
[ ] Wiki page click → body + backlinks render
[ ] Search input → 200ms debounce → dropdown
[ ] Enter → search results page
[ ] Empty result → "No results"
[ ] Refresh button → re-fetches
[ ] ESC → search closes
[ ] Hash routing survives F5
[ ] Port collision → friendly error
[ ] Vault unset → friendly error
```

### Out of Scope

- E2E (Playwright/Puppeteer) — single-user tool, setup cost not justified.
- Visual regression.
- Accessibility audit.
- Load/perf testing.

## 10. Open Questions / Future Work

- Markdown rendering library choice (e.g., `marked` via CDN vs `<pre>` raw fallback) is an implementation detail — defer to plan phase.
- If/when widget count grows past ~7 or page count past ~5, revisit Approach 2 (Hono + Alpine + Tailwind).
- Auto-fix actions (e.g., one-click "remove duplicate collection") would require shifting from Q2=D to Q2=C; intentionally deferred.
- Tag color/grouping convention: future polish.
- Dark mode: future polish; v1 is single theme.
