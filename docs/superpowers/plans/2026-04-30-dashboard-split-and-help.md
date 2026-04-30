# Dashboard Split + Help Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce confusion between "collection" and "wiki" in the HwiCortex
dashboard by splitting Overview into side-by-side panels, and add a static
Help tab explaining the underlying concepts in Korean.

**Architecture:** All changes confined to `src/cli/dashboard.ts` (data layer
+ HTML/JS/CSS in `renderHtml()`'s template literal) and the existing dashboard
test suite. No new HTTP endpoints; Help is static client-side content. The
synthetic `wiki` collection is filtered out of the **Collections** view but
preserved in the underlying DB and alert detection.

**Tech Stack:** TypeScript (Node http server), vitest, Bun runtime. No new
dependencies. CSS authored inline in `renderHtml()`.

**Spec:** [docs/superpowers/specs/2026-04-30-dashboard-split-and-help.md](../specs/2026-04-30-dashboard-split-and-help.md)

---

## File Structure

| File | Role | Change Summary |
|---|---|---|
| `src/cli/dashboard.ts` | Server + HTML shell + render JS | Extend `Overview` type; filter `wiki` from `collections`; add `totalWikiProjects` and `wiki.projects`; restructure `renderOverview()` into split-grid layout; add `renderHelp()`; add `#help` route; ~40 lines CSS |
| `test/dashboard/data.test.ts` | Data layer assertions | Extend `getOverview` test with wiki-filter, `totalWikiProjects`, `wiki.projects` aggregation assertions |
| `test/dashboard/server.test.ts` | HTML shell smoke | Assert new tab label `Help` and Help section heading appear in `GET /` body |
| `test/dashboard/fixtures.ts` | Existing helpers | Use as-is — `writeWikiPage()` already supports per-project pages |
| `CHANGELOG.md` | Release notes | One entry under `## [Unreleased]` → `### Changes` |

**Why no new files:** the change is a layout reshape inside an already-large
single file; the existing tests already exercise the same module. Splitting
`renderHtml()` into chunks is out of scope here (would touch unrelated render
functions and is its own refactor).

---

## Conventions (read before starting)

- **Bun, never npm/node** for running scripts. Tests use `npx vitest` (the only
  exception, baked into the project workflow).
- **TDD is rigid here** — write the failing test first, run it to confirm
  failure, then implement, then re-run.
- **Commits are small** — one logical step per commit. Use the conventional
  format: `feat(dashboard): …`, `test(dashboard): …`, `refactor(dashboard): …`.
- All commits MUST include the trailer:
  ```
  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  ```
- `dashboard.ts` strings inside `renderHtml()` are inside a TypeScript
  **template literal**. Inside it: `\'` → `'`, `\\` → `\`, `\n` → real newline.
  When writing browser-side JS (single-quoted strings), use `\'` to escape an
  apostrophe — **do NOT use `\\'`** (that produces invalid browser JS). Same
  for `\n` vs `\\n`.
- Run `bun run build` at least once after each major step to confirm `tsc`
  is happy. The dashboard's `renderHtml()` template literal is NOT semantically
  validated by `tsc`, so visual verification matters.

---

## Task 1: Extend Overview type + add wiki-filter assertions (failing tests)

**Files:**
- Modify: `test/dashboard/data.test.ts:5-25` (extend the existing `getOverview` test)

- [ ] **Step 1: Read current `getOverview` test**

```bash
sed -n '5,25p' test/dashboard/data.test.ts
```

Confirm the existing test asserts `vault.path`, `vault.totalWikiPages`,
`wiki.recent/topHits/highImportance`, and `alerts === []`.

- [ ] **Step 2: Augment the test fixture to register a "wiki" synthetic collection plus a real one**

Replace lines 9-24 in `test/dashboard/data.test.ts`. Use the
`upsertStoreCollection` helper to insert two rows: the synthetic `wiki`
collection (which `ensureWikiCollection` would normally create) and a real
user collection `bb3specs`. Add a second project so `wiki.projects` is
non-trivial.

```typescript
  it("returns vault counters and wiki activity", async () => {
    const { store, cleanup: c } = makeTempStore();
    cleanup = c;
    const vault = makeTempVault();
    writeWikiPage(vault, "p1", "Page A", "body", { tags: ["x"], importance: 6, hit_count: 10 });
    writeWikiPage(vault, "p1", "Page B", "body", { tags: ["y"], importance: 1, hit_count: 0 });
    writeWikiPage(vault, "p2", "Page C", "body", { tags: ["z"], importance: 0, hit_count: 0 });

    // Register two collections directly in the DB:
    //  - "wiki": synthetic, normally created by ensureWikiCollection()
    //  - "bb3specs": a real user collection
    const { upsertStoreCollection } = await import("../../src/store.js");
    upsertStoreCollection(store.db, "wiki", { path: vault, type: "static" });
    upsertStoreCollection(store.db, "bb3specs", { path: "/some/real/path", type: "static" });

    const result = getOverview(store, vault);

    expect(result.vault.path).toBe(vault);
    expect(result.vault.totalWikiPages).toBe(3);

    // The synthetic "wiki" collection must NOT appear in the Collections panel.
    expect(result.collections.find(c => c.name === "wiki")).toBeUndefined();
    expect(result.collections.find(c => c.name === "bb3specs")).toBeDefined();

    // totalCollections counts only real collections (excludes "wiki").
    expect(result.vault.totalCollections).toBe(1);

    // totalWikiProjects = distinct project subdirs across wiki pages.
    expect(result.vault.totalWikiProjects).toBe(2);

    // wiki.projects aggregated, sorted by descending pageCount.
    expect(result.wiki.projects).toEqual([
      { name: "p1", pageCount: 2 },
      { name: "p2", pageCount: 1 },
    ]);

    // Existing assertions still hold.
    expect(result.wiki.recent.length).toBeGreaterThan(0);
    expect(result.wiki.topHits[0].hit_count).toBe(10);
    expect(result.wiki.highImportance.some(p => p.title === "Page A")).toBe(true);
  });
```

- [ ] **Step 3: Run the test to confirm it fails**

```bash
npx vitest run --reporter=default test/dashboard/data.test.ts
```

Expected failures (multiple):
- `result.collections.find(c => c.name === "wiki")` returns the wiki row
  (not `undefined`) — because the current `getOverview` includes it.
- `result.vault.totalCollections === 2` (current includes wiki) — expected `1`.
- `result.vault.totalWikiProjects` is `undefined` — type doesn't have it yet.
- `result.wiki.projects` is `undefined`.

- [ ] **Step 4: Commit the failing test**

```bash
git add test/dashboard/data.test.ts
git commit -m "$(cat <<'EOF'
test(dashboard): assert wiki collection filtered and project aggregation

Failing test for the upcoming Overview reshape: the synthetic "wiki"
collection must not appear in the Collections panel, and getOverview
must expose totalWikiProjects + wiki.projects for the new Wiki panel.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Implement type extension + wiki filter + project aggregation

**Files:**
- Modify: `src/cli/dashboard.ts:1151-1254` (`Overview` type and `getOverview`)

- [ ] **Step 1: Extend the `Overview` type**

In `src/cli/dashboard.ts` find the `Overview` type at line 1151 and add two
fields:
- `vault.totalWikiProjects: number`
- `wiki.projects: Array<{ name: string; pageCount: number }>`

```typescript
export type Overview = {
  vault: {
    path: string;
    totalDocs: number;
    totalCollections: number;
    totalWikiProjects: number;   // NEW
    totalWikiPages: number;
    lastUpdate: string | null;
  };
  alerts: Alert[];
  collections: Array<{
    name: string;
    path: string;
    pattern: string;
    fileCount: number;
    lastUpdate: string | null;
    hasContext: boolean;
    overlapsWith: string[];
  }>;
  wiki: {
    projects: Array<{ name: string; pageCount: number }>;   // NEW
    recent: WikiPageMeta[];
    topHits: WikiPageMeta[];
    highImportance: WikiPageMeta[];
  };
};
```

- [ ] **Step 2: Filter the synthetic `wiki` collection out of `collectionRows`**

In `getOverview` (line 1176), after `const collections = getStoreCollections(db);`
(line 1178), add a filtered alias used only for the cards. Keep the original
`collections` for `detectAlerts` and `detectOverlaps` unchanged — alerts about
the wiki collection's `no-context` state are still meaningful and the spec
preserves them.

Find this block (around line 1201):

```typescript
  const collectionRows = collections.map((c) => {
```

Change to:

```typescript
  const realCollections = collections.filter((c) => c.name !== "wiki");
  const collectionRows = realCollections.map((c) => {
```

- [ ] **Step 3: Compute `totalWikiProjects` and `wiki.projects` aggregation**

Find the return object (line 1236). Update `vault.totalCollections` to use
`realCollections.length`, add `totalWikiProjects`, and aggregate
`wiki.projects` from `wikiPages` grouped by `project`.

```typescript
  const projectCounts = new Map<string, number>();
  for (const w of wikiPages) {
    projectCounts.set(w.project, (projectCounts.get(w.project) ?? 0) + 1);
  }
  const wikiProjects = [...projectCounts.entries()]
    .map(([name, pageCount]) => ({ name, pageCount }))
    .sort((a, b) => b.pageCount - a.pageCount);

  return {
    vault: {
      path: vaultDir,
      totalDocs,
      totalCollections: realCollections.length,
      totalWikiProjects: projectCounts.size,
      totalWikiPages: wikiPages.length,
      lastUpdate,
    },
    alerts,
    collections: collectionRows,
    wiki: {
      projects: wikiProjects,
      recent: [...wikiMeta]
        .sort((a, b) => (b.updated ?? "").localeCompare(a.updated ?? ""))
        .slice(0, 5),
      topHits: [...wikiMeta].sort((a, b) => b.hit_count - a.hit_count).slice(0, 10),
      highImportance: wikiMeta.filter((w) => w.importance >= 5).slice(0, 5),
    },
  };
```

- [ ] **Step 4: Run the failing test — it should pass now**

```bash
npx vitest run --reporter=default test/dashboard/data.test.ts
```

Expected: PASS, all 4 `getOverview/getTags/getCollectionDetail/getWikiPageDetail`
tests green.

- [ ] **Step 5: Run the full test suite to confirm no regressions**

```bash
npx vitest run --reporter=default test/dashboard/
```

Expected: PASS (server.test.ts may still pass because it doesn't yet check for
`totalWikiProjects` or `wiki.projects`; the new fields are additive).

- [ ] **Step 6: Build to confirm tsc accepts the type changes**

```bash
bun run build
```

Expected: clean build (no TS errors).

- [ ] **Step 7: Commit**

```bash
git add src/cli/dashboard.ts
git commit -m "$(cat <<'EOF'
feat(dashboard): filter wiki collection and aggregate wiki projects

getOverview now drops the synthetic "wiki" collection from the
collections list (it gets its own panel) and exposes
vault.totalWikiProjects plus wiki.projects sorted by pageCount.
detectAlerts continues to see all collections, so wiki-collection
alerts (e.g. no-context) are unaffected.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Vault header copy + two-panel Overview layout (server-side smoke test first)

**Files:**
- Modify: `test/dashboard/server.test.ts` (new assertions)
- Modify: `src/cli/dashboard.ts:696-833` (`renderOverview`) and CSS section

- [ ] **Step 1: Add a failing server smoke for the new layout**

Append a new `it(...)` to the `HTTP routes` describe block in
`test/dashboard/server.test.ts` (after line 122):

```typescript
  it("HTML shell includes split Overview layout markers", async () => {
    const r = await fetch(baseUrl + "/");
    const body = await r.text();
    // Two-panel layout class
    expect(body).toContain("split-grid");
    // Wiki panel summary copy
    expect(body).toContain("wiki project");
    // Vault header now mentions "wiki projects" not just "wiki pages"
    expect(body).toContain("wiki projects");
  });
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npx vitest run --reporter=default test/dashboard/server.test.ts -t "split Overview"
```

Expected: FAIL — the strings `split-grid`, `wiki project`, `wiki projects` are
not in the current HTML shell.

- [ ] **Step 3: Update the vault header copy**

In `src/cli/dashboard.ts` find the vault-header block (line 704) and change
the meta line so it splits collections / wiki projects / docs:

```javascript
    // Widget A — Vault Header
    var v = data.vault || {};
    html += '<div class="vault-header card">';
    html += '<h2>HwiCortex Vault: ' + escHtml(v.path || "") + '</h2>';
    html += '<div class="vault-meta">';
    html += escHtml(String(v.totalCollections || 0)) + " collection" + (v.totalCollections === 1 ? "" : "s") + " &middot; ";
    html += escHtml(String(v.totalWikiProjects || 0)) + " wiki project" + (v.totalWikiProjects === 1 ? "" : "s") + " &middot; ";
    html += escHtml(String(v.totalWikiPages || 0)) + " wiki page" + (v.totalWikiPages === 1 ? "" : "s") + " &middot; ";
    html += escHtml(String(v.totalDocs || 0)) + " doc" + (v.totalDocs === 1 ? "" : "s") + " &middot; ";
    html += "Last updated " + escHtml(relTime(v.lastUpdate));
    html += "</div></div>";
```

- [ ] **Step 4: Replace the bottom of `renderOverview` with the split-grid layout**

The current `renderOverview()` emits (in order): Vault header → Health Alerts →
Collections grid → Wiki Activity card. Keep Vault header and Health Alerts
unchanged; replace everything after Health Alerts with a single
`<div class="split-grid">…</div>` containing two panels.

In `src/cli/dashboard.ts` lines 740-820 (Widget B — Collections + Widget C —
Wiki Activity), replace with:

```javascript
    // Widget B/C — Two-panel Collections | Wiki layout
    var colls = data.collections || [];
    var wiki = data.wiki || {};
    var projects = wiki.projects || [];
    var recent = wiki.recent || [];
    var topHits = wiki.topHits || [];
    var highImp = wiki.highImportance || [];

    var noWiki = recent.length === 0 && topHits.length === 0 && highImp.length === 0 && projects.length === 0;
    var noColls = colls.length === 0;

    if (noColls && noWiki) {
      html += '<div class="card"><h2 style="margin-bottom:10px">Welcome to HwiCortex Dashboard</h2>';
      html += '<p style="margin-bottom:8px">No collections or wiki pages found. Get started:</p>';
      html += '<pre style="background:#f5f5f5;padding:10px;border-radius:6px;font-size:13px">';
      html += 'hwicortex collection add &lt;path&gt;\nhwicortex embed --collection &lt;name&gt;\nhwicortex wiki create &lt;project&gt; &lt;title&gt;</pre></div>';
    } else {
      html += '<div class="split-grid">';

      // Left: Collections panel
      html += '<section class="coll-panel card">';
      html += '<div class="card-title">Collections</div>';
      if (colls.length === 0) {
        html += '<p style="color:#666">No real collections yet. Run <code>hwicortex collection add &lt;path&gt;</code></p>';
      } else {
        html += '<div class="coll-grid">';
        for (var ci = 0; ci < colls.length; ci++) {
          var c = colls[ci];
          var hasOverlap = c.overlapsWith && c.overlapsWith.length > 0;
          html += '<div class="coll-card" data-coll="' + escHtml(c.name || "") + '">';
          html += '<div class="coll-card-name">' + escHtml(c.name || "");
          if (hasOverlap) html += ' <span title="Overlapping paths">&#9888;</span>';
          html += '</div>';
          html += '<div class="coll-card-meta">' + escHtml(String(c.fileCount || 0)) + " files &middot; " + escHtml(relTime(c.lastUpdate)) + '</div>';
          html += '<span class="badge ' + (c.hasContext ? "badge-ctx" : "badge-noctx") + '">' + (c.hasContext ? "ctx" : "no context") + '</span>';
          if (hasOverlap) {
            html += '<div class="coll-card-overlap">overlaps with: ' + escHtml(c.overlapsWith.join(", ")) + '</div>';
          }
          html += '</div>';
        }
        html += '</div>';
      }
      html += '</section>';

      // Right: Wiki panel
      html += '<section class="wiki-panel card">';
      html += '<div class="card-title">Wiki</div>';
      var totalPages = (data.vault && data.vault.totalWikiPages) || 0;
      html += '<div class="wiki-summary">' + escHtml(String(projects.length)) + ' project' + (projects.length === 1 ? '' : 's') + ' &middot; ' + escHtml(String(totalPages)) + ' page' + (totalPages === 1 ? '' : 's') + '</div>';

      // Project list (clickable → search filter by project name)
      if (projects.length > 0) {
        html += '<h3 class="wiki-subhead">Projects</h3><ul class="wiki-projects">';
        for (var pi = 0; pi < projects.length; pi++) {
          var p = projects[pi];
          html += '<li><a onclick="location.hash=\'#search?q=' + encodeURIComponent(p.name) + '\'">' + escHtml(p.name) + '</a> <span class="wiki-project-count">(' + escHtml(String(p.pageCount)) + ')</span></li>';
        }
        html += '</ul>';
      }

      // Recent / Top Hits / High Importance triple
      html += '<div class="wiki-grid">';

      html += '<div class="wiki-col"><h3>Recent</h3><ul>';
      if (recent.length === 0) {
        html += '<li style="color:#999">—</li>';
      } else {
        for (var ri = 0; ri < recent.length; ri++) {
          var rw = recent[ri];
          html += '<li><a onclick="location.hash=\'#wiki/' + encodeURIComponent(rw.project || "") + '/' + encodeURIComponent(rw.slug || "") + '\'">' + escHtml(rw.title || rw.slug || "") + '</a></li>';
        }
      }
      html += '</ul></div>';

      html += '<div class="wiki-col"><h3>Top Hits</h3><ul>';
      if (topHits.length === 0) {
        html += '<li style="color:#999">—</li>';
      } else {
        for (var ti = 0; ti < topHits.length; ti++) {
          var tw = topHits[ti];
          html += '<li>' + (ti + 1) + '. <a onclick="location.hash=\'#wiki/' + encodeURIComponent(tw.project || "") + '/' + encodeURIComponent(tw.slug || "") + '\'">' + escHtml(tw.title || tw.slug || "") + '</a> (' + escHtml(String(tw.hit_count || 0)) + ')</li>';
        }
      }
      html += '</ul></div>';

      html += '<div class="wiki-col"><h3>High Importance</h3><ul>';
      if (highImp.length === 0) {
        html += '<li style="color:#999">—</li>';
      } else {
        for (var ii = 0; ii < highImp.length; ii++) {
          var iw = highImp[ii];
          html += '<li>&#9733; <a onclick="location.hash=\'#wiki/' + encodeURIComponent(iw.project || "") + '/' + encodeURIComponent(iw.slug || "") + '\'">' + escHtml(iw.title || iw.slug || "") + '</a></li>';
        }
      }
      html += '</ul></div>';
      html += '</div>'; // .wiki-grid

      html += '</section>'; // .wiki-panel
      html += '</div>'; // .split-grid
    }
```

**Important:** the apostrophes in `onclick="location.hash='...'"` use **single
backslash** `\'` because we're inside a TS template literal. Do NOT write
`\\'`.

- [ ] **Step 5: Add CSS for `.split-grid`, `.wiki-panel`, `.coll-panel`**

In `src/cli/dashboard.ts` inside the `<style>` block (between line 568 and 569,
before `</style>`), append:

```css
/* ---- Split Overview layout ---- */
.split-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-top: 16px;
}
@media (max-width: 900px) {
  .split-grid { grid-template-columns: 1fr; }
}
.coll-panel .coll-grid { grid-template-columns: 1fr; gap: 8px; }
.wiki-panel .wiki-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-top: 12px; }
@media (max-width: 700px) {
  .wiki-panel .wiki-grid { grid-template-columns: 1fr; }
}
.wiki-summary { color: #666; font-size: 13px; margin-bottom: 10px; }
.wiki-subhead { font-size: 13px; font-weight: 600; color: #555; margin: 8px 0 4px; }
.wiki-projects { list-style: none; padding: 0; margin: 0 0 12px; font-size: 13px; }
.wiki-projects li { padding: 2px 0; }
.wiki-projects a { color: #1a56db; cursor: pointer; text-decoration: none; }
.wiki-projects a:hover { text-decoration: underline; }
.wiki-project-count { color: #999; font-size: 12px; }
```

- [ ] **Step 6: Run all dashboard tests**

```bash
npx vitest run --reporter=default test/dashboard/
```

Expected: ALL PASS — including the new `split Overview layout markers` smoke
and the previously-extended `getOverview` test.

- [ ] **Step 7: Build**

```bash
bun run build
```

Expected: clean.

- [ ] **Step 8: Manual smoke**

```bash
hwicortex dashboard
```

Visit the printed URL. Confirm:
- Vault header shows `N collections · M wiki projects · K wiki pages · X docs`.
- Below, two columns side-by-side at desktop width: Collections (left), Wiki
  (right). Below 900px window width they stack vertically.
- The synthetic `wiki` row no longer appears as a card. Real registered
  collections still appear.
- The Wiki panel shows a project list above the Recent/Top Hits/High
  Importance triple. Clicking a project name navigates to a search filter on
  that project name.
- Health Alerts (if any) still surface above the split grid.

Stop the server with Ctrl-C.

- [ ] **Step 9: Commit**

```bash
git add src/cli/dashboard.ts test/dashboard/server.test.ts
git commit -m "$(cat <<'EOF'
feat(dashboard): split Overview into Collections | Wiki panels

Replace the stacked Collections-then-Wiki layout with a side-by-side
two-panel grid. The synthetic "wiki" collection is hidden from the
Collections panel (now summarised in the Wiki panel) and the vault
header counts wiki projects separately from real collections. Project
names in the Wiki panel link to a search filter so users can drill in
without a new view. Stacks vertically below 900px viewport.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Help tab (failing smoke first)

**Files:**
- Modify: `test/dashboard/server.test.ts` (Help-tab assertions)
- Modify: `src/cli/dashboard.ts` (header tab, parseHash, setActiveTab, route, renderHelp, CSS)

- [ ] **Step 1: Add a failing smoke for the Help tab**

Append to the `HTTP routes` describe block in `test/dashboard/server.test.ts`:

```typescript
  it("HTML shell includes Help tab and Help content sections", async () => {
    const r = await fetch(baseUrl + "/");
    const body = await r.text();
    // Tab and route
    expect(body).toContain('id="tab-help"');
    expect(body).toContain('href="#help"');
    expect(body).toContain('renderHelp');
    // Korean section headings (hardcoded copy)
    expect(body).toContain('Collection vs Wiki');
    expect(body).toContain('Health Alerts');
    expect(body).toContain('CLI');
    // 5 alert codes are documented somewhere in the Help body
    for (const code of ['overlap', 'no-context', 'empty', 'no-embedding', 'stale']) {
      expect(body).toContain(code);
    }
  });
```

- [ ] **Step 2: Run the test to confirm failure**

```bash
npx vitest run --reporter=default test/dashboard/server.test.ts -t "Help tab"
```

Expected: FAIL — `tab-help`, `renderHelp`, etc. are not in the bundle yet.

- [ ] **Step 3: Add the Help tab to the header nav**

Find the `<nav class="tabs">` block in `src/cli/dashboard.ts` (around line 576):

```html
    <nav class="tabs">
      <a href="#overview" class="tab" id="tab-overview">Overview</a>
      <a href="#tags" class="tab" id="tab-tags">Tags</a>
      <a href="#help" class="tab" id="tab-help">Help</a>
    </nav>
```

- [ ] **Step 4: Add `help` to `parseHash`, `setActiveTab`, and `route`**

Find `parseHash` (search `function parseHash`); the current view-list parses
`overview | tags | collection | wiki | search`. The local variable is `hash`
(the part after `#`), not `view`. Add a branch for `help` next to the
existing `overview` branch — match the existing style (likely
`if (hash === "help") return { view: "help", params: {} };`). Read the
function first to confirm the pattern before editing.

In `setActiveTab` (line 661):

```javascript
function setActiveTab(view) {
  document.querySelectorAll(".tab").forEach(function(el) { el.classList.remove("active"); });
  if (view === "overview") document.getElementById("tab-overview").classList.add("active");
  if (view === "tags")     document.getElementById("tab-tags").classList.add("active");
  if (view === "help")     document.getElementById("tab-help").classList.add("active");
}
```

In `route` (line 667):

```javascript
function route() {
  const { view, params } = parseHash();
  setActiveTab(view);
  try {
    if (view === "overview")   { renderOverview(); return; }
    if (view === "tags")       { renderTags();    return; }
    if (view === "help")       { renderHelp();    return; }
    if (view === "collection") { renderCollection(params.name); return; }
    if (view === "wiki")       { renderWiki(params.project, params.slug); return; }
    if (view === "search")     { renderSearch(params.q, params.collection, params.page || 0); return; }
    renderOverview();
  } catch(e) {
    renderError(e.message || String(e));
  }
}
```

- [ ] **Step 5: Add `renderHelp()`**

Insert immediately after `renderTags()` (around line 860, after its closing
brace). The body is a single hardcoded constant — no fetch.

```javascript
function renderHelp() {
  var view = document.getElementById("view");
  var html = '';

  // Section 1: Collection vs Wiki
  html += '<section class="card help-section">';
  html += '<h2>Collection vs Wiki</h2>';
  html += '<p>HwiCortex는 두 가지 형태의 문서 저장소를 다룹니다.</p>';
  html += '<table class="help-table"><thead><tr><th></th><th>Collection</th><th>Wiki</th></tr></thead><tbody>';
  html += '<tr><th>등록</th><td><code>hwicortex collection add &lt;path&gt;</code> 로 사용자가 직접 등록</td><td>벌트 디렉터리(<code>QMD_VAULT_DIR/wiki/</code>) 아래 파일이 자동 인덱싱됨</td></tr>';
  html += '<tr><th>위치</th><td>임의의 경로 (<code>~/projects/foo</code> 등)</td><td>벌트 안 <code>wiki/&lt;project&gt;/</code></td></tr>';
  html += '<tr><th>메타</th><td>YAML <code>context</code>로 컬렉션 단위 설명 추가</td><td>페이지 frontmatter (<code>title</code>, <code>tags</code>, <code>importance</code>, <code>hit_count</code> 등)</td></tr>';
  html += '<tr><th>용도</th><td>외부 코드/문서 검색 인덱싱</td><td>대화형 지식·노트 누적, 검색 시 자동 hit 카운트 업데이트</td></tr>';
  html += '</tbody></table>';
  html += '</section>';

  // Section 2: Health Alerts
  html += '<section class="card help-section">';
  html += '<h2>Health Alerts</h2>';
  html += '<p>Overview 상단에 표시되는 5가지 코드의 의미와 대응 명령:</p>';
  html += '<dl class="help-dl">';
  html += '<dt><code>overlap</code></dt><dd>두 컬렉션 경로가 한쪽이 다른 쪽의 prefix인 경우. 한쪽을 <code>hwicortex collection rm</code> 으로 정리하세요.</dd>';
  html += '<dt><code>no-context</code></dt><dd>컬렉션에 컨텍스트 설명이 없어서 검색 랭킹 품질이 낮음. <code>hwicortex context add qmd://&lt;name&gt;/ "&lt;설명&gt;"</code></dd>';
  html += '<dt><code>empty</code></dt><dd>컬렉션이 비었음 (경로 오타이거나 파일이 사라졌을 수 있음). 등록 경로를 확인하세요.</dd>';
  html += '<dt><code>no-embedding</code></dt><dd>일부 문서에 임베딩이 없어서 벡터 검색이 누락됨. <code>hwicortex embed --collection &lt;name&gt;</code></dd>';
  html += '<dt><code>stale</code></dt><dd>30일 넘게 한 번도 hit되지 않은 위키 페이지 목록. 정리 후보입니다.</dd>';
  html += '</dl>';
  html += '</section>';

  // Section 3: CLI quick reference
  html += '<section class="card help-section">';
  html += '<h2>CLI 빠른 참조</h2>';
  html += '<h3>Collection</h3>';
  html += '<pre class="help-pre">hwicortex collection add &lt;path&gt;     # 컬렉션 등록\nhwicortex collection list             # 등록된 컬렉션 보기\nhwicortex collection rm &lt;name&gt;        # 제거</pre>';
  html += '<h3>Wiki</h3>';
  html += '<pre class="help-pre">hwicortex wiki create &lt;project&gt; &lt;title&gt;\nhwicortex wiki list [--project &lt;name&gt;]\nhwicortex wiki tag &lt;slug&gt; &lt;tag&gt;</pre>';
  html += '<h3>Indexing &amp; Search</h3>';
  html += '<pre class="help-pre">hwicortex update              # 변경 파일 재인덱싱\nhwicortex embed [--collection &lt;name&gt;]\nhwicortex search &lt;query&gt;\nhwicortex query &lt;query&gt;       # LLM 응답</pre>';
  html += '</section>';

  // Section 4: Dashboard usage
  html += '<section class="card help-section">';
  html += '<h2>대시보드 사용법</h2>';
  html += '<ul class="help-list">';
  html += '<li><strong>탭</strong>: Overview / Tags / Help. URL 해시(<code>#overview</code>)로 직접 이동 가능.</li>';
  html += '<li><strong>검색바</strong>: 입력 시 200ms 디바운스 드롭다운 추천. Enter로 전체 결과 페이지로 이동.</li>';
  html += '<li><strong>카드/태그 클릭</strong>: 해당 컬렉션/태그로 검색 필터링.</li>';
  html += '<li><strong>Refresh 버튼</strong>: 현재 뷰만 다시 로드 (전체 새로고침 없이).</li>';
  html += '<li><strong>키보드</strong>: ESC로 모달/드롭다운 닫기.</li>';
  html += '</ul>';
  html += '</section>';

  view.innerHTML = html;
}
```

- [ ] **Step 6: Add CSS for Help sections**

Inside the `<style>` block, append (next to the split-grid CSS from Task 3):

```css
/* ---- Help tab ---- */
.help-section { margin-bottom: 16px; }
.help-section h2 { font-size: 18px; margin-bottom: 10px; }
.help-section h3 { font-size: 14px; font-weight: 600; margin: 12px 0 6px; color: #444; }
.help-section p  { margin-bottom: 8px; }
.help-table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 6px; }
.help-table th, .help-table td { padding: 6px 8px; border: 1px solid #e0e0e0; text-align: left; vertical-align: top; }
.help-table thead th { background: #fafafa; font-weight: 600; }
.help-table tbody th { width: 80px; background: #fafafa; }
.help-dl { margin: 4px 0; }
.help-dl dt { font-weight: 600; margin-top: 8px; }
.help-dl dd { margin: 2px 0 4px 16px; color: #444; }
.help-pre { background: #f5f5f5; padding: 10px; border-radius: 4px; font-size: 12px; overflow-x: auto; }
.help-list { list-style: disc; padding-left: 20px; }
.help-list li { margin: 4px 0; }
```

- [ ] **Step 7: Run dashboard tests**

```bash
npx vitest run --reporter=default test/dashboard/
```

Expected: ALL PASS, including the new `Help tab and Help content sections`
smoke.

- [ ] **Step 8: Build**

```bash
bun run build
```

Expected: clean.

- [ ] **Step 9: Manual smoke**

```bash
hwicortex dashboard
```

In the browser:
- Click `Help` tab → should show 4 sections (Collection vs Wiki, Health
  Alerts, CLI 빠른 참조, 대시보드 사용법). No console errors (open devtools).
- Click back to `Overview` and `Tags` → still work, active tab indicator
  follows the click.
- URL `#help` directly in the address bar should land on Help.
- Refresh button on Help should re-render without errors.

Stop the server.

- [ ] **Step 10: Commit**

```bash
git add src/cli/dashboard.ts test/dashboard/server.test.ts
git commit -m "$(cat <<'EOF'
feat(dashboard): add Help tab with Korean concept reference

A new static Help tab (#help) explains Collection vs Wiki, the five
Health Alert codes, common CLI commands, and dashboard usage in
Korean. The body is hardcoded inside renderHelp() — no extra HTTP
endpoint, no client-side fetch — so it works offline once the page
is loaded.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: CHANGELOG and final verification

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add a CHANGELOG entry**

Open `CHANGELOG.md`, add a new bullet under `## [Unreleased]` →
`### Changes`:

```markdown
- Dashboard Overview now splits real **Collections** and **Wiki** into
  side-by-side panels with a wiki-project summary list, and a new **Help**
  tab documents the Collection-vs-Wiki distinction, the five Health Alert
  codes, common CLI commands, and dashboard usage in Korean.
```

- [ ] **Step 2: Final test sweep**

```bash
npx vitest run --reporter=default
```

Expected: full test suite passes (no regressions outside the dashboard
suite).

- [ ] **Step 3: Final build**

```bash
bun run build
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md
git commit -m "$(cat <<'EOF'
docs(changelog): note dashboard split and Help tab

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Done criteria (cross-check before finishing)

- [ ] `getOverview` no longer returns the synthetic `wiki` collection in
      `collections`; `vault.totalCollections` reflects only real collections.
- [ ] `vault.totalWikiProjects` and `wiki.projects` are populated and used by
      the renderer.
- [ ] Overview shows two side-by-side panels at desktop widths and stacks
      below 900px.
- [ ] `Help` tab renders 4 sections, all 5 alert codes are documented, the
      tab indicator highlights correctly.
- [ ] All `test/dashboard/` tests pass.
- [ ] Full vitest suite passes.
- [ ] `bun run build` is clean.
- [ ] `CHANGELOG.md` updated.
- [ ] No regressions to existing routes (Tags, Collection detail, Wiki page,
      Search) — verified by manual click-through.
