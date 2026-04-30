# Dashboard: Split Collection/Wiki & Add Help Tab

**Date:** 2026-04-30
**Author:** hwijung-park
**Status:** Draft

## Goal

Reduce confusion between "collection" and "wiki" concepts in the HwiCortex
dashboard by visually separating their information and adding a static Help
tab that explains the underlying concepts in Korean.

## Problem

The current Overview page treats wiki and collection on equal footing:

- The vault header counts both as if interchangeable
  (`3 collections · 47 wiki pages`).
- The synthetic `wiki` collection (auto-registered by `ensureWikiCollection()`,
  `src/wiki.ts:250`) appears as a card alongside real user-registered
  collections (`bb3specs`, `bb3wiki`, `gdd-evaluation`), which is misleading
  because it is qualitatively different (single hardcoded path under the
  vault, structured frontmatter, `--project` subdivision, hit/importance
  tracking).
- Users encountering the dashboard for the first time have no in-app
  reference for what each alert code, command, or metric means.

## Non-Goals

- No change to the underlying data model (wiki stays as a single
  `WIKI_COLLECTION` with `--project` subdirectories).
- No new HTTP endpoints; Help is static HTML embedded in the existing
  bundle.
- No live status surface in Help (overlaps with `hwicortex status`); this
  was rejected during brainstorming.
- No internationalisation framework; Korean copy is hardcoded since the
  user explicitly chose Korean for Help body text and English for UI
  chrome.

## Design

### 1. Overview layout — two side-by-side regions

```
┌──────────────────────────────────────────────────────┐
│ Vault: <path>                                         │
│ 3 collections · 3 wiki projects · 47 docs · X ago     │
└──────────────────────────────────────────────────────┘
┌─ Health Alerts (when non-empty) ─────────────────────┐
└──────────────────────────────────────────────────────┘
┌─ Collections ───────────┬─ Wiki ────────────────────┐
│ <coll cards 2-col grid> │ Summary: N projects · M p │
│                         │                            │
│                         │ Projects                   │
│                         │  • bb3wiki (20)            │
│                         │  • demo (5)                │
│                         │                            │
│                         │ Recent / TopHits / Imp.    │
└─────────────────────────┴────────────────────────────┘
```

- The `wiki` synthetic collection is filtered out of the **Collections**
  panel since it is summarised in the **Wiki** panel.
- Vault counters split `collections` (real registered) and
  `wikiProjects` (distinct `--project` subdirectories).
- Each project row in the Wiki panel is clickable and navigates to a
  `#search?q=<project>` filter so the user can drill into pages without
  needing a new view.
- At viewport widths <900px the two panels stack vertically.
- The existing Recent / Top Hits / High Importance triple lives inside
  the Wiki panel, not as a separate card.

### 2. Help tab

A new tab `Help` joins the existing `Overview` and `Tags` tabs. Routing
key: `#help`. Content is rendered from a hardcoded Korean string inside
`renderHtml()` — no fetch.

Sections (each a `<section class="card">`):

1. **Collection vs Wiki** — one paragraph per concept; explicit table or
   bulleted contrast covering: who registers it, where files live,
   metadata model, what it's for.
2. **Health Alerts 의미** — for each of the five codes
   (`overlap`, `no-context`, `empty`, `no-embedding`, `stale`): one-line
   meaning + remediation command.
3. **CLI 빠른 참조** — three groups (collection, wiki, indexing/search)
   with command + short purpose. Code blocks rendered with `<pre>`.
4. **대시보드 사용법** — tabs, search bar (200ms debounce dropdown,
   Enter → full results), card/tag click behaviour, refresh button,
   keyboard shortcuts (ESC closes modal/dropdown).

Help renders entirely client-side from a JavaScript constant; no server
round-trip on tab switch.

### 3. Data layer changes (`src/cli/dashboard.ts`)

```ts
type Overview = {
  vault: {
    path: string;
    totalDocs: number;
    totalCollections: number;     // excludes synthetic "wiki"
    totalWikiProjects: number;    // NEW
    totalWikiPages: number;
    lastUpdate: string | null;
  };
  alerts: Alert[];
  collections: CollectionRow[];   // filtered: name !== "wiki"
  wiki: {
    projects: Array<{ name: string; pageCount: number }>;  // NEW
    recent: WikiPageMeta[];
    topHits: WikiPageMeta[];
    highImportance: WikiPageMeta[];
  };
};
```

- `getOverview()`:
  - `collections` array filters out entries where `name === "wiki"`.
  - `vault.totalCollections` derived from the filtered array.
  - `vault.totalWikiProjects = new Set(wikiPages.map(p => p.project)).size`.
  - `wiki.projects` aggregated from `wikiPages` grouped by `project`,
    sorted by descending `pageCount`.

- `detectAlerts()` already iterates `collections` from
  `getStoreCollections(db)` (which still includes `wiki`); the existing
  alerts about the `wiki` collection (`no-context`) are preserved
  because they reflect a real DB state. We do not filter alerts.

### 4. Frontend changes

- `renderOverview()` rewritten to emit the two-panel grid.
- New `renderHelp()` invoked on `#help`. `parseHash()` recognises
  `help`. `setActiveTab()` highlights the new tab.
- CSS additions: `.split-grid` (2 columns at >=900px, 1 column below),
  `.wiki-panel` and `.coll-panel` styling, `.help-section` styling for
  Help cards. Approximately 40 new CSS lines.

### 5. Tests

- `test/dashboard/data.test.ts`:
  - Existing `getOverview` test updated: assert `wiki` collection is
    absent from `collections`, assert `vault.totalWikiProjects` correct,
    assert `wiki.projects` aggregation correct (2 projects with 2 and 1
    pages from existing fixture).
- `test/dashboard/server.test.ts`:
  - Add `GET /` returns HTML containing the new tab label `Help` and a
    Help section heading. This guards against regression of the static
    template.
- No new test file. Help content correctness is verified by manual
  review (it's a static knowledge-base page).

### 6. File touches

| File | Change | Approx. lines |
|---|---|---|
| `src/cli/dashboard.ts` | overview reshape, help tab, CSS, JS | +180 / -40 |
| `test/dashboard/data.test.ts` | extend overview assertions | +15 |
| `test/dashboard/server.test.ts` | help tab smoke | +6 |
| `CHANGELOG.md` | unreleased entry | +2 |

## Risks & Mitigations

- **Risk:** Filtering the `wiki` collection from the cards hides the
  `no-context` alert source. **Mitigation:** alerts panel is unchanged,
  so the `wiki` no-context alert still surfaces — and the Help tab now
  explains what to do with it.
- **Risk:** Project count differs from page count semantics; users may
  read `3 wiki projects` and expect three filterable lists. **Mitigation:**
  Wiki panel actually lists the projects with counts so the number is
  immediately self-explanatory.
- **Risk:** Help content drifts as commands change. **Mitigation:** the
  Help block is one named JS constant; PR reviewers can spot stale
  copy. Linking the spec from the constant comment helps future edits.

## Open Questions

None — language, depth, and layout were resolved during brainstorming.

## Done Criteria

- Vitest `test/dashboard/` suite passes.
- `bun run build` clean.
- `hwicortex dashboard` renders Overview with two distinct panels and a
  working Help tab.
- Manual smoke: tab switch (Overview ↔ Tags ↔ Help) keeps state, no
  console errors.
- CHANGELOG `[Unreleased]` notes the change.
