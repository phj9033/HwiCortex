# Graph Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add code relationship graph capabilities to HwiCortex — AST-based symbol/relation extraction, clustering, graph CLI commands, search result enrichment, and Obsidian visualization — all without LLM calls.

**Architecture:** Extend the existing AST parser (`src/ast.ts`) to extract symbols and relations alongside break points. Store in new SQLite tables via migration v3. Integrate extraction into the `reindexCollection()` flow. Add graph CLI commands and enrich search output with relation context. Generate Obsidian-compatible cluster/relation pages.

**Tech Stack:** web-tree-sitter (existing), better-sqlite3 (existing), label propagation (new, pure JS), vitest (existing)

**Spec:** `docs/superpowers/specs/2026-04-14-graph-integration-design.md`

---

## File Structure

### New files
- `src/graph.ts` — Graph queries, clustering, path finding, relation resolution
- `src/cli/graph.ts` — CLI handlers for graph/path/related/symbol/clusters commands
- `test/graph.test.ts` — Graph module unit tests
- `test/ast-relations.test.ts` — AST symbol/relation extraction tests

### Modified files
- `src/ast.ts` — Add symbol & relation extraction to existing AST parser
- `src/store.ts` — Add graph tables, integrate extraction into reindex flow
- `src/migration/runner.ts` — Add migration v3 for new tables
- `src/cli/qmd.ts` — Register new graph commands in switch statement
- `src/cli/formatter.ts` — Add graph context to search result formatters

---

## Task 1: Database Migration (symbols, relations, clusters tables)

**Files:**
- Modify: `src/migration/runner.ts:111-153`
- Test: `test/graph.test.ts` (new)

- [ ] **Step 1: Write failing test for migration v3**

```typescript
// test/graph.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations, DEFAULT_MIGRATIONS } from "../src/migration/runner";

describe("graph migration v3", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    // Create base tables needed by migrations v1/v2
    db.exec(`
      CREATE TABLE IF NOT EXISTS content (hash TEXT PRIMARY KEY, doc TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT, collection TEXT NOT NULL, path TEXT NOT NULL,
        title TEXT, hash TEXT NOT NULL, active INTEGER DEFAULT 1, modified_at TEXT, indexed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS store_collections (
        name TEXT PRIMARY KEY, path TEXT NOT NULL, pattern TEXT NOT NULL DEFAULT '**/*.md'
      );
    `);
  });

  afterEach(() => db.close());

  it("creates symbols table", () => {
    runMigrations(db, ":memory:", DEFAULT_MIGRATIONS);
    const info = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='symbols'").get();
    expect(info).toBeTruthy();
  });

  it("creates relations table", () => {
    runMigrations(db, ":memory:", DEFAULT_MIGRATIONS);
    const info = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='relations'").get();
    expect(info).toBeTruthy();
  });

  it("creates clusters and cluster_members tables", () => {
    runMigrations(db, ":memory:", DEFAULT_MIGRATIONS);
    const clusters = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='clusters'").get();
    const members = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cluster_members'").get();
    expect(clusters).toBeTruthy();
    expect(members).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/graph.test.ts --reporter=verbose`
Expected: FAIL — tables not created

- [ ] **Step 3: Add migration v3 to runner.ts**

Add to `DEFAULT_MIGRATIONS` array after the existing version 2 entry at line ~153 in `src/migration/runner.ts`:

```typescript
{
  version: 3,
  description: "Add graph tables: symbols, relations, clusters, cluster_members",
  up(db: Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS symbols (
        id INTEGER PRIMARY KEY,
        hash TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        line INTEGER,
        FOREIGN KEY (hash) REFERENCES content(hash)
      );
      CREATE INDEX IF NOT EXISTS idx_symbols_hash ON symbols(hash);
      CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);

      CREATE TABLE IF NOT EXISTS relations (
        id INTEGER PRIMARY KEY,
        source_hash TEXT NOT NULL,
        target_hash TEXT,
        target_ref TEXT NOT NULL,
        type TEXT NOT NULL,
        source_symbol TEXT,
        target_symbol TEXT,
        confidence REAL DEFAULT 1.0,
        FOREIGN KEY (source_hash) REFERENCES content(hash)
      );
      CREATE INDEX IF NOT EXISTS idx_relations_source ON relations(source_hash);
      CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(target_hash);
      CREATE INDEX IF NOT EXISTS idx_relations_type ON relations(type);

      CREATE TABLE IF NOT EXISTS clusters (
        id INTEGER PRIMARY KEY,
        collection TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(collection, name)
      );

      CREATE TABLE IF NOT EXISTS cluster_members (
        cluster_id INTEGER NOT NULL,
        hash TEXT NOT NULL,
        PRIMARY KEY (cluster_id, hash),
        FOREIGN KEY (cluster_id) REFERENCES clusters(id),
        FOREIGN KEY (hash) REFERENCES content(hash)
      );
    `);
  },
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/graph.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/migration/runner.ts test/graph.test.ts
git commit -m "feat(graph): add migration v3 for symbols, relations, clusters tables"
```

---

## Task 2: AST Symbol Extraction

**Files:**
- Modify: `src/ast.ts:365-391` (expand extractSymbols stub)
- Test: `test/ast-relations.test.ts` (new)

- [ ] **Step 1: Write failing tests for symbol extraction**

```typescript
// test/ast-relations.test.ts
import { describe, it, expect } from "vitest";
import { extractSymbolsAndRelations } from "../src/ast";

describe("extractSymbolsAndRelations", () => {
  describe("TypeScript symbols", () => {
    it("extracts function declarations", async () => {
      const code = `export function createStore(opts: Options): Store { return new Store(opts); }`;
      const result = await extractSymbolsAndRelations(code, "test.ts");
      expect(result.symbols).toContainEqual(
        expect.objectContaining({ name: "createStore", kind: "function" })
      );
    });

    it("extracts class declarations", async () => {
      const code = `export class SearchEngine { search() {} }`;
      const result = await extractSymbolsAndRelations(code, "test.ts");
      expect(result.symbols).toContainEqual(
        expect.objectContaining({ name: "SearchEngine", kind: "class" })
      );
    });

    it("extracts interface declarations", async () => {
      const code = `export interface Config { dbPath: string; }`;
      const result = await extractSymbolsAndRelations(code, "test.ts");
      expect(result.symbols).toContainEqual(
        expect.objectContaining({ name: "Config", kind: "interface" })
      );
    });

    it("extracts method declarations inside class", async () => {
      const code = `class Foo { bar() {} baz() {} }`;
      const result = await extractSymbolsAndRelations(code, "test.ts");
      expect(result.symbols).toContainEqual(
        expect.objectContaining({ name: "bar", kind: "method" })
      );
    });
  });

  describe("Python symbols", () => {
    it("extracts function and class", async () => {
      const code = `class MyClass:\n    def my_method(self):\n        pass\n\ndef my_func():\n    pass`;
      const result = await extractSymbolsAndRelations(code, "test.py");
      expect(result.symbols).toContainEqual(
        expect.objectContaining({ name: "MyClass", kind: "class" })
      );
      expect(result.symbols).toContainEqual(
        expect.objectContaining({ name: "my_func", kind: "function" })
      );
    });
  });

  it("returns empty for unsupported languages", async () => {
    const result = await extractSymbolsAndRelations("# hello", "test.md");
    expect(result.symbols).toEqual([]);
    expect(result.relations).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/ast-relations.test.ts --reporter=verbose`
Expected: FAIL — extractSymbolsAndRelations not exported or not implemented

- [ ] **Step 3: Implement symbol extraction in ast.ts**

Replace the stubbed `extractSymbols()` function (lines 384-391) and add new types. Add new tree-sitter queries for symbol capture alongside existing `LANGUAGE_QUERIES`.

New exported types:
```typescript
export interface AstSymbol {
  name: string;
  kind: "function" | "class" | "interface" | "type" | "enum" | "method";
  line: number;
}

export interface AstRelation {
  type: "imports" | "calls" | "extends" | "implements" | "uses_type";
  sourceSymbol?: string;
  targetRef: string;
  targetSymbol?: string;
}

export interface AstAnalysis {
  symbols: AstSymbol[];
  relations: AstRelation[];
}
```

New `SYMBOL_QUERIES` map (similar structure to `LANGUAGE_QUERIES`):
- TypeScript: query for `class_declaration > name`, `function_declaration > name`, `interface_declaration > name`, `type_alias_declaration > name`, `enum_declaration > name`, `method_definition > name`
- Python: `class_definition > name`, `function_definition > name`
- Go: `function_declaration > name`, `method_declaration > name`, `type_spec > name`
- Rust: `function_item > name`, `struct_item > name`, `enum_item > name`, `trait_item > name`

New `extractSymbolsAndRelations(content: string, filepath: string): Promise<AstAnalysis>`:
- Detect language, load grammar, parse tree
- Run symbol queries → populate `AstSymbol[]`
- Graceful fallback: return empty on parse failure

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/ast-relations.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ast.ts test/ast-relations.test.ts
git commit -m "feat(graph): add AST symbol extraction for TS/JS/Python/Go/Rust"
```

---

## Task 3: AST Relation Extraction

**Files:**
- Modify: `src/ast.ts` (extend `extractSymbolsAndRelations`)
- Test: `test/ast-relations.test.ts` (add relation tests)

- [ ] **Step 1: Write failing tests for relation extraction**

Add to `test/ast-relations.test.ts`:

```typescript
describe("relation extraction", () => {
  describe("imports", () => {
    it("extracts TypeScript imports", async () => {
      const code = `import { createStore } from './store';\nimport path from 'path';`;
      const result = await extractSymbolsAndRelations(code, "test.ts");
      const imports = result.relations.filter(r => r.type === "imports");
      expect(imports).toContainEqual(
        expect.objectContaining({ targetRef: "./store", targetSymbol: "createStore" })
      );
    });

    it("extracts Python from-imports", async () => {
      const code = `from .store import create_store`;
      const result = await extractSymbolsAndRelations(code, "test.py");
      expect(result.relations).toContainEqual(
        expect.objectContaining({ type: "imports", targetRef: ".store", targetSymbol: "create_store" })
      );
    });
  });

  describe("extends", () => {
    it("extracts TypeScript class extends", async () => {
      const code = `class SearchEngine extends BaseEngine {}`;
      const result = await extractSymbolsAndRelations(code, "test.ts");
      expect(result.relations).toContainEqual(
        expect.objectContaining({ type: "extends", sourceSymbol: "SearchEngine", targetRef: "BaseEngine" })
      );
    });
  });

  describe("implements", () => {
    it("extracts TypeScript implements", async () => {
      const code = `class Store implements IStore {}`;
      const result = await extractSymbolsAndRelations(code, "test.ts");
      expect(result.relations).toContainEqual(
        expect.objectContaining({ type: "implements", sourceSymbol: "Store", targetRef: "IStore" })
      );
    });
  });

  describe("calls filtering", () => {
    it("only captures calls to imported symbols", async () => {
      const code = `import { foo } from './mod';\nfunction bar() { foo(); console.log('hi'); }`;
      const result = await extractSymbolsAndRelations(code, "test.ts");
      const calls = result.relations.filter(r => r.type === "calls");
      expect(calls).toContainEqual(
        expect.objectContaining({ type: "calls", targetSymbol: "foo" })
      );
      // console.log should NOT be in calls
      expect(calls.find(c => c.targetSymbol === "log")).toBeUndefined();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/ast-relations.test.ts --reporter=verbose`
Expected: FAIL — relation extraction not implemented

- [ ] **Step 3: Implement relation extraction in ast.ts**

Extend `extractSymbolsAndRelations()` to also extract relations:

**imports:** Parse `import_statement` → extract source path and imported names. Cache imported names for calls filtering.

**extends/implements:** Parse `class_declaration` → check `class_heritage` / `extends_clause` / `implements_clause` children.

**calls:** Parse `call_expression` → extract function name → cross-check against cached imported names. Only emit if the callee was imported.

**uses_type:** Parse type annotations → cross-check against imported type names.

Each language gets its own relation extraction logic within the same function, selected by `detectLanguage()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/ast-relations.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ast.ts test/ast-relations.test.ts
git commit -m "feat(graph): add relation extraction (imports, extends, implements, calls)"
```

---

## Task 4: Graph Module — Storage & Queries

**Files:**
- Create: `src/graph.ts`
- Test: `test/graph.test.ts` (extend)

- [ ] **Step 1: Write failing tests for graph storage and queries**

Add to `test/graph.test.ts`:

```typescript
import { saveSymbols, saveRelations, getRelationsForHash, getSymbolUsages, resolveTargetHashes } from "../src/graph";

describe("graph storage", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    // Run all migrations including v3
    runMigrations(db, ":memory:", DEFAULT_MIGRATIONS);
    // Seed content and documents
    db.exec(`
      INSERT INTO content VALUES ('hash_a', 'content a', datetime('now'));
      INSERT INTO content VALUES ('hash_b', 'content b', datetime('now'));
      INSERT INTO documents VALUES (1, 'test', 'src/a.ts', 'a', 'hash_a', 1, NULL, NULL);
      INSERT INTO documents VALUES (2, 'test', 'src/b.ts', 'b', 'hash_b', 1, NULL, NULL);
    `);
  });

  afterEach(() => db.close());

  it("saves and retrieves symbols", () => {
    saveSymbols(db, "hash_a", [
      { name: "createStore", kind: "function", line: 1 },
    ]);
    const symbols = db.prepare("SELECT * FROM symbols WHERE hash = ?").all("hash_a");
    expect(symbols).toHaveLength(1);
    expect(symbols[0].name).toBe("createStore");
  });

  it("saves and retrieves relations", () => {
    saveRelations(db, "hash_a", [
      { type: "imports", targetRef: "./b", targetSymbol: "foo" },
    ]);
    const rels = getRelationsForHash(db, "hash_a");
    expect(rels).toHaveLength(1);
    expect(rels[0].target_ref).toBe("./b");
  });

  it("resolves target_hash from import paths", () => {
    saveRelations(db, "hash_a", [
      { type: "imports", targetRef: "./b" },
    ]);
    resolveTargetHashes(db, "test");
    const rels = getRelationsForHash(db, "hash_a");
    expect(rels[0].target_hash).toBe("hash_b");
  });

  it("finds symbol usages across files", () => {
    saveSymbols(db, "hash_a", [{ name: "foo", kind: "function", line: 1 }]);
    saveRelations(db, "hash_b", [
      { type: "calls", targetSymbol: "foo", targetRef: "foo" },
    ]);
    const usages = getSymbolUsages(db, "foo");
    expect(usages.defined).toContainEqual(expect.objectContaining({ hash: "hash_a" }));
    expect(usages.usedBy).toContainEqual(expect.objectContaining({ source_hash: "hash_b" }));
  });

  it("getFileGraph aggregates all relation types for a file", () => {
    saveRelations(db, "hash_a", [
      { type: "imports", targetRef: "./b", targetSymbol: "foo" },
    ]);
    saveRelations(db, "hash_b", [
      { type: "imports", targetRef: "./a", targetSymbol: "bar" },
    ]);
    resolveTargetHashes(db, "test");
    const graph = getFileGraph(db, "hash_a");
    expect(graph.imports).toHaveLength(1);
    expect(graph.importedBy).toHaveLength(1);
  });

  it("findPath returns shortest path between two files", () => {
    // a → b → c (chain of imports)
    db.exec(`INSERT INTO content VALUES ('hash_c', 'content c', datetime('now'))`);
    db.exec(`INSERT INTO documents VALUES (3, 'test', 'src/c.ts', 'c', 'hash_c', 1, NULL, NULL)`);
    saveRelations(db, "hash_a", [{ type: "imports", targetRef: "./b", targetSymbol: "b" }]);
    saveRelations(db, "hash_b", [{ type: "imports", targetRef: "./c", targetSymbol: "c" }]);
    resolveTargetHashes(db, "test");
    const path = findPath(db, "hash_a", "hash_c");
    expect(path).not.toBeNull();
    expect(path).toEqual(["hash_a", "hash_b", "hash_c"]);
  });

  it("findPath returns null when no path exists", () => {
    db.exec(`INSERT INTO content VALUES ('hash_z', 'content z', datetime('now'))`);
    db.exec(`INSERT INTO documents VALUES (3, 'test', 'src/z.ts', 'z', 'hash_z', 1, NULL, NULL)`);
    const path = findPath(db, "hash_a", "hash_z");
    expect(path).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/graph.test.ts --reporter=verbose`
Expected: FAIL — graph module doesn't exist

- [ ] **Step 3: Implement graph.ts**

Create `src/graph.ts` with functions:

```typescript
export function saveSymbols(db: Database, hash: string, symbols: AstSymbol[]): void
// DELETE existing symbols for hash, INSERT new ones

export function saveRelations(db: Database, hash: string, relations: AstRelation[]): void
// DELETE existing relations for source_hash, INSERT new ones

export function getRelationsForHash(db: Database, hash: string): RelationRow[]
// SELECT from relations WHERE source_hash = ? OR target_hash = ?

export function getSymbolUsages(db: Database, symbolName: string): { defined: SymbolRow[], usedBy: RelationRow[] }
// JOIN symbols + relations on target_symbol

export function resolveTargetHashes(db: Database, collection: string): number
// UPDATE relations SET target_hash = ... by matching target_ref against documents.path
// Returns count of resolved refs

export function getFileGraph(db: Database, hash: string): FileGraphInfo
// Aggregate: imports, importedBy, extends, cluster membership

export function findPath(db: Database, fromHash: string, toHash: string): string[] | null
// BFS over relations to find shortest path between two files
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/graph.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/graph.ts test/graph.test.ts
git commit -m "feat(graph): add graph storage, queries, path finding"
```

---

## Task 5: Clustering (Label Propagation)

**Files:**
- Modify: `src/graph.ts` (add clustering functions)
- Test: `test/graph.test.ts` (add clustering tests)

- [ ] **Step 1: Write failing tests for clustering**

```typescript
describe("clustering", () => {
  // Extend seed data for clustering tests
  beforeEach(() => {
    db.exec(`
      INSERT INTO content VALUES ('hash_c', 'content c', datetime('now'));
      INSERT INTO content VALUES ('hash_x', 'content x', datetime('now'));
      INSERT INTO content VALUES ('hash_y', 'content y', datetime('now'));
      INSERT INTO documents VALUES (3, 'test', 'src/c.ts', 'c', 'hash_c', 1, NULL, NULL);
      INSERT INTO documents VALUES (4, 'test', 'src/x.ts', 'x', 'hash_x', 1, NULL, NULL);
      INSERT INTO documents VALUES (5, 'test', 'src/y.ts', 'y', 'hash_y', 1, NULL, NULL);
    `);
  });

  it("detects clusters from relations", () => {
    // Create a graph with two clear clusters:
    // Cluster 1: a.ts → b.ts → c.ts
    // Cluster 2: x.ts → y.ts
    saveRelations(db, "hash_a", [{ type: "imports", targetRef: "./b", targetSymbol: "b" }]);
    saveRelations(db, "hash_b", [{ type: "imports", targetRef: "./c", targetSymbol: "c" }]);
    saveRelations(db, "hash_x", [{ type: "imports", targetRef: "./y", targetSymbol: "y" }]);
    // Resolve target_hash so clustering can build adjacency
    resolveTargetHashes(db, "test");

    const clusters = detectClusters(db, "test");
    expect(clusters.length).toBeGreaterThanOrEqual(2);
  });

  it("saves clusters to database", () => {
    saveRelations(db, "hash_a", [{ type: "imports", targetRef: "./b", targetSymbol: "b" }]);
    resolveTargetHashes(db, "test");
    const clusters = detectClusters(db, "test");
    saveClusters(db, "test", nameClusters(db, clusters));

    const rows = db.prepare("SELECT * FROM clusters WHERE collection = ?").all("test");
    expect(rows.length).toBeGreaterThan(0);

    const members = db.prepare("SELECT * FROM cluster_members").all();
    expect(members.length).toBeGreaterThan(0);
  });

  it("names clusters by most-imported symbol", () => {
    saveSymbols(db, "hash_a", [{ name: "createStore", kind: "function", line: 1 }]);
    saveRelations(db, "hash_b", [{ type: "imports", targetRef: "./a", targetSymbol: "createStore" }]);
    saveRelations(db, "hash_c", [{ type: "imports", targetRef: "./a", targetSymbol: "createStore" }]);
    resolveTargetHashes(db, "test");

    const clusters = detectClusters(db, "test");
    const named = nameClusters(db, clusters);
    expect(named[0].name).toContain("createStore");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/graph.test.ts --reporter=verbose`
Expected: FAIL — detectClusters not defined

- [ ] **Step 3: Implement label propagation clustering**

Add to `src/graph.ts`:

```typescript
export function detectClusters(db: Database, collection: string): ClusterResult[]
// 1. Build adjacency list from relations (both directions)
// 2. Run label propagation:
//    - Assign each node its own label
//    - Iterate: each node adopts most frequent neighbor label
//    - Converge when no labels change (max 100 iterations)
// 3. Group nodes by final label
// 4. Filter: clusters with < 2 members are singletons (skip)

export function nameClusters(db: Database, clusters: ClusterResult[]): NamedCluster[]
// For each cluster, find the symbol that is most imported (target_symbol count)
// Fallback: use the most common filename stem

export function saveClusters(db: Database, collection: string, clusters: NamedCluster[]): void
// DELETE existing clusters for collection
// INSERT new clusters + cluster_members
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/graph.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/graph.ts test/graph.test.ts
git commit -m "feat(graph): add label propagation clustering"
```

---

## Task 6: Integrate into reindexCollection() Flow

**Files:**
- Modify: `src/store.ts:1171-1180` (reindexCollection)
- Test: `test/store.test.ts` (add integration test)

- [ ] **Step 1: Write failing test for graph extraction during reindex**

Add to `test/store.test.ts` or create `test/graph-integration.test.ts`:

```typescript
describe("reindex with graph extraction", () => {
  it("populates symbols table after reindex of .ts files", async () => {
    // Create a temp collection with a .ts file containing a function
    // Run reindexCollection()
    // Verify symbols table has entries
  });

  it("populates relations table for import statements", async () => {
    // Create temp collection with two .ts files, one importing the other
    // Run reindexCollection()
    // Verify relations table has import entry
  });

  it("skips graph extraction for markdown files", async () => {
    // Create temp collection with .md file
    // Run reindexCollection()
    // Verify symbols table is empty
  });

  it("resolves target_hash after all files indexed", async () => {
    // Two .ts files: a imports b
    // Run reindexCollection()
    // Verify relation has target_hash populated
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/graph-integration.test.ts --reporter=verbose`
Expected: FAIL

- [ ] **Step 3: Integrate graph extraction into store.ts**

In `reindexCollection()` (around line 1259, after the document is inserted/updated and FTS is built):

```typescript
// After: upsertFTS(db, doc, content)
// Add: graph extraction (skip if hash unchanged unless --force)
if (detectLanguage(filepath) !== null) {
  const existingSymbols = db.prepare("SELECT 1 FROM symbols WHERE hash = ? LIMIT 1").get(hash);
  if (!existingSymbols || opts.force) {
    const analysis = await extractSymbolsAndRelations(content, filepath);
    if (analysis.symbols.length > 0 || analysis.relations.length > 0) {
      saveSymbols(db, hash, analysis.symbols);
      saveRelations(db, hash, analysis.relations);
    }
  }
}
```

After all files in the collection are processed:

```typescript
// Resolve target hashes (including previously NULL ones from prior runs)
resolveTargetHashes(db, collectionName);

// Run clustering
const clusters = detectClusters(db, collectionName);
if (clusters.length > 0) {
  const named = nameClusters(db, clusters);
  saveClusters(db, collectionName, named);
}
```

In the document deactivation loop (around line 1266, where inactive documents are cleaned up):

```typescript
// Cleanup orphaned graph data for deactivated documents
db.prepare("DELETE FROM symbols WHERE hash = ?").run(deactivatedHash);
db.prepare("DELETE FROM relations WHERE source_hash = ?").run(deactivatedHash);
```

Import `detectLanguage` from `./ast` (already used in `chunkDocumentAsync`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/graph-integration.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/store.ts test/graph-integration.test.ts
git commit -m "feat(graph): integrate symbol/relation extraction into reindex flow"
```

---

## Task 7: CLI Graph Commands

**Files:**
- Create: `src/cli/graph.ts`
- Modify: `src/cli/qmd.ts:2920` (add cases to switch)
- Test: `test/graph-cli.test.ts` (new)

- [ ] **Step 1: Write failing tests for CLI graph handlers**

```typescript
// test/graph-cli.test.ts
import { describe, it, expect } from "vitest";
import { handleGraph, handlePath, handleRelated, handleSymbol, handleClusters } from "../src/cli/graph";

describe("CLI graph handlers", () => {
  // Setup: in-memory DB with seeded graph data

  it("handleGraph returns file relationships", async () => {
    const output = await handleGraph(db, "src/a.ts", {});
    expect(output).toContain("imports");
  });

  it("handlePath finds connection between files", async () => {
    const output = await handlePath(db, "src/a.ts", "src/c.ts", {});
    expect(output).toContain("→");
  });

  it("handleRelated lists related files", async () => {
    const output = await handleRelated(db, "src/a.ts", {});
    expect(output).toContain("src/b.ts");
  });

  it("handleSymbol finds definition and usages", async () => {
    const output = await handleSymbol(db, "createStore", {});
    expect(output).toContain("defined in");
    expect(output).toContain("used by");
  });

  it("handleClusters lists all clusters", async () => {
    const output = await handleClusters(db, {});
    expect(output).toContain("cluster");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/graph-cli.test.ts --reporter=verbose`
Expected: FAIL

- [ ] **Step 3: Implement CLI graph handlers**

Create `src/cli/graph.ts`:

```typescript
interface GraphOpts {
  collection?: string;  // --collection flag, filters graph queries to one collection
  json?: boolean;       // --json output format
}

export async function handleGraph(db: Database, file: string, opts: GraphOpts): Promise<string>
// Look up document by path (filtered by opts.collection) → get hash → getFileGraph() → format output

export async function handlePath(db: Database, fileA: string, fileB: string, opts: GraphOpts): Promise<string>
// Look up both hashes → findPath() → format as "a.ts → imports → b.ts → imports → c.ts"

export async function handleRelated(db: Database, file: string, opts: GraphOpts): Promise<string>
// Direct relations + same cluster members → deduplicate → format

export async function handleSymbol(db: Database, name: string, opts: GraphOpts): Promise<string>
// getSymbolUsages() → format "defined in: ..., used by: ..."

export async function handleClusters(db: Database, opts: GraphOpts): Promise<string>
// Query clusters (filtered by opts.collection) + cluster_members → format table
```

- [ ] **Step 4: Register commands in qmd.ts**

Add cases to the switch statement at line ~2920 in `src/cli/qmd.ts`:

```typescript
case "graph": {
  const subcmd = cli.args[0];
  if (subcmd === "clusters") {
    await handleClusters(db, opts);
  } else {
    await handleGraph(db, subcmd, opts);
  }
  break;
}
case "path": {
  await handlePath(db, cli.args[0], cli.args[1], opts);
  break;
}
case "related": {
  await handleRelated(db, cli.args[0], opts);
  break;
}
case "symbol": {
  await handleSymbol(db, cli.args[0], opts);
  break;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/graph-cli.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/cli/graph.ts src/cli/qmd.ts test/graph-cli.test.ts
git commit -m "feat(graph): add graph/path/related/symbol/clusters CLI commands"
```

---

## Task 8: Search Result Enrichment

**Files:**
- Modify: `src/cli/qmd.ts:1950` (outputResults)
- Modify: `src/cli/formatter.ts:385-408`
- Test: `test/graph.test.ts` (add enrichment tests)

- [ ] **Step 1: Write failing test for search enrichment**

```typescript
describe("search result graph enrichment", () => {
  it("appends cluster and relation info to search results", () => {
    // Seed graph data for a document
    // Call enrichSearchResults()
    // Verify result has cluster and importedByCount fields
  });

  it("returns unenriched results when --no-graph flag is set", () => {
    // Same setup, but with noGraph: true
    // Verify no graph fields present
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/graph.test.ts --reporter=verbose`
Expected: FAIL

- [ ] **Step 3: Implement search result enrichment**

Add to `src/graph.ts`:

```typescript
export function enrichSearchResults(db: Database, results: SearchResult[]): EnrichedSearchResult[]
// For each result:
//   - Look up hash → get cluster name from cluster_members JOIN clusters
//   - Count relations where target_hash = this hash (importedByCount)
//   - Attach as extra fields
```

Modify `outputResults()` in `src/cli/qmd.ts` (line ~1950):
- Check for `--no-graph` flag
- If not set, call `enrichSearchResults()` before formatting
- Pass enriched data to formatters

Modify CLI output in `src/cli/formatter.ts`:
- In the CLI format section, append a line: `cluster: X | imported by: N files`
- In JSON format, add `cluster` and `importedByCount` fields

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/graph.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/graph.ts src/cli/qmd.ts src/cli/formatter.ts test/graph.test.ts
git commit -m "feat(graph): enrich search results with cluster and relation context"
```

---

## Task 9: Obsidian Visualization

**Files:**
- Create: `src/cli/graph-obsidian.ts`
- Test: `test/graph-obsidian.test.ts` (new)

- [ ] **Step 1: Write failing tests for Obsidian output**

```typescript
// test/graph-obsidian.test.ts
describe("Obsidian cluster pages", () => {
  it("generates cluster index page with frontmatter", () => {
    const page = generateClusterPage(clusterData);
    expect(page).toContain("tags: [cluster, auto-generated]");
    expect(page).toContain("## store-core");
    expect(page).toContain("[[store]]");
  });

  it("generates file relation page with wiki links", () => {
    const page = generateRelationPage(fileData);
    expect(page).toContain("imports: [[db]]");
    expect(page).toContain("imported by: [[cli/qmd]]");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/graph-obsidian.test.ts --reporter=verbose`
Expected: FAIL

- [ ] **Step 3: Implement Obsidian page generators**

Create `src/cli/graph-obsidian.ts`:

```typescript
export function generateClusterPage(cluster: NamedCluster, members: MemberInfo[]): string
// Returns markdown with YAML frontmatter, file list with [[wiki links]], relation summary

export function generateRelationPage(file: FileGraphInfo): string
// Returns markdown with symbols list, imports/importedBy as [[wiki links]]

export async function writeObsidianGraph(db: Database, vaultPath: string, project: string): Promise<void>
// 1. Create vault/wiki/{project}/_clusters/ directory
// 2. For each cluster: write cluster index page
// 3. For each file with relations: write relation page
// 4. Report: "Generated N cluster pages, M relation pages"
```

- [ ] **Step 4: Register `--obsidian` flag in CLI**

Add to `graph` command handler in `src/cli/qmd.ts`:

```typescript
case "graph": {
  if (cli.flags.obsidian) {
    await writeObsidianGraph(db, vaultPath, project);
  } else if (subcmd === "clusters") {
    // ...existing
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/graph-obsidian.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/cli/graph-obsidian.ts src/cli/qmd.ts test/graph-obsidian.test.ts
git commit -m "feat(graph): add Obsidian visualization with cluster and relation pages"
```

---

## Task 10: Documentation Update

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md**

Add to the Commands section:

```markdown
## Graph Commands

```sh
hwicortex graph <file>                  # Show file relationships
hwicortex path <fileA> <fileB>          # Find connection path between files
hwicortex related <file>                # Show related files (direct + cluster)
hwicortex symbol <name>                 # Find where a symbol is defined and used
hwicortex graph clusters [--collection] # List auto-detected module clusters
hwicortex graph --obsidian              # Generate Obsidian cluster/relation pages
```

## Graph Options

```sh
--no-graph              # Disable graph context in search results
--collection <name>     # Restrict graph commands to a collection
```
```

Add note about graph extraction:

```markdown
## Architecture (addition)

- Graph extraction: AST-based symbol and relation extraction (imports, calls, extends, implements, uses_type)
- Calls filtering: only tracks calls to imported symbols within the same collection
- Clustering: label propagation algorithm (pure JS, no external deps)
- Relation data is extracted automatically during `hwicortex update`
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add graph commands and architecture to CLAUDE.md"
```

---

## Task 11: Run Full Test Suite

- [ ] **Step 1: Run all tests**

Run: `npx vitest run --reporter=verbose test/`
Expected: All tests PASS, including existing tests (no regressions)

- [ ] **Step 2: Run existing AST tests specifically**

Run: `npx vitest run test/ast.test.ts test/ast-chunking.test.ts --reporter=verbose`
Expected: PASS — existing break point behavior unchanged

- [ ] **Step 3: Fix any regressions if found**

- [ ] **Step 4: Final commit if fixes needed**

```bash
git commit -m "fix: resolve test regressions from graph integration"
```
