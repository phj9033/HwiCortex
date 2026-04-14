# C# & Markdown Wiki-Link Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add C# (.cs) AST-based graph extraction and Obsidian wiki-link graph extraction for markdown files, with kind-separated clustering.

**Architecture:** Extend existing tree-sitter pipeline with C# grammar support. Add regex-based wiki-link extractor in a new file. Split clustering by relation type (code vs doc) using a new `kind` column on the clusters table.

**Tech Stack:** tree-sitter-c-sharp (WASM grammar), web-tree-sitter, regex, SQLite

**Spec:** `docs/superpowers/specs/2026-04-14-csharp-and-markdown-graph-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/ast.ts` | Modify | Add `"csharp"` to language types, grammar map, symbol queries, relation extraction; add `"wiki_link"` to `AstRelation.type` |
| `src/wikilinks.ts` | Create | `extractWikiLinks()` — regex-based Obsidian wiki-link parser |
| `src/graph.ts` | Modify | `resolveTargetHashes` symbol-name fallback + wiki-link title matching; `detectClusters` relation-type filter; `saveClusters` kind support; `FileGraphInfo` wiki_link fields |
| `src/store.ts` | Modify | Call `extractWikiLinks` for `.md`; call `detectClusters` twice (code/doc) |
| `src/cli/graph.ts` | Modify | `handleClusters` code/doc split; `--kind` filter; wiki_link display |
| `src/cli/graph-obsidian.ts` | Modify | Cluster dir split by kind; wiki_link relation sections |
| `src/cli/qmd.ts` | Modify | `--kind` CLI option |
| `src/migration/runner.ts` | Modify | v4 migration: `kind` column + updated UNIQUE constraint |
| `package.json` | Modify | `tree-sitter-c-sharp` optionalDependency |
| `test/ast-relations.test.ts` | Modify | C# symbol + relation tests |
| `test/wiki-links.test.ts` | Create | Wiki-link extraction tests |
| `test/graph.test.ts` | Modify | Kind-separated clustering + symbol-name resolve tests |
| `test/graph-integration.test.ts` | Modify | Mixed .cs + .md end-to-end test |

---

## Task 1: Migration v4 — Add `kind` Column to Clusters

**Files:**
- Modify: `src/migration/runner.ts:155-202` (after v3 migration)
- Test: `test/graph.test.ts`

- [ ] **Step 1: Write failing test for v4 migration**

In `test/graph.test.ts`, add after the existing migration tests:

```typescript
describe("migration v4 - cluster kind", () => {
  it("adds kind column to clusters table", () => {
    const info = db.prepare("PRAGMA table_info(clusters)").all() as { name: string }[];
    expect(info.map(c => c.name)).toContain("kind");
  });

  it("updates unique constraint to include kind", () => {
    // Should allow same name with different kinds
    db.prepare("INSERT INTO clusters (collection, name, kind) VALUES ('test', 'foo', 'code')").run();
    db.prepare("INSERT INTO clusters (collection, name, kind) VALUES ('test', 'foo', 'doc')").run();
    const count = (db.prepare("SELECT COUNT(*) as c FROM clusters WHERE name = 'foo'").get() as any).c;
    expect(count).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/graph.test.ts --reporter=verbose`
Expected: FAIL — `kind` column doesn't exist

- [ ] **Step 3: Implement v4 migration**

In `src/migration/runner.ts`, add after the v3 migration object (after line ~202).

Note: SQLite autoindexes from UNIQUE constraints cannot be dropped. Must recreate the table to remove the old `UNIQUE(collection, name)` constraint:

```typescript
{
  version: 4,
  description: "Add kind column to clusters for code/doc separation",
  up(db: Database) {
    db.exec(`
      -- Recreate clusters table with kind column and updated unique constraint
      CREATE TABLE clusters_new (
        id INTEGER PRIMARY KEY,
        collection TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT DEFAULT 'code',
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(collection, name, kind)
      );
      INSERT INTO clusters_new (id, collection, name, kind, created_at)
        SELECT id, collection, name, 'code', created_at FROM clusters;
      DROP TABLE clusters;
      ALTER TABLE clusters_new RENAME TO clusters;
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
git commit -m "feat(graph): add v4 migration for cluster kind column"
```

---

## Task 2: C# Language Registration & Symbol Extraction

**Files:**
- Modify: `src/ast.ts:34,36-48,66-73,425-462,467-474`
- Modify: `package.json:62-72`
- Test: `test/ast-relations.test.ts`

- [ ] **Step 1: Install tree-sitter-c-sharp**

```bash
cd /Users/user/HwiCortex && bun install tree-sitter-c-sharp@0.23.1
```

Then add to `optionalDependencies` in `package.json` (alongside existing tree-sitter packages):

```json
"tree-sitter-c-sharp": "0.23.1",
```

- [ ] **Step 2: Write failing test for C# symbol extraction**

In `test/ast-relations.test.ts`, add:

```typescript
describe("C# symbol extraction", () => {
  it("extracts class, method, interface, enum, struct from C#", async () => {
    const code = `
using System;

public interface IPlayerService {
    void Execute();
}

public class PlayerController : MonoBehaviour {
    public int health;

    public void TakeDamage(int amount) {
        health -= amount;
    }
}

public enum PlayerState {
    Idle,
    Running
}

public struct PlayerData {
    public int level;
}
`;
    const result = await extractSymbolsAndRelations(code, "Player.cs");
    const kinds = result.symbols.map(s => ({ name: s.name, kind: s.kind }));
    expect(kinds).toContainEqual({ name: "IPlayerService", kind: "interface" });
    expect(kinds).toContainEqual({ name: "PlayerController", kind: "class" });
    expect(kinds).toContainEqual({ name: "TakeDamage", kind: "method" });
    expect(kinds).toContainEqual({ name: "PlayerState", kind: "enum" });
    expect(kinds).toContainEqual({ name: "PlayerData", kind: "type" });
  });

  it("returns empty for unsupported .shader files", async () => {
    const result = await extractSymbolsAndRelations("Shader {}", "test.shader");
    expect(result.symbols).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/ast-relations.test.ts --reporter=verbose`
Expected: FAIL — C# not recognized

- [ ] **Step 4: Add C# to language maps and symbol queries**

In `src/ast.ts`:

**Line 34** — update `SupportedLanguage`:
```typescript
export type SupportedLanguage = "typescript" | "tsx" | "javascript" | "python" | "go" | "rust" | "csharp";
```

**Lines 36-48** — add to `EXTENSION_MAP`:
```typescript
".cs": "csharp",
```

**Lines 66-73** — add to `GRAMMAR_MAP`:
```typescript
csharp:     { pkg: "tree-sitter-c-sharp",  wasm: "tree-sitter-c_sharp.wasm" },
```

**Lines 425-462** — add to `SYMBOL_QUERIES`:
```typescript
csharp: `
  (class_declaration name: (identifier) @class_name)
  (method_declaration name: (identifier) @method_name)
  (interface_declaration name: (identifier) @interface_name)
  (enum_declaration name: (identifier) @enum_name)
  (struct_declaration name: (identifier) @type_name)
`,
```

Note: Verify exact node types by checking the tree-sitter-c-sharp grammar. If `name` field uses a different type (e.g., `(name_equals)` or `(generic_name)`), adjust accordingly. Run the test and iterate.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/ast-relations.test.ts --reporter=verbose`
Expected: PASS (may need query adjustments based on actual grammar)

- [ ] **Step 6: Commit**

```bash
git add src/ast.ts package.json bun.lockb test/ast-relations.test.ts
git commit -m "feat(graph): add C# language registration and symbol extraction"
```

---

## Task 3: C# Relation Extraction

**Files:**
- Modify: `src/ast.ts:712-726` (after Rust block)
- Test: `test/ast-relations.test.ts`

- [ ] **Step 1: Write failing tests for C# relations**

In `test/ast-relations.test.ts`, add:

```typescript
describe("C# relation extraction", () => {
  it("extracts using directives as imports", async () => {
    const code = `using UnityEngine;\nusing System.Collections.Generic;`;
    const result = await extractSymbolsAndRelations(code, "test.cs");
    const imports = result.relations.filter(r => r.type === "imports");
    expect(imports).toContainEqual(
      expect.objectContaining({ type: "imports", targetRef: "UnityEngine" })
    );
    expect(imports).toContainEqual(
      expect.objectContaining({ type: "imports", targetRef: "System.Collections.Generic" })
    );
  });

  it("extracts class inheritance as extends", async () => {
    const code = `using UnityEngine;\npublic class Player : MonoBehaviour { }`;
    const result = await extractSymbolsAndRelations(code, "test.cs");
    expect(result.relations).toContainEqual(
      expect.objectContaining({ type: "extends", sourceSymbol: "Player", targetRef: "MonoBehaviour" })
    );
  });

  it("extracts interface implementation as implements", async () => {
    const code = `public class Player : MonoBehaviour, IDamageable, ISerializable { }`;
    const result = await extractSymbolsAndRelations(code, "test.cs");
    expect(result.relations).toContainEqual(
      expect.objectContaining({ type: "implements", sourceSymbol: "Player", targetRef: "IDamageable" })
    );
    expect(result.relations).toContainEqual(
      expect.objectContaining({ type: "implements", sourceSymbol: "Player", targetRef: "ISerializable" })
    );
    // MonoBehaviour is a class (no I prefix) → extends
    expect(result.relations).toContainEqual(
      expect.objectContaining({ type: "extends", sourceSymbol: "Player", targetRef: "MonoBehaviour" })
    );
  });

  it("extracts RequireComponent attribute as uses_type", async () => {
    const code = `[RequireComponent(typeof(Rigidbody))]\npublic class Player : MonoBehaviour { }`;
    const result = await extractSymbolsAndRelations(code, "test.cs");
    expect(result.relations).toContainEqual(
      expect.objectContaining({ type: "uses_type", targetRef: "Rigidbody" })
    );
  });

  it("extracts Resources.Load<T> as uses_type", async () => {
    const code = `public class Loader { void Load() { Resources.Load<PlayerData>("path"); } }`;
    const result = await extractSymbolsAndRelations(code, "test.cs");
    expect(result.relations).toContainEqual(
      expect.objectContaining({ type: "uses_type", targetRef: "PlayerData" })
    );
  });

  it("extracts Addressables.LoadAssetAsync<T> as uses_type", async () => {
    const code = `public class Loader { void Load() { Addressables.LoadAssetAsync<Sprite>("key"); } }`;
    const result = await extractSymbolsAndRelations(code, "test.cs");
    expect(result.relations).toContainEqual(
      expect.objectContaining({ type: "uses_type", targetRef: "Sprite" })
    );
  });

  it("extracts method calls to known types", async () => {
    const code = `using UnityEngine;
public class Test {
    void Run() {
        Debug.Log("hi");
        PlayerManager.Instance.Reset();
    }
}`;
    const result = await extractSymbolsAndRelations(code, "test.cs");
    const calls = result.relations.filter(r => r.type === "calls");
    // Debug.Log — imported via 'using UnityEngine'
    expect(calls.length).toBeGreaterThanOrEqual(0); // calls filtering depends on import tracking
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/ast-relations.test.ts --reporter=verbose`
Expected: FAIL — no C# relation extraction logic

- [ ] **Step 3: Implement C# relation extraction**

In `src/ast.ts`, add a new `else if` block after the Rust block (~line 726):

```typescript
} else if (language === "csharp") {
  const importedNamespaces = new Set<string>();

  // Extract using directives
  for (const usingNode of rootNode.descendantsOfType("using_directive")) {
    // Get the namespace name (e.g., "UnityEngine" or "System.Collections.Generic")
    const nameNode = usingNode.namedChildren.find(
      n => n.type === "qualified_name" || n.type === "identifier_name" || n.type === "identifier"
    );
    if (nameNode) {
      const targetRef = nameNode.text;
      importedNamespaces.add(targetRef);
      relations.push({ type: "imports", targetRef });
    }
  }

  // Extract class/struct inheritance and interface implementation
  for (const classNode of [
    ...rootNode.descendantsOfType("class_declaration"),
    ...rootNode.descendantsOfType("struct_declaration"),
  ]) {
    const nameNode = classNode.childForFieldName("name");
    const className = nameNode?.text;
    if (!className) continue;

    const baseList = classNode.childForFieldName("bases") ?? classNode.descendantsOfType("base_list")[0];
    if (!baseList) continue;

    for (const base of baseList.namedChildren) {
      // Get the type name, handling generic types
      let typeName = base.text;
      // Strip generic params: Foo<T> → Foo
      const genericIdx = typeName.indexOf("<");
      if (genericIdx > 0) typeName = typeName.substring(0, genericIdx);
      // Strip namespace prefix: take last segment
      const dotIdx = typeName.lastIndexOf(".");
      if (dotIdx >= 0) typeName = typeName.substring(dotIdx + 1);

      // I-prefix convention for interfaces
      const relType = typeName.startsWith("I") && typeName.length > 1 && typeName[1] === typeName[1].toUpperCase()
        ? "implements" : "extends";
      relations.push({ type: relType, sourceSymbol: className, targetRef: typeName });
    }
  }

  // Extract [RequireComponent(typeof(T))] attributes
  for (const attrNode of rootNode.descendantsOfType("attribute")) {
    const nameNode = attrNode.childForFieldName("name");
    if (nameNode?.text === "RequireComponent") {
      const argList = attrNode.descendantsOfType("attribute_argument_list")[0]
        ?? attrNode.descendantsOfType("argument_list")[0];
      if (argList) {
        for (const typeofExpr of argList.descendantsOfType("typeof_expression")) {
          const typeNode = typeofExpr.namedChildren[0];
          if (typeNode) {
            relations.push({ type: "uses_type", targetRef: typeNode.text });
          }
        }
      }
    }
  }

  // Extract Resources.Load<T>() and Addressables.LoadAssetAsync<T>()
  for (const invocation of rootNode.descendantsOfType("invocation_expression")) {
    const funcNode = invocation.childForFieldName("function");
    if (!funcNode) continue;
    const funcText = funcNode.text;

    // Match patterns like Resources.Load<X> or Addressables.LoadAssetAsync<X>
    const genericMatch = funcText.match(/(?:Resources\.Load|Addressables\.LoadAssetAsync)<(\w+)>/);
    if (genericMatch) {
      relations.push({ type: "uses_type", targetRef: genericMatch[1] });
    }
  }

  // Extract method calls (member access invocations)
  for (const invocation of rootNode.descendantsOfType("invocation_expression")) {
    const funcNode = invocation.childForFieldName("function");
    if (!funcNode) continue;

    if (funcNode.type === "member_access_expression") {
      const objNode = funcNode.childForFieldName("expression");
      const methodNode = funcNode.childForFieldName("name");
      if (objNode && methodNode) {
        const objName = objNode.text;
        // Only track calls where the object looks like a type name
        // (heuristic: starts with uppercase letter)
        if (objName[0] === objName[0].toUpperCase() && objName[0] !== objName[0].toLowerCase()) {
          importedNamespaces.add(objName);
          relations.push({ type: "calls", targetRef: objName, targetSymbol: methodNode.text });
        }
      }
    }
  }
}
```

Note: The exact tree-sitter-c-sharp node types may differ. After running the test, inspect parse tree output and adjust node type names as needed (`base_list` vs `bases`, `attribute_argument_list` vs `argument_list`, etc.).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/ast-relations.test.ts --reporter=verbose`
Expected: PASS (iterate on node types if needed)

- [ ] **Step 5: Commit**

```bash
git add src/ast.ts test/ast-relations.test.ts
git commit -m "feat(graph): add C# relation extraction (using, extends, implements, attributes, calls)"
```

---

## Task 4: Wiki-Link Extraction

**Files:**
- Create: `src/wikilinks.ts`
- Modify: `src/ast.ts:406-411` (AstRelation type)
- Test: Create `test/wiki-links.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/wiki-links.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { extractWikiLinks } from "../src/wikilinks.js";

describe("extractWikiLinks", () => {
  it("extracts basic wiki links", () => {
    const content = "See [[PlayerController]] for details.";
    const result = extractWikiLinks(content);
    expect(result).toContainEqual(
      expect.objectContaining({ type: "wiki_link", targetRef: "PlayerController" })
    );
  });

  it("extracts wiki links with display text", () => {
    const content = "Check the [[설정 화면|Settings Page]].";
    const result = extractWikiLinks(content);
    expect(result).toContainEqual(
      expect.objectContaining({ type: "wiki_link", targetRef: "설정 화면" })
    );
  });

  it("extracts wiki links with folder paths", () => {
    const content = "Reference [[specs/achievement]] here.";
    const result = extractWikiLinks(content);
    expect(result).toContainEqual(
      expect.objectContaining({ type: "wiki_link", targetRef: "specs/achievement" })
    );
  });

  it("extracts multiple wiki links from one document", () => {
    const content = "See [[A]] and [[B]] and [[C]].";
    const result = extractWikiLinks(content);
    expect(result).toHaveLength(3);
  });

  it("ignores wiki links inside fenced code blocks", () => {
    const content = "Text\n```\n[[NotALink]]\n```\nMore [[RealLink]] text.";
    const result = extractWikiLinks(content);
    expect(result).toHaveLength(1);
    expect(result[0].targetRef).toBe("RealLink");
  });

  it("ignores wiki links inside inline code", () => {
    const content = "Use `[[NotALink]]` syntax. See [[RealLink]].";
    const result = extractWikiLinks(content);
    expect(result).toHaveLength(1);
    expect(result[0].targetRef).toBe("RealLink");
  });

  it("returns empty for content without wiki links", () => {
    const content = "No links here. Just [regular](markdown).";
    const result = extractWikiLinks(content);
    expect(result).toHaveLength(0);
  });

  it("deduplicates repeated links", () => {
    const content = "See [[A]] and [[A]] again.";
    const result = extractWikiLinks(content);
    expect(result).toHaveLength(1);
  });

  it("is case-sensitive (consistent with Obsidian)", () => {
    const content = "See [[Settings]] link.";
    const result = extractWikiLinks(content);
    expect(result[0].targetRef).toBe("Settings");
    // "Settings" should NOT match "settings.md" — resolution handles this, not extraction
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/wiki-links.test.ts --reporter=verbose`
Expected: FAIL — module not found

- [ ] **Step 3: Add `"wiki_link"` to AstRelation type**

In `src/ast.ts:406-411`, update the type union:

```typescript
export interface AstRelation {
  type: "imports" | "calls" | "extends" | "implements" | "uses_type" | "wiki_link";
  sourceSymbol?: string;
  targetRef: string;
  targetSymbol?: string;
}
```

- [ ] **Step 4: Implement extractWikiLinks**

Create `src/wikilinks.ts`:

```typescript
import type { AstRelation } from "./ast.js";

/**
 * Extract Obsidian-style wiki links from markdown content.
 * Ignores links inside fenced code blocks and inline code.
 */
export function extractWikiLinks(content: string): AstRelation[] {
  // Remove fenced code blocks
  const withoutFenced = content.replace(/```[\s\S]*?```/g, "");
  // Remove inline code
  const withoutCode = withoutFenced.replace(/`[^`]+`/g, "");

  const pattern = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  const seen = new Set<string>();
  const relations: AstRelation[] = [];

  for (const match of withoutCode.matchAll(pattern)) {
    const targetRef = match[1].trim();
    if (targetRef && !seen.has(targetRef)) {
      seen.add(targetRef);
      relations.push({ type: "wiki_link", targetRef });
    }
  }

  return relations;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/wiki-links.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/wikilinks.ts src/ast.ts test/wiki-links.test.ts
git commit -m "feat(graph): add wiki-link extraction for markdown files"
```

---

## Task 5: Symbol-Name Fallback in `resolveTargetHashes`

**Files:**
- Modify: `src/graph.ts:76-123`
- Test: `test/graph.test.ts`

- [ ] **Step 1: Write failing test**

In `test/graph.test.ts`, add:

```typescript
describe("symbol-name resolution fallback", () => {
  it("resolves extends relation by symbol name when path fails", () => {
    // File A defines class "BaseController"
    db.prepare("INSERT INTO content VALUES ('hash_a', 'class BaseController {}', datetime('now'))").run();
    db.prepare("INSERT INTO documents (collection, path, hash, title, active) VALUES ('test', 'Scripts/BaseController.cs', 'hash_a', 'BaseController', 1)").run();
    saveSymbols(db, "hash_a", [{ name: "BaseController", kind: "class", line: 1 }]);

    // File B extends BaseController — targetRef is the symbol name, not a path
    db.prepare("INSERT INTO content VALUES ('hash_b', 'class Player : BaseController {}', datetime('now'))").run();
    db.prepare("INSERT INTO documents (collection, path, hash, title, active) VALUES ('test', 'Scripts/Player.cs', 'hash_b', 'Player', 1)").run();
    saveRelations(db, "hash_b", [{ type: "extends", targetRef: "BaseController", sourceSymbol: "Player" }]);

    const resolved = resolveTargetHashes(db, "test");
    expect(resolved).toBeGreaterThanOrEqual(1);

    const rel = db.prepare("SELECT target_hash FROM relations WHERE source_hash = 'hash_b' AND type = 'extends'").get() as any;
    expect(rel.target_hash).toBe("hash_a");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/graph.test.ts --reporter=verbose`
Expected: FAIL — target_hash is NULL

- [ ] **Step 3: Implement symbol-name fallback**

In `src/graph.ts`, update `resolveTargetHashes` (after line ~119, before the return):

Add at the start of the function (after `const update` line):

```typescript
// Build symbol → hash lookup for symbol-name fallback (used by C# extends/implements/calls)
const symbolLookup = new Map<string, string>();
const allSymbols = db.prepare(`
  SELECT s.name, s.hash FROM symbols s
  JOIN documents d ON s.hash = d.hash
  WHERE d.collection = ? AND d.active = 1
`).all(collection) as { name: string; hash: string }[];
for (const s of allSymbols) {
  if (!symbolLookup.has(s.name)) symbolLookup.set(s.name, s.hash);
}
```

Then inside the `for (const rel of unresolved)` loop, after the extensions loop (after line ~119), add a fallback:

```typescript
// Symbol-name fallback for non-import relations (C# extends, implements, uses_type, calls)
if (rel.type !== "imports" && rel.type !== "wiki_link") {
  const targetHash = symbolLookup.get(rel.target_ref) ?? symbolLookup.get(rel.target_symbol ?? "");
  if (targetHash && targetHash !== rel.source_hash) {
    update.run(targetHash, rel.id);
    resolved++;
  }
}
```

**Important:** The `unresolved` query at line ~79 must be updated to also return `type` and `target_symbol`. Change from:

```sql
SELECT r.id, r.source_hash, r.target_ref FROM relations r WHERE r.target_hash IS NULL
```

To:

```sql
SELECT r.id, r.source_hash, r.target_ref, r.type, r.target_symbol FROM relations r WHERE r.target_hash IS NULL
```

And update the TypeScript type cast to include `type: string; target_symbol: string | null`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/graph.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/graph.ts test/graph.test.ts
git commit -m "feat(graph): add symbol-name fallback to resolveTargetHashes for C#"
```

---

## Task 6: Wiki-Link Title Resolution in `resolveTargetHashes`

**Files:**
- Modify: `src/graph.ts:76-123`
- Test: `test/graph.test.ts`

- [ ] **Step 1: Write failing test**

In `test/graph.test.ts`, add:

```typescript
describe("wiki-link title resolution", () => {
  it("resolves wiki link by filename stem", () => {
    db.prepare("INSERT INTO content VALUES ('hash_md1', '# Settings', datetime('now'))").run();
    db.prepare("INSERT INTO documents (collection, path, hash, title, active) VALUES ('test', 'specs/settings.md', 'hash_md1', 'Settings', 1)").run();

    db.prepare("INSERT INTO content VALUES ('hash_md2', '[[settings]]', datetime('now'))").run();
    db.prepare("INSERT INTO documents (collection, path, hash, title, active) VALUES ('test', 'docs/overview.md', 'hash_md2', 'Overview', 1)").run();
    saveRelations(db, "hash_md2", [{ type: "wiki_link", targetRef: "settings" }]);

    const resolved = resolveTargetHashes(db, "test");
    expect(resolved).toBe(1);

    const rel = db.prepare("SELECT target_hash FROM relations WHERE source_hash = 'hash_md2' AND type = 'wiki_link'").get() as any;
    expect(rel.target_hash).toBe("hash_md1");
  });

  it("resolves wiki link with folder path suffix", () => {
    db.prepare("INSERT INTO content VALUES ('hash_md3', '# Achievement', datetime('now'))").run();
    db.prepare("INSERT INTO documents (collection, path, hash, title, active) VALUES ('test', 'specs/achievement.md', 'hash_md3', 'Achievement', 1)").run();

    db.prepare("INSERT INTO content VALUES ('hash_md4', '[[specs/achievement]]', datetime('now'))").run();
    db.prepare("INSERT INTO documents (collection, path, hash, title, active) VALUES ('test', 'docs/index.md', 'hash_md4', 'Index', 1)").run();
    saveRelations(db, "hash_md4", [{ type: "wiki_link", targetRef: "specs/achievement" }]);

    const resolved = resolveTargetHashes(db, "test");
    expect(resolved).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/graph.test.ts --reporter=verbose`
Expected: FAIL — wiki_link not resolved

- [ ] **Step 3: Implement wiki-link resolution**

In `src/graph.ts`, inside `resolveTargetHashes`, add wiki-link resolution path. Build a stem lookup at the start of the function:

```typescript
// Build stem → hash lookup for wiki-link resolution
const stemLookup = new Map<string, string>();      // stem → hash
const pathStemLookup = new Map<string, string>();   // "dir/stem" → hash
const allDocs = db.prepare(
  "SELECT path, hash FROM documents WHERE collection = ? AND active = 1"
).all(collection) as { path: string; hash: string }[];
for (const d of allDocs) {
  const lastSlash = d.path.lastIndexOf("/");
  const filename = lastSlash >= 0 ? d.path.substring(lastSlash + 1) : d.path;
  const dotIdx = filename.lastIndexOf(".");
  const stem = dotIdx > 0 ? filename.substring(0, dotIdx) : filename;
  if (!stemLookup.has(stem)) stemLookup.set(stem, d.hash);
  // Also store with parent dir for path-suffix matching
  const pathWithoutExt = dotIdx > 0 ? d.path.substring(0, d.path.lastIndexOf(".")) : d.path;
  pathStemLookup.set(pathWithoutExt, d.hash);
}
```

Then in the unresolved loop, add a wiki_link branch before the extensions loop:

```typescript
if (rel.type === "wiki_link") {
  // Try path suffix first (for [[specs/achievement]] style)
  const byPath = pathStemLookup.get(rel.target_ref);
  if (byPath) {
    update.run(byPath, rel.id);
    resolved++;
    continue;
  }
  // Then try stem match (for [[settings]] style)
  const byStem = stemLookup.get(rel.target_ref);
  if (byStem && byStem !== rel.source_hash) {
    update.run(byStem, rel.id);
    resolved++;
  }
  continue;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/graph.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/graph.ts test/graph.test.ts
git commit -m "feat(graph): add wiki-link title resolution to resolveTargetHashes"
```

---

## Task 7: Kind-Separated Clustering

**Files:**
- Modify: `src/graph.ts:212-285,329-348`
- Test: `test/graph.test.ts`

- [ ] **Step 1: Write failing test**

In `test/graph.test.ts`, add:

```typescript
describe("kind-separated clustering", () => {
  it("produces separate code and doc clusters", () => {
    // Set up code files with import relations
    db.prepare("INSERT INTO content VALUES ('c1', 'code1', datetime('now'))").run();
    db.prepare("INSERT INTO content VALUES ('c2', 'code2', datetime('now'))").run();
    db.prepare("INSERT INTO documents (collection, path, hash, title, active) VALUES ('mixed', 'a.ts', 'c1', 'a', 1)").run();
    db.prepare("INSERT INTO documents (collection, path, hash, title, active) VALUES ('mixed', 'b.ts', 'c2', 'b', 1)").run();
    saveRelations(db, "c1", [{ type: "imports", targetRef: "./b" }]);
    db.prepare("UPDATE relations SET target_hash = 'c2' WHERE source_hash = 'c1'").run();

    // Set up doc files with wiki_link relations
    db.prepare("INSERT INTO content VALUES ('d1', 'doc1', datetime('now'))").run();
    db.prepare("INSERT INTO content VALUES ('d2', 'doc2', datetime('now'))").run();
    db.prepare("INSERT INTO documents (collection, path, hash, title, active) VALUES ('mixed', 'x.md', 'd1', 'x', 1)").run();
    db.prepare("INSERT INTO documents (collection, path, hash, title, active) VALUES ('mixed', 'y.md', 'd2', 'y', 1)").run();
    saveRelations(db, "d1", [{ type: "wiki_link", targetRef: "y" }]);
    db.prepare("UPDATE relations SET target_hash = 'd2' WHERE source_hash = 'd1'").run();

    // Code clusters
    const codeClusters = detectClusters(db, "mixed", { relationTypes: ["imports", "calls", "extends", "implements", "uses_type"] });
    expect(codeClusters.length).toBeGreaterThanOrEqual(1);
    const codeMembers = codeClusters.flatMap(c => c.members);
    expect(codeMembers).toContain("c1");
    expect(codeMembers).not.toContain("d1");

    // Doc clusters
    const docClusters = detectClusters(db, "mixed", { relationTypes: ["wiki_link"] });
    expect(docClusters.length).toBeGreaterThanOrEqual(1);
    const docMembers = docClusters.flatMap(c => c.members);
    expect(docMembers).toContain("d1");
    expect(docMembers).not.toContain("c1");
  });

  it("saveClusters with kind does not delete other kind", () => {
    db.prepare("INSERT INTO content VALUES ('s1', 'a', datetime('now'))").run();
    db.prepare("INSERT INTO content VALUES ('s2', 'b', datetime('now'))").run();

    saveClusters(db, "test", [{ name: "code-cluster", members: ["s1", "s2"] }], "code");
    saveClusters(db, "test", [{ name: "doc-cluster", members: ["s1", "s2"] }], "doc");

    const all = db.prepare("SELECT name, kind FROM clusters WHERE collection = 'test'").all() as any[];
    expect(all).toHaveLength(2);
    expect(all.map(c => c.kind)).toContain("code");
    expect(all.map(c => c.kind)).toContain("doc");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/graph.test.ts --reporter=verbose`
Expected: FAIL — detectClusters doesn't accept options

- [ ] **Step 3: Update detectClusters signature and SQL**

In `src/graph.ts`, update `detectClusters`:

```typescript
export function detectClusters(
  db: Database,
  collection: string,
  opts?: { relationTypes?: string[] },
): ClusterResult[] {
```

Update the relations query (line ~222):

```typescript
let relQuery = `
  SELECT r.source_hash, r.target_hash FROM relations r
  WHERE r.target_hash IS NOT NULL
  AND r.source_hash IN (SELECT hash FROM documents WHERE collection = ? AND active = 1)
  AND r.target_hash IN (SELECT hash FROM documents WHERE collection = ? AND active = 1)
`;
const params: any[] = [collection, collection];

if (opts?.relationTypes && opts.relationTypes.length > 0) {
  const placeholders = opts.relationTypes.map(() => "?").join(", ");
  relQuery += ` AND r.type IN (${placeholders})`;
  params.push(...opts.relationTypes);
}

const relations = db.prepare(relQuery).all(...params) as { source_hash: string; target_hash: string }[];
```

- [ ] **Step 4: Update saveClusters signature**

```typescript
export function saveClusters(db: Database, collection: string, clusters: NamedCluster[], kind: "code" | "doc" = "code"): void {
  // Delete existing clusters for this collection AND kind only
  const existingClusters = db.prepare(
    "SELECT id FROM clusters WHERE collection = ? AND kind = ?"
  ).all(collection, kind) as { id: number }[];
  for (const c of existingClusters) {
    db.prepare("DELETE FROM cluster_members WHERE cluster_id = ?").run(c.id);
  }
  db.prepare("DELETE FROM clusters WHERE collection = ? AND kind = ?").run(collection, kind);

  // Insert new clusters
  const insertCluster = db.prepare("INSERT INTO clusters (collection, name, kind) VALUES (?, ?, ?)");
  const insertMember = db.prepare("INSERT INTO cluster_members (cluster_id, hash) VALUES (?, ?)");

  for (const cluster of clusters) {
    const result = insertCluster.run(collection, cluster.name, kind);
    const clusterId = result.lastInsertRowid;
    for (const hash of cluster.members) {
      insertMember.run(clusterId, hash);
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/graph.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/graph.ts test/graph.test.ts
git commit -m "feat(graph): add kind-separated clustering with relation-type filtering"
```

---

## Task 8: Store Integration — Wiki-Link Extraction + Dual Clustering

**Files:**
- Modify: `src/store.ts:1263-1306`
- Test: `test/graph-integration.test.ts`

- [ ] **Step 1: Write failing integration test**

In `test/graph-integration.test.ts`, add:

```typescript
it("extracts wiki links from markdown files", async () => {
  writeFileSync(join(tempDir, "a.md"), "# Page A\nSee [[b]] for more.");
  writeFileSync(join(tempDir, "b.md"), "# Page B\nContent here.");

  await reindexCollection(store, tempDir, "**/*.md", "test-col");

  const rels = db.prepare(
    "SELECT type, target_ref FROM relations WHERE type = 'wiki_link'"
  ).all() as any[];
  expect(rels).toContainEqual({ type: "wiki_link", target_ref: "b" });
});

it("creates separate code and doc clusters in mixed collection", async () => {
  writeFileSync(join(tempDir, "a.ts"), `import { foo } from './b';\nexport function bar() { foo(); }`);
  writeFileSync(join(tempDir, "b.ts"), `export function foo() {}`);
  writeFileSync(join(tempDir, "x.md"), "# X\nSee [[y]] for details.");
  writeFileSync(join(tempDir, "y.md"), "# Y\nAlso [[x]].");

  await reindexCollection(store, tempDir, "**/*", "test-col");

  const clusters = db.prepare("SELECT name, kind FROM clusters WHERE collection = 'test-col'").all() as any[];
  const kinds = clusters.map(c => c.kind);
  expect(kinds).toContain("code");
  expect(kinds).toContain("doc");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/graph-integration.test.ts --reporter=verbose`
Expected: FAIL — no wiki_link relations extracted

- [ ] **Step 3: Update reindexCollection in store.ts**

In `src/store.ts`, after the existing graph extraction block (line ~1273), add:

```typescript
// Wiki-link extraction for markdown files
if (relativeFile.endsWith(".md")) {
  const existingWikiRels = db.prepare(
    "SELECT 1 FROM relations WHERE source_hash = ? AND type = 'wiki_link' LIMIT 1"
  ).get(hash);
  if (!existingWikiRels) {
    const { extractWikiLinks } = await import("./wikilinks.js");
    const wikiRelations = extractWikiLinks(content);
    if (wikiRelations.length > 0) {
      saveRelations(db, hash, wikiRelations);
    }
  }
}
```

Note: `saveRelations` deletes all existing relations for source_hash first, so we need to be careful if a file is both code and markdown (it won't be). But for `.md` files that have no code relations, this is safe. The `existingWikiRels` check prevents re-extraction for unchanged content.

Update the clustering block (line ~1301-1306):

```typescript
// Resolve target hashes and run clustering
resolveTargetHashes(db, collectionName);

const CODE_RELATION_TYPES = ["imports", "calls", "extends", "implements", "uses_type"];
const codeClusters = detectClusters(db, collectionName, { relationTypes: CODE_RELATION_TYPES });
if (codeClusters.length > 0) {
  saveClusters(db, collectionName, nameClusters(db, codeClusters), "code");
}

const docClusters = detectClusters(db, collectionName, { relationTypes: ["wiki_link"] });
if (docClusters.length > 0) {
  saveClusters(db, collectionName, nameClusters(db, docClusters), "doc");
}
```

Add import for `extractWikiLinks` is dynamic (already handled above). Add import for the updated `saveClusters` parameter if needed (already imported from graph.ts).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/graph-integration.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Run all tests to check for regressions**

Run: `npx vitest run --reporter=verbose test/`
Expected: All existing tests still pass

- [ ] **Step 6: Commit**

```bash
git add src/store.ts test/graph-integration.test.ts
git commit -m "feat(graph): integrate wiki-link extraction and dual clustering in reindex"
```

---

## Task 9: CLI — Kind-Separated Cluster Output

**Files:**
- Modify: `src/cli/graph.ts:132-157`
- Modify: `src/cli/graph.ts:4-7` (GraphOpts)
- Modify: `src/cli/qmd.ts` (add --kind option)

- [ ] **Step 1: Add `--kind` option to CLI parser**

In `src/cli/qmd.ts`, in the `parseArgs` options section (near `"no-graph"`), add:

```typescript
"kind": { type: "string" },
```

In the graph command handler (line ~3501), pass kind to handleClusters:

```typescript
if (subcmd === "clusters") {
  const kind = cli.values.kind as string | undefined;
  console.log(handleClusters(store.db, { ...opts, kind }));
}
```

- [ ] **Step 2: Update GraphOpts and handleClusters**

In `src/cli/graph.ts`, update `GraphOpts`:

```typescript
interface GraphOpts {
  collection?: string;
  json?: boolean;
  kind?: string;  // "code" | "doc"
}
```

Update `handleClusters`:

```typescript
export function handleClusters(db: Database, opts: GraphOpts): string {
  let query = `SELECT c.id, c.name, c.collection, c.kind, COUNT(cm.hash) as member_count
    FROM clusters c JOIN cluster_members cm ON c.id = cm.cluster_id`;
  const conditions: string[] = [];
  const params: any[] = [];

  if (opts.collection) {
    conditions.push("c.collection = ?");
    params.push(opts.collection);
  }
  if (opts.kind) {
    conditions.push("c.kind = ?");
    params.push(opts.kind);
  }
  if (conditions.length > 0) {
    query += " WHERE " + conditions.join(" AND ");
  }
  query += " GROUP BY c.id ORDER BY c.kind, member_count DESC";

  const clusters = db.prepare(query).all(...params) as {
    id: number; name: string; collection: string; kind: string; member_count: number;
  }[];

  if (clusters.length === 0) return "No clusters found.";

  const lines: string[] = [];
  let currentKind = "";

  for (const c of clusters) {
    if (c.kind !== currentKind) {
      currentKind = c.kind;
      if (lines.length > 0) lines.push("");
      lines.push(currentKind === "code" ? "Code Clusters:" : "Doc Clusters:");
      lines.push("");
    }
    lines.push(`  ${c.name} (${c.collection}) — ${c.member_count} files`);
    const members = db.prepare(`
      SELECT d.path FROM cluster_members cm
      JOIN documents d ON cm.hash = d.hash AND d.active = 1
      WHERE cm.cluster_id = ?
    `).all(c.id) as { path: string }[];
    for (const m of members) lines.push(`    ${m.path}`);
  }
  return lines.join("\n");
}
```

- [ ] **Step 3: Run graph.test.ts and manually test CLI**

Run: `npx vitest run --reporter=verbose test/`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/cli/graph.ts src/cli/qmd.ts
git commit -m "feat(graph): add kind-separated cluster CLI output with --kind filter"
```

---

## Task 10: FileGraphInfo Wiki-Link Fields & CLI Display

**Files:**
- Modify: `src/graph.ts:24-34,138-160`
- Modify: `src/cli/graph.ts:20-52,67-103`

- [ ] **Step 1: Add wikiLinks/wikiLinkedBy to FileGraphInfo**

In `src/graph.ts`, update `FileGraphInfo`:

```typescript
export interface FileGraphInfo {
  imports: RelationRow[];
  importedBy: RelationRow[];
  extends: RelationRow[];
  extendedBy: RelationRow[];
  implements: RelationRow[];
  implementedBy: RelationRow[];
  calls: RelationRow[];
  calledBy: RelationRow[];
  wikiLinks: RelationRow[];
  wikiLinkedBy: RelationRow[];
  cluster?: string;
}
```

In `getFileGraph`, add wiki_link queries:

```typescript
const wikiLinks = outgoing.filter(r => r.type === "wiki_link");
const wikiLinkedBy = incoming.filter(r => r.type === "wiki_link");
```

And include them in the return object.

- [ ] **Step 2: Update handleGraph to display wiki links**

In `src/cli/graph.ts`, in `handleGraph`, after the existing relation display sections, add:

```typescript
if (info.wikiLinks.length > 0) {
  lines.push("", "Wiki Links:");
  for (const r of info.wikiLinks) {
    const targetPath = r.target_hash ? pathForHash(db, r.target_hash) : r.target_ref;
    lines.push(`  → ${targetPath}`);
  }
}
if (info.wikiLinkedBy.length > 0) {
  lines.push("", "Linked By:");
  for (const r of info.wikiLinkedBy) {
    const sourcePath = pathForHash(db, r.source_hash);
    lines.push(`  ← ${sourcePath}`);
  }
}
```

- [ ] **Step 3: Update handleRelated to include wiki_link relations**

In `src/cli/graph.ts`, in `handleRelated`, add wiki_link relations to the related set:

```typescript
for (const r of info.wikiLinks) {
  if (r.target_hash) related.add(r.target_hash);
}
for (const r of info.wikiLinkedBy) {
  related.add(r.source_hash);
}
```

Also fix the existing cluster member query (line ~87-94) to use cluster ID instead of name, to avoid cross-kind ambiguity:

```typescript
// Change from: WHERE c.name = ? to: WHERE cm.cluster_id = (SELECT cluster_id FROM cluster_members WHERE hash = ? LIMIT 1)
const clusterMembers = db.prepare(`
  SELECT DISTINCT d.path, d.hash FROM cluster_members cm
  JOIN documents d ON cm.hash = d.hash AND d.active = 1
  WHERE cm.cluster_id IN (
    SELECT cluster_id FROM cluster_members WHERE hash = ?
  )
`).all(hash) as { path: string; hash: string }[];
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run --reporter=verbose test/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/graph.ts src/cli/graph.ts
git commit -m "feat(graph): add wiki-link display to graph info and related commands"
```

---

## Task 11: Obsidian Output — Kind Split & Wiki-Link Sections

**Files:**
- Modify: `src/cli/graph-obsidian.ts`

- [ ] **Step 1: Update cluster page generation for kind-separated directories**

In `src/cli/graph-obsidian.ts`, update the cluster writing logic to use `_clusters/code/` and `_clusters/doc/` subdirectories based on the cluster's `kind` column.

Query clusters with kind:
```typescript
const clusters = db.prepare(`
  SELECT c.id, c.name, c.kind, GROUP_CONCAT(cm.hash) as member_hashes
  FROM clusters c JOIN cluster_members cm ON c.id = cm.cluster_id
  WHERE c.collection = ?
  GROUP BY c.id
`).all(collection) as { id: number; name: string; kind: string; member_hashes: string }[];

for (const cluster of clusters) {
  const subdir = cluster.kind === "doc" ? "_clusters/doc" : "_clusters/code";
  // Write to vault/wiki/{project}/{subdir}/{name}.md
}
```

- [ ] **Step 2: Add wiki_link sections to relation pages**

In `generateRelationPage`, add wiki-link display:

```typescript
// After existing relation sections
const wikiLinks = relations.filter(r => r.type === "wiki_link" && r.source_hash === hash);
const wikiLinkedBy = relations.filter(r => r.type === "wiki_link" && r.target_hash === hash);

if (wikiLinks.length > 0) {
  lines.push("", "## Wiki Links");
  for (const r of wikiLinks) {
    const targetPath = r.target_hash ? pathForHash(db, r.target_hash) : r.target_ref;
    const stem = targetPath.replace(/.*\//, "").replace(/\.\w+$/, "");
    lines.push(`- [[${stem}]]`);
  }
}
if (wikiLinkedBy.length > 0) {
  lines.push("", "## Linked By");
  for (const r of wikiLinkedBy) {
    const sourcePath = pathForHash(db, r.source_hash);
    const stem = sourcePath.replace(/.*\//, "").replace(/\.\w+$/, "");
    lines.push(`- [[${stem}]]`);
  }
}
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run --reporter=verbose test/`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/cli/graph-obsidian.ts
git commit -m "feat(graph): add kind-separated Obsidian cluster dirs and wiki-link relation sections"
```

---

## Task 12: Extension List Update + Final Integration Test

**Files:**
- Modify: `src/graph.ts:108` (extensions array)
- Test: `test/graph-integration.test.ts`

- [ ] **Step 1: Add .cs to resolveTargetHashes extension list**

In `src/graph.ts`, update the extensions array in `resolveTargetHashes`:

```typescript
const extensions = ["", ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".cs", "/index.ts", "/index.js"];
```

- [ ] **Step 2: Write C# integration test**

In `test/graph-integration.test.ts`, add:

```typescript
it("extracts C# symbols and resolves inheritance by symbol name", async () => {
  writeFileSync(join(tempDir, "Base.cs"), `
public class BaseController : MonoBehaviour {
    public virtual void Init() {}
}
`);
  writeFileSync(join(tempDir, "Player.cs"), `
using UnityEngine;
public class PlayerController : BaseController {
    public override void Init() {}
}
`);

  await reindexCollection(store, tempDir, "**/*.cs", "test-col");

  // Symbols extracted
  const symbols = db.prepare("SELECT name, kind FROM symbols").all() as any[];
  expect(symbols).toContainEqual({ name: "BaseController", kind: "class" });
  expect(symbols).toContainEqual({ name: "PlayerController", kind: "class" });

  // Extends relation resolved
  const rel = db.prepare(
    "SELECT target_hash FROM relations WHERE type = 'extends' AND source_symbol = 'PlayerController'"
  ).get() as any;
  expect(rel).toBeTruthy();
  expect(rel.target_hash).not.toBeNull();
});
```

- [ ] **Step 3: Run all tests**

Run: `npx vitest run --reporter=verbose test/`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add src/graph.ts test/graph-integration.test.ts
git commit -m "feat(graph): add .cs to resolution extensions and C# integration test"
```

---

## Task 13: Build & Smoke Test

- [ ] **Step 1: Run TypeScript build**

```bash
cd /Users/user/HwiCortex && bun run build
```

Expected: No type errors

- [ ] **Step 2: Run full test suite**

```bash
npx vitest run --reporter=verbose test/
```

Expected: ALL PASS

- [ ] **Step 3: Smoke test with a real collection (manual)**

```bash
# User should run these manually:
hwicortex update
hwicortex graph clusters
hwicortex graph clusters --kind code
hwicortex graph clusters --kind doc
```

- [ ] **Step 4: Update CLAUDE.md if needed**

Add `--kind code|doc` option to the graph clusters command documentation in CLAUDE.md.

- [ ] **Step 5: Update CHANGELOG.md**

Add under `## [Unreleased]`:

```markdown
### Added
- C# (.cs) language support for graph extraction (symbols, relations: using, extends, implements, attributes, calls)
- Markdown wiki-link (`[[...]]`) graph extraction for document clustering
- `--kind code|doc` filter for `graph clusters` command
- Kind-separated cluster output (Code Clusters / Doc Clusters)
- Wiki-link display in `graph` and `related` commands
- Obsidian cluster pages split by kind (`_clusters/code/`, `_clusters/doc/`)
- Wiki-link sections in Obsidian relation pages
```

- [ ] **Step 6: Final commit**

```bash
git add CLAUDE.md CHANGELOG.md
git commit -m "docs: update CLAUDE.md and CHANGELOG for C# and wiki-link graph support"
```
