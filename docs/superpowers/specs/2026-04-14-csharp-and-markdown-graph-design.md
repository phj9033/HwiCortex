# C# Language Support & Markdown Wiki-Link Graph

**Date:** 2026-04-14
**Status:** Approved

## Problem

`hwicortex graph clusters` returns "No clusters found" for collections containing only markdown (`.md`) or C# (`.cs`) files because graph extraction only supports TypeScript, JavaScript, Python, Go, and Rust. Unity projects need C# AST-based graph extraction, and markdown-heavy collections need wiki-link-based graph support.

## Goals

1. Add C# (`.cs`) as a supported language for AST-based graph extraction
2. Add Obsidian wiki-link (`[[...]]`) extraction for markdown files
3. Keep code and document clusters separate within the same collection
4. Reuse existing infrastructure (relations table, clustering, enrichment, Obsidian output)

## Non-Goals

- Cross-type relations (`.cs` ↔ `.md`) — deferred to future work
- `GetComponent<T>()` / `AddComponent<T>()` component dependency tracking
- `UnityEvent` / `Action<T>` event subscription tracking
- Namespace-to-directory mapping for C# `using` resolution

---

## Design

### 1. C# Language Support

#### 1.1 Language Registration

- Add `"csharp"` to `SupportedLanguage` type union
- Add `".cs": "csharp"` to `EXTENSION_MAP`
- Add `csharp` entry to `GRAMMAR_MAP` pointing to `tree-sitter-c-sharp` package
- Add `".cs"` to extension list in `resolveTargetHashes`
- Add `tree-sitter-c-sharp` to `optionalDependencies` in `package.json`

#### 1.2 Symbol Queries

```
class_declaration name → class
method_declaration name → method
interface_declaration name → interface
enum_declaration name → enum
struct_declaration name → type
```

#### 1.3 Relation Extraction

| Source Pattern | AST Node | Relation Type |
|---|---|---|
| `using X.Y.Z` | `using_directive` | `imports` |
| `class A : B` | `base_list` first item | `extends` |
| `class A : IFoo` | `base_list` item with `I` prefix | `implements` |
| `[RequireComponent(typeof(T))]` | `attribute` → `typeof` argument | `uses_type` |
| `[SerializeField]` field type | `attribute_list` → field type if in collection | `uses_type` |
| `Resources.Load<T>()` | `generic_name` type argument | `uses_type` |
| `Addressables.LoadAssetAsync<T>()` | `generic_name` type argument | `uses_type` |
| Method calls | `invocation_expression` → imported symbol check | `calls` |

#### 1.4 Target Hash Resolution (C#-specific)

C# `using` directives reference namespaces, not file paths. Resolution strategy:

- `using` namespace strings are stored in `target_ref` but **not resolved to target_hash** (external/stdlib namespaces)
- `extends`, `implements`, `uses_type`, `calls` relations store the **type/symbol name** in `target_ref`
- `resolveTargetHashes` gets a new **symbol-name fallback path**: when path-based resolution fails, match `target_ref` against `symbols.name` in the same collection to find the defining file's hash
- This handles `class A : B` → find which file defines class `B`

### 2. Markdown Wiki-Link Graph

#### 2.1 Extraction

New function `extractWikiLinks(content: string, filepath: string): AstRelation[]`:

- Regex-based, no tree-sitter needed
- Patterns parsed:
  - `[[Page]]` → `targetRef: "Page"`
  - `[[Page|Display Text]]` → `targetRef: "Page"`
  - `[[folder/Page]]` → `targetRef: "folder/Page"`
- Wiki-links inside fenced code blocks (`` ``` ``) are ignored
- Returns relations with `type: "wiki_link"`

#### 2.2 Storage

Same `relations` table with `type = "wiki_link"`:
- `source_hash`: the `.md` file's content hash
- `target_ref`: wiki-link target page name
- `target_symbol`: null

#### 2.3 Target Hash Resolution (wiki-link-specific)

New resolution path in `resolveTargetHashes` for `wiki_link` type:
- Match `target_ref` against `documents.path` **filename stem** (without extension and directory)
  - `[[설정]]` → matches `specs/2026-04-09-settings.md` if stem is `2026-04-09-settings`...
  - Better: match against **document title** or **filename contains target_ref**
- If `target_ref` contains `/`, match as path suffix
- Resolution is best-effort; unresolved links remain with `target_hash = NULL`

**Concrete matching strategy:**
- Strip directory and extension from `documents.path` → get stem
- `[[PlayerController]]` matches `PlayerController.md`, `docs/PlayerController.md`
- `[[specs/설정]]` matches path ending in `specs/설정.md`

#### 2.4 Store Integration

In `reindexCollection`, after the existing `detectLanguage` block:
```
if file ends with .md:
  extractWikiLinks(content, relativeFile)
  saveRelations(db, hash, wikiRelations)
```

### 3. Cluster Separation

#### 3.1 Schema Change (Migration v4)

Add `kind TEXT DEFAULT 'code'` column to `clusters` table:
- `'code'` — clusters from code relations (imports, calls, extends, implements, uses_type)
- `'doc'` — clusters from wiki_link relations
- Existing clusters get `'code'` automatically

#### 3.2 Clustering Logic

`detectClusters` is called **twice per collection**:
1. With code relation types → produces `kind = 'code'` clusters
2. With `wiki_link` type only → produces `kind = 'doc'` clusters

Singleton filter (≥2 members) applies to each independently.

#### 3.3 CLI Output

```
$ hwicortex graph clusters
Code Clusters:

  PlayerController (bb3) — 8 files
    Scripts/Player/PlayerController.cs
    Scripts/Player/PlayerMovement.cs
    ...

Doc Clusters:

  설정 (bb3) — 4 files
    specs/2026-04-09-settings.md
    specs/2026-04-09-profile.md
    ...
```

New option: `--kind code|doc` to filter.

#### 3.4 Obsidian Output

Cluster pages separated by kind:
- `vault/wiki/{project}/_clusters/code/` — code cluster pages
- `vault/wiki/{project}/_clusters/doc/` — document cluster pages

---

## Changes

| File | Change |
|---|---|
| `package.json` | Add `tree-sitter-c-sharp` to optionalDependencies |
| `src/ast.ts` | C# language registration, symbol queries, relation extraction; `extractWikiLinks` function |
| `src/graph.ts` | Symbol-name fallback in `resolveTargetHashes`; wiki-link title matching; `detectClusters` kind filter; `saveClusters` kind column |
| `src/store.ts` | Call `extractWikiLinks` for `.md` files in reindex |
| `src/cli/graph.ts` | `handleClusters` code/doc split output; `--kind` option |
| `src/cli/graph-obsidian.ts` | Cluster output directory split by kind |
| `src/cli/qmd.ts` | `--kind` CLI option parsing |
| `src/migration/runner.ts` | v4 migration: add `kind` column to clusters |

## Tests

| Test File | Coverage |
|---|---|
| `test/ast-relations.test.ts` | C# symbol extraction; using/extends/implements/attribute/call relations |
| `test/wiki-links.test.ts` (new) | Wiki-link parsing; code block exclusion; folder path handling |
| `test/graph.test.ts` | Symbol-name resolve; wiki-link title resolve; kind-separated clustering |
| `test/graph-integration.test.ts` | Mixed .cs + .md collection end-to-end |
