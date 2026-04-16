# Unity Graph Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance C# graph extraction with field type + Singleton access patterns, fix `uses_type` surfacing in graph layer, add categorized `related` output, and add `impact` command.

**Architecture:** New extraction logic added to `src/ast-csharp.ts`. Graph layer (`src/graph.ts`) extended with `usesType`/`usedByType` fields. CLI (`src/cli/graph.ts`) refactored for categorized `related` and new `impact` command.

**Tech Stack:** TypeScript, web-tree-sitter (tree-sitter-c-sharp grammar), vitest, SQLite FTS5

**Spec:** `docs/superpowers/specs/2026-04-16-unity-graph-enhancement-design.md`

---

### Task 1: Add field type + property type extraction to ast-csharp.ts

**Files:**
- Modify: `src/ast-csharp.ts`
- Modify: `test/ast-csharp.test.ts`

- [ ] **Step 1: Write failing tests for field type extraction**

Append to `test/ast-csharp.test.ts`:

```typescript
  it("extracts field type as uses_type", async () => {
    const code = `
public class BuyHeartPopup : MonoBehaviour {
    [SerializeField] private HeartManager heartManager;
    private BillingHelper billing;
}
`;
    const result = await extractSymbolsAndRelations(code, "BuyHeartPopup.cs");
    const usesType = result.relations.filter(r => r.type === "uses_type");
    expect(usesType.some(r => r.targetRef === "HeartManager" && r.sourceSymbol === "BuyHeartPopup")).toBe(true);
    expect(usesType.some(r => r.targetRef === "BillingHelper" && r.sourceSymbol === "BuyHeartPopup")).toBe(true);
  });

  it("extracts generic inner type from field", async () => {
    const code = `
public class Shop : MonoBehaviour {
    public List<RewardItem> rewards;
    private Dictionary<string, ShopData> cache;
}
`;
    const result = await extractSymbolsAndRelations(code, "Shop.cs");
    const usesType = result.relations.filter(r => r.type === "uses_type");
    expect(usesType.some(r => r.targetRef === "RewardItem")).toBe(true);
    expect(usesType.some(r => r.targetRef === "ShopData")).toBe(true);
    // List and Dictionary themselves should be filtered
    expect(usesType.some(r => r.targetRef === "List")).toBe(false);
    expect(usesType.some(r => r.targetRef === "Dictionary")).toBe(false);
  });

  it("extracts property type as uses_type", async () => {
    const code = `
public class Player : MonoBehaviour {
    public HeartManager HeartMgr { get; set; }
}
`;
    const result = await extractSymbolsAndRelations(code, "Player.cs");
    const usesType = result.relations.filter(r => r.type === "uses_type");
    expect(usesType.some(r => r.targetRef === "HeartManager" && r.sourceSymbol === "Player")).toBe(true);
  });

  it("handles nullable and array field types", async () => {
    const code = `
public class Test : MonoBehaviour {
    private HeartManager? optionalRef;
    private BillingHelper[] helpers;
}
`;
    const result = await extractSymbolsAndRelations(code, "Test.cs");
    const usesType = result.relations.filter(r => r.type === "uses_type");
    expect(usesType.some(r => r.targetRef === "HeartManager")).toBe(true);
    expect(usesType.some(r => r.targetRef === "BillingHelper")).toBe(true);
  });

  it("filters primitive and ubiquitous Unity types from fields", async () => {
    const code = `
public class Player : MonoBehaviour {
    private int health;
    private float speed;
    private string name;
    private bool isAlive;
    private Transform target;
    private GameObject prefab;
    private Vector3 position;
    private HeartManager heartMgr;
}
`;
    const result = await extractSymbolsAndRelations(code, "Player.cs");
    const usesType = result.relations.filter(r => r.type === "uses_type");
    const refs = usesType.map(r => r.targetRef);
    expect(refs).toContain("HeartManager");
    expect(refs).not.toContain("int");
    expect(refs).not.toContain("float");
    expect(refs).not.toContain("string");
    expect(refs).not.toContain("bool");
    expect(refs).not.toContain("Transform");
    expect(refs).not.toContain("GameObject");
    expect(refs).not.toContain("Vector3");
  });

  it("deduplicates uses_type per sourceSymbol+targetRef", async () => {
    const code = `
public class Manager : MonoBehaviour {
    private HeartManager a;
    private HeartManager b;
    public HeartManager C { get; set; }
}
`;
    const result = await extractSymbolsAndRelations(code, "Manager.cs");
    const usesType = result.relations.filter(r => r.type === "uses_type" && r.targetRef === "HeartManager");
    expect(usesType).toHaveLength(1);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --reporter=verbose test/ast-csharp.test.ts`
Expected: FAIL — no field type extraction exists yet.

- [ ] **Step 3: Implement field/property type extraction + noise filter**

In `src/ast-csharp.ts`, add the noise filter set and extraction logic. Add this **before** the `extractCSharpSymbolsAndRelations` function:

```typescript
/** Types excluded from field/property uses_type extraction — too common to be useful */
const NOISE_TYPES = new Set([
  // C# primitives
  "int", "float", "double", "bool", "string", "byte", "long", "char",
  "decimal", "object", "void", "var", "short", "uint", "ulong", "ushort",
  "sbyte", "nint", "nuint",
  // Unity ubiquitous
  "GameObject", "Transform", "MonoBehaviour", "Component", "ScriptableObject",
  "Vector2", "Vector3", "Vector4", "Quaternion", "Color", "Color32",
  "Rect", "Bounds", "Coroutine", "WaitForSeconds",
  // Collections (wrapper only — inner types are kept)
  "List", "Dictionary", "HashSet", "Queue", "Stack", "Array",
  "IEnumerable", "IList", "IDictionary", "ICollection",
  // System
  "Action", "Func", "Task", "CancellationToken", "IDisposable",
  "EventHandler", "Type", "Enum",
]);

/**
 * Extract a clean type name from a type text.
 * Strips nullable suffix (?), array suffix ([]), namespace prefixes, and generic wrappers.
 * Returns inner type names for generics (e.g., List<Foo> → ["Foo"]).
 * Returns the base type for simple types (e.g., HeartManager → ["HeartManager"]).
 */
function extractTypeNames(typeText: string): string[] {
  const results: string[] = [];

  // Strip nullable suffix
  let text = typeText.replace(/\?$/, "");

  // Strip array suffix
  text = text.replace(/\[\]$/, "");

  // Check for generic: Foo<A, B>
  const genericIdx = text.indexOf("<");
  if (genericIdx > 0) {
    // Extract inner types from generic arguments
    const inner = text.substring(genericIdx + 1, text.lastIndexOf(">"));
    // Split by comma, handling nested generics by counting angle brackets
    let depth = 0;
    let start = 0;
    for (let i = 0; i < inner.length; i++) {
      if (inner[i] === "<") depth++;
      else if (inner[i] === ">") depth--;
      else if (inner[i] === "," && depth === 0) {
        results.push(...extractTypeNames(inner.substring(start, i).trim()));
        start = i + 1;
      }
    }
    results.push(...extractTypeNames(inner.substring(start).trim()));
    return results;
  }

  // Strip namespace prefix: UnityEngine.UI.Button → Button
  const dotIdx = text.lastIndexOf(".");
  if (dotIdx >= 0) text = text.substring(dotIdx + 1);

  if (text && !NOISE_TYPES.has(text)) {
    results.push(text);
  }
  return results;
}
```

Then add this block inside `extractCSharpSymbolsAndRelations`, **between the inheritance section (line 80) and the RequireComponent section (line 82)**. This placement is critical — the `usesTypeSeen` set and `findEnclosingClassName` helper must be declared before both the RequireComponent block and the asset reference block, because Task 3 will update those blocks to use them:

```typescript
  // --- Field and property type references ---
  const usesTypeSeen = new Set<string>(); // dedup key: "SourceClass::TargetType"

  // Helper to find enclosing class/struct name for a node
  function findEnclosingClassName(node: SyntaxNode): string | undefined {
    let current = node.parent;
    while (current) {
      if (current.type === "class_declaration" || current.type === "struct_declaration") {
        return current.childForFieldName("name")?.text;
      }
      current = current.parent;
    }
    return undefined;
  }

  for (const fieldNode of [
    ...rootNode.descendantsOfType("field_declaration"),
    ...rootNode.descendantsOfType("property_declaration"),
  ]) {
    const className = findEnclosingClassName(fieldNode);
    if (!className) continue;

    const typeNode = fieldNode.childForFieldName("type");
    if (!typeNode) continue;

    const typeNames = extractTypeNames(typeNode.text);
    for (const typeName of typeNames) {
      const dedupKey = `${className}::${typeName}`;
      if (usesTypeSeen.has(dedupKey)) continue;
      usesTypeSeen.add(dedupKey);
      relations.push({ type: "uses_type", sourceSymbol: className, targetRef: typeName });
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --reporter=verbose test/ast-csharp.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ast-csharp.ts test/ast-csharp.test.ts
git commit -m "feat(graph): add C# field/property type extraction with noise filter"
```

---

### Task 2: Add Singleton.Instance access pattern extraction

**Files:**
- Modify: `src/ast-csharp.ts`
- Modify: `test/ast-csharp.test.ts`

- [ ] **Step 1: Write failing tests for Singleton access**

Append to `test/ast-csharp.test.ts`:

```typescript
  it("extracts Singleton.Instance access as uses_type", async () => {
    const code = `
public class BuyHeartPopup : MonoBehaviour {
    void Start() {
        PopupManager.Instance.Show();
        UserDataManager.Instance.GetHeartCount();
    }
}
`;
    const result = await extractSymbolsAndRelations(code, "BuyHeartPopup.cs");
    const usesType = result.relations.filter(r => r.type === "uses_type");
    expect(usesType.some(r => r.targetRef === "PopupManager" && r.sourceSymbol === "BuyHeartPopup")).toBe(true);
    expect(usesType.some(r => r.targetRef === "UserDataManager" && r.sourceSymbol === "BuyHeartPopup")).toBe(true);
  });

  it("deduplicates Singleton access with field reference", async () => {
    const code = `
public class Test : MonoBehaviour {
    private PopupManager popupRef;
    void Start() {
        PopupManager.Instance.Show();
    }
}
`;
    const result = await extractSymbolsAndRelations(code, "Test.cs");
    const usesType = result.relations.filter(r => r.type === "uses_type" && r.targetRef === "PopupManager");
    expect(usesType).toHaveLength(1);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --reporter=verbose test/ast-csharp.test.ts`
Expected: FAIL — Singleton access not extracted.

- [ ] **Step 3: Implement Singleton.Instance extraction**

In `src/ast-csharp.ts`, add this block inside `extractCSharpSymbolsAndRelations`, after the field/property extraction block (before `return`):

```typescript
  // --- Singleton.Instance access pattern ---
  for (const memberAccess of rootNode.descendantsOfType("member_access_expression")) {
    const nameNode = memberAccess.childForFieldName("name");
    if (nameNode?.text !== "Instance") continue;

    const objNode = memberAccess.childForFieldName("expression");
    if (!objNode || objNode.type !== "identifier") continue;

    const singletonName = objNode.text;
    if (NOISE_TYPES.has(singletonName)) continue;

    const className = findEnclosingClassName(memberAccess);
    if (!className) continue;

    const dedupKey = `${className}::${singletonName}`;
    if (usesTypeSeen.has(dedupKey)) continue;
    usesTypeSeen.add(dedupKey);
    relations.push({ type: "uses_type", sourceSymbol: className, targetRef: singletonName });
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --reporter=verbose test/ast-csharp.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ast-csharp.ts test/ast-csharp.test.ts
git commit -m "feat(graph): add C# Singleton.Instance access extraction"
```

---

### Task 3: Fix RequireComponent sourceSymbol + run full suite

**Files:**
- Modify: `src/ast-csharp.ts`
- Modify: `test/ast-csharp.test.ts`

- [ ] **Step 1: Write failing test for RequireComponent sourceSymbol**

In `test/ast-csharp.test.ts`, update the existing RequireComponent test to also check sourceSymbol:

Replace the existing test `"extracts RequireComponent as uses_type"`:

```typescript
  it("extracts RequireComponent as uses_type with sourceSymbol", async () => {
    const code = `
[RequireComponent(typeof(Rigidbody))]
public class Player : MonoBehaviour { }
`;
    const result = await extractSymbolsAndRelations(code, "Player.cs");
    const usesType = result.relations.filter(r => r.type === "uses_type" && r.targetRef === "Rigidbody");
    expect(usesType).toHaveLength(1);
    expect(usesType[0].sourceSymbol).toBe("Player");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --reporter=verbose test/ast-csharp.test.ts`
Expected: FAIL — `sourceSymbol` is undefined.

- [ ] **Step 3: Fix RequireComponent extraction to include sourceSymbol**

In `src/ast-csharp.ts`, update the RequireComponent block. The `findEnclosingClassName` helper from Task 1 is already available. Replace the RequireComponent section (lines 82-97):

```typescript
  // --- RequireComponent attribute ---
  for (const attrNode of rootNode.descendantsOfType("attribute")) {
    const nameNode = attrNode.childForFieldName("name");
    if (nameNode?.text === "RequireComponent") {
      const className = findEnclosingClassName(attrNode);
      const argList = attrNode.descendantsOfType("attribute_argument_list")[0]
        ?? attrNode.descendantsOfType("argument_list")[0];
      if (argList) {
        for (const typeofExpr of argList.descendantsOfType("typeof_expression")) {
          const typeNode = typeofExpr.namedChildren[0];
          if (typeNode) {
            const targetRef = typeNode.text;
            if (className) {
              const dedupKey = `${className}::${targetRef}`;
              if (!usesTypeSeen.has(dedupKey)) {
                usesTypeSeen.add(dedupKey);
                relations.push({ type: "uses_type", sourceSymbol: className, targetRef });
              }
            } else {
              relations.push({ type: "uses_type", targetRef });
            }
          }
        }
      }
    }
  }
```

Note: `usesTypeSeen` and `findEnclosingClassName` were already placed before this block in Task 1.

Also update the asset reference section (lines 99-117) to use `usesTypeSeen` dedup and `sourceSymbol`. Replace lines 108-111 and 115-116:

```typescript
    if (genericMatch?.[1]) {
      const className = findEnclosingClassName(invocation);
      const targetRef = genericMatch[1];
      if (className) {
        const dedupKey = `${className}::${targetRef}`;
        if (!usesTypeSeen.has(dedupKey)) {
          usesTypeSeen.add(dedupKey);
          relations.push({ type: "uses_type", sourceSymbol: className, targetRef });
        }
      } else {
        relations.push({ type: "uses_type", targetRef });
      }
      continue;
    }

    // Addressables.InstantiateAsync — no generic, always GameObject
    if (funcText.includes("InstantiateAsync")) {
      const className = findEnclosingClassName(invocation);
      relations.push({ type: "uses_type", sourceSymbol: className, targetRef: "GameObject" });
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --reporter=verbose test/ast-csharp.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run --reporter=verbose`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/ast-csharp.ts test/ast-csharp.test.ts
git commit -m "fix(graph): add sourceSymbol to C# RequireComponent extraction"
```

---

### Task 4: Add `usesType`/`usedByType` to FileGraphInfo and graph display

**Files:**
- Modify: `src/graph.ts` (lines 24-36, 197-221)
- Modify: `src/cli/graph.ts` (lines 21-58)

- [ ] **Step 1: Add `usesType` and `usedByType` to `FileGraphInfo`**

In `src/graph.ts`, update the `FileGraphInfo` interface (line 24):

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
  usesType: RelationRow[];
  usedByType: RelationRow[];
  wikiLinks: RelationRow[];
  wikiLinkedBy: RelationRow[];
  cluster?: string;
}
```

- [ ] **Step 2: Update `getFileGraph()` to populate new fields**

In `src/graph.ts`, update the return statement of `getFileGraph()` (line 208):

```typescript
  return {
    imports: outgoing.filter(r => r.type === "imports"),
    importedBy: incoming.filter(r => r.type === "imports"),
    extends: outgoing.filter(r => r.type === "extends"),
    extendedBy: incoming.filter(r => r.type === "extends"),
    implements: outgoing.filter(r => r.type === "implements"),
    implementedBy: incoming.filter(r => r.type === "implements"),
    calls: outgoing.filter(r => r.type === "calls"),
    calledBy: incoming.filter(r => r.type === "calls"),
    usesType: outgoing.filter(r => r.type === "uses_type"),
    usedByType: incoming.filter(r => r.type === "uses_type"),
    wikiLinks: outgoing.filter(r => r.type === "wiki_link"),
    wikiLinkedBy: incoming.filter(r => r.type === "wiki_link"),
    cluster: clusterRow?.name,
  };
```

- [ ] **Step 3: Update `handleGraph()` to display uses_type**

In `src/cli/graph.ts`, add after the `calledBy` block (after line 46):

```typescript
  if (graph.usesType.length > 0) {
    lines.push(`  uses: ${graph.usesType.map(r => resolveHashToPath(db, r.target_hash) || r.target_ref).join(", ")}`);
  }
  if (graph.usedByType.length > 0) {
    lines.push(`  used by: ${graph.usedByType.map(r => resolveHashToPath(db, r.source_hash) || (r.source_symbol ?? "unknown")).join(", ")}`);
  }
```

- [ ] **Step 4: Update Obsidian graph-obsidian.ts**

In `src/cli/graph-obsidian.ts`, the `generateRelationPage` function (line 68) already handles `extends` and `implements` but not `usesType`. Add after the implements block (after line 133):

```typescript
  if (graph.usesType.length > 0) {
    lines.push(`- uses: ${graph.usesType.map(r => {
      const s = resolveToStem(db, r.target_hash);
      return s ? `[[${s}]]` : r.target_ref;
    }).join(", ")}`);
  }

  if (graph.usedByType.length > 0) {
    lines.push(`- used by: ${graph.usedByType.map(r => {
      const s = resolveToStem(db, r.source_hash);
      return s ? `[[${s}]]` : (r.source_symbol ?? "unknown");
    }).join(", ")}`);
  }
```

Also update the `relatedLinks` frontmatter array (lines 83-88) to include usesType/usedByType:

```typescript
  const relatedLinks = [...new Set([
    ...graph.imports.map(r => resolveToStem(db, r.target_hash)),
    ...graph.importedBy.map(r => resolveToStem(db, r.source_hash)),
    ...graph.usesType.map(r => resolveToStem(db, r.target_hash)),
    ...graph.usedByType.map(r => resolveToStem(db, r.source_hash)),
    ...graph.wikiLinks.map(r => resolveToStem(db, r.target_hash)),
    ...graph.wikiLinkedBy.map(r => resolveToStem(db, r.source_hash)),
  ])].filter(Boolean);
```

Also update the "no relations" check (line 152) to include `usesType` and `usedByType`:

```typescript
  if (graph.imports.length === 0 && graph.importedBy.length === 0 && graph.extends.length === 0 && graph.implements.length === 0 && graph.usesType.length === 0 && graph.usedByType.length === 0 && graph.wikiLinks.length === 0 && graph.wikiLinkedBy.length === 0) {
```

- [ ] **Step 5: Build to verify no type errors**

Run: `bun run build`
Expected: SUCCESS

- [ ] **Step 6: Commit**

```bash
git add src/graph.ts src/cli/graph.ts src/cli/graph-obsidian.ts
git commit -m "feat(graph): surface uses_type relations in FileGraphInfo and CLI"
```

---

### Task 5: Refactor `handleRelated` with categorized output

**Files:**
- Modify: `src/cli/graph.ts` (lines 74-121)
- Modify: `src/graph.ts` — add `getRelatedDocs()`

- [ ] **Step 1: Add `getRelatedDocs()` to graph.ts**

In `src/graph.ts`, add after the `getFileGraph` function:

```typescript
/**
 * Find related documents by searching symbol names against FTS index.
 * Returns top matches from non-code collections (docs).
 */
export function getRelatedDocs(db: Database, hash: string, limit: number = 3): { path: string; title: string; collection: string }[] {
  const symbols = db.prepare("SELECT name FROM symbols WHERE hash = ?").all(hash) as { name: string }[];
  if (symbols.length === 0) return [];

  // Build FTS query from symbol names
  const ftsQuery = symbols.map(s => `"${s.name}"`).join(" OR ");
  if (!ftsQuery) return [];

  try {
    const results = db.prepare(`
      SELECT d.path, d.title, d.collection,
             rank as score
      FROM documents_fts fts
      JOIN documents d ON d.id = fts.rowid AND d.active = 1
      WHERE documents_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(ftsQuery, limit) as { path: string; title: string; collection: string; score: number }[];

    // Filter out same-collection results (we want docs, not sibling code files)
    const sourceCollection = (db.prepare("SELECT collection FROM documents WHERE hash = ? AND active = 1 LIMIT 1").get(hash) as { collection: string } | undefined)?.collection;
    return results.filter(r => r.collection !== sourceCollection);
  } catch {
    return [];
  }
}
```

- [ ] **Step 2: Refactor `handleRelated` with categories**

In `src/cli/graph.ts`, update the import to include `getRelatedDocs`:

```typescript
import { getRelationsForHash, getSymbolUsages, getFileGraph, findPath, getRelatedDocs } from "../graph.js";
```

Replace the entire `handleRelated` function (lines 74-121):

```typescript
export function handleRelated(db: Database, file: string, opts: GraphOpts): string {
  const doc = resolveFileHash(db, file, opts.collection);
  if (!doc) return `File "${file}" not found in index.`;

  const graph = getFileGraph(db as any, doc.hash);
  const lines: string[] = [`Related to ${doc.path}:`, ""];

  // Track all shown paths to exclude from cluster section
  const shownPaths = new Set<string>();

  // --- Direct Dependencies (outgoing) ---
  const deps: string[] = [];
  for (const r of graph.extends) {
    const p = resolveHashToPath(db, r.target_hash) || r.target_ref;
    deps.push(`  ${p}${' '.repeat(Math.max(1, 40 - p.length))}extends ${r.target_ref}`);
    if (r.target_hash) { const rp = resolveHashToPath(db, r.target_hash); if (rp) shownPaths.add(rp); }
  }
  for (const r of graph.implements) {
    const p = resolveHashToPath(db, r.target_hash) || r.target_ref;
    deps.push(`  ${p}${' '.repeat(Math.max(1, 40 - p.length))}implements ${r.target_ref}`);
    if (r.target_hash) { const rp = resolveHashToPath(db, r.target_hash); if (rp) shownPaths.add(rp); }
  }
  for (const r of graph.usesType) {
    const p = resolveHashToPath(db, r.target_hash) || r.target_ref;
    deps.push(`  ${p}${' '.repeat(Math.max(1, 40 - p.length))}uses_type ${r.target_ref}`);
    if (r.target_hash) { const rp = resolveHashToPath(db, r.target_hash); if (rp) shownPaths.add(rp); }
  }
  for (const r of graph.imports) {
    const p = resolveHashToPath(db, r.target_hash) || r.target_ref;
    deps.push(`  ${p}${' '.repeat(Math.max(1, 40 - p.length))}imports ${r.target_ref}`);
    if (r.target_hash) { const rp = resolveHashToPath(db, r.target_hash); if (rp) shownPaths.add(rp); }
  }
  for (const r of graph.calls) {
    const p = resolveHashToPath(db, r.target_hash) || (r.target_symbol ?? r.target_ref);
    deps.push(`  ${p}${' '.repeat(Math.max(1, 40 - p.length))}calls ${r.target_symbol || r.target_ref}`);
    if (r.target_hash) { const rp = resolveHashToPath(db, r.target_hash); if (rp) shownPaths.add(rp); }
  }

  if (deps.length > 0) {
    lines.push("Direct Dependencies (this file uses):");
    lines.push(...deps);
    lines.push("");
  }

  // --- Dependents (incoming) ---
  const dependents: string[] = [];
  for (const r of graph.extendedBy) {
    const p = resolveHashToPath(db, r.source_hash) || "unknown";
    dependents.push(`  ${p}${' '.repeat(Math.max(1, 40 - p.length))}extends ${r.target_ref}`);
    shownPaths.add(p);
  }
  for (const r of graph.implementedBy) {
    const p = resolveHashToPath(db, r.source_hash) || "unknown";
    dependents.push(`  ${p}${' '.repeat(Math.max(1, 40 - p.length))}implements ${r.target_ref}`);
    shownPaths.add(p);
  }
  for (const r of graph.usedByType) {
    const p = resolveHashToPath(db, r.source_hash) || "unknown";
    dependents.push(`  ${p}${' '.repeat(Math.max(1, 40 - p.length))}uses_type ${r.source_symbol || r.target_ref}`);
    shownPaths.add(p);
  }
  for (const r of graph.importedBy) {
    const p = resolveHashToPath(db, r.source_hash) || "unknown";
    dependents.push(`  ${p}${' '.repeat(Math.max(1, 40 - p.length))}imports`);
    shownPaths.add(p);
  }
  for (const r of graph.calledBy) {
    const p = resolveHashToPath(db, r.source_hash) || "unknown";
    dependents.push(`  ${p}${' '.repeat(Math.max(1, 40 - p.length))}calls`);
    shownPaths.add(p);
  }

  if (dependents.length > 0) {
    lines.push("Dependents (uses this file):");
    lines.push(...dependents);
    lines.push("");
  }

  // --- Same Module (cluster, minus already shown) ---
  if (graph.cluster) {
    const members = db.prepare(`
      SELECT DISTINCT d.path FROM cluster_members cm
      JOIN documents d ON cm.hash = d.hash AND d.active = 1
      WHERE cm.cluster_id IN (
        SELECT cluster_id FROM cluster_members WHERE hash = ?
      ) AND cm.hash != ?
    `).all(doc.hash, doc.hash) as { path: string }[];

    const moduleMembers = members.filter(m => !shownPaths.has(m.path));
    if (moduleMembers.length > 0) {
      lines.push(`Same Module — ${graph.cluster} (${moduleMembers.length} files):`);
      for (const m of moduleMembers) lines.push(`  ${m.path}`);
      lines.push("");
    }
  }

  // --- Related Docs ---
  const docs = getRelatedDocs(db as any, doc.hash);
  if (docs.length > 0) {
    lines.push("Related Docs:");
    for (const d of docs) {
      lines.push(`  ${d.collection}/${d.path}${' '.repeat(Math.max(1, 40 - (d.collection.length + d.path.length + 1)))}${JSON.stringify(d.title)}`);
    }
    lines.push("");
  }

  if (lines.length <= 2) lines.push("  (no related files found)");
  return lines.join("\n");
}
```

- [ ] **Step 3: Build to verify**

Run: `bun run build`
Expected: SUCCESS

- [ ] **Step 4: Run full test suite**

Run: `npx vitest run --reporter=verbose`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/graph.ts src/cli/graph.ts
git commit -m "feat(graph): categorized related output with docs section"
```

---

### Task 6: Add `impact` command

**Files:**
- Modify: `src/graph.ts` — add `getImpact()`
- Modify: `src/cli/graph.ts` — add `handleImpact()`
- Modify: `src/cli/qmd.ts` — register command

- [ ] **Step 1: Add `getImpact()` to graph.ts**

In `src/graph.ts`, add after the `getRelatedDocs` function:

```typescript
export interface ImpactResult {
  direct: { hash: string; path: string | null; type: string; ref: string }[];
  transitive: { hash: string; path: string | null; type: string; ref: string; via: string }[];
  risk: "LOW" | "MEDIUM" | "HIGH";
}

/**
 * Analyze change impact: who depends on this file?
 * Direct = incoming relations. Transitive = BFS N hops from direct dependents.
 */
export function getImpact(db: Database, hash: string, depth: number = 2): ImpactResult {
  // Direct dependents: all files with incoming relations to this hash
  const incoming = db.prepare(
    "SELECT source_hash, type, target_ref, source_symbol FROM relations WHERE target_hash = ?"
  ).all(hash) as { source_hash: string; type: string; target_ref: string; source_symbol: string | null }[];

  const directSet = new Set<string>();
  const direct: ImpactResult["direct"] = [];

  for (const r of incoming) {
    if (directSet.has(r.source_hash)) continue;
    directSet.add(r.source_hash);
    const doc = db.prepare("SELECT path FROM documents WHERE hash = ? AND active = 1 LIMIT 1").get(r.source_hash) as { path: string } | undefined;
    direct.push({
      hash: r.source_hash,
      path: doc?.path ?? null,
      type: r.type,
      ref: r.source_symbol || r.target_ref,
    });
  }

  // Transitive: BFS from direct dependents
  const transitive: ImpactResult["transitive"] = [];
  const visited = new Set<string>([hash, ...directSet]);
  let frontier = [...directSet];

  for (let hop = 1; hop < depth && frontier.length > 0; hop++) {
    const nextFrontier: string[] = [];
    for (const frontierHash of frontier) {
      const frontierPath = (db.prepare("SELECT path FROM documents WHERE hash = ? AND active = 1 LIMIT 1").get(frontierHash) as { path: string } | undefined)?.path ?? frontierHash;
      const deps = db.prepare(
        "SELECT source_hash, type, target_ref, source_symbol FROM relations WHERE target_hash = ?"
      ).all(frontierHash) as { source_hash: string; type: string; target_ref: string; source_symbol: string | null }[];

      for (const r of deps) {
        if (visited.has(r.source_hash)) continue;
        visited.add(r.source_hash);
        const doc = db.prepare("SELECT path FROM documents WHERE hash = ? AND active = 1 LIMIT 1").get(r.source_hash) as { path: string } | undefined;
        transitive.push({
          hash: r.source_hash,
          path: doc?.path ?? null,
          type: r.type,
          ref: r.source_symbol || r.target_ref,
          via: frontierPath,
        });
        nextFrontier.push(r.source_hash);
      }
    }
    frontier = nextFrontier;
  }

  const directCount = direct.length;
  const risk = directCount >= 11 ? "HIGH" : directCount >= 4 ? "MEDIUM" : "LOW";

  return { direct, transitive, risk };
}
```

- [ ] **Step 2: Add `handleImpact()` to cli/graph.ts**

In `src/cli/graph.ts`, update the import:

```typescript
import { getRelationsForHash, getSymbolUsages, getFileGraph, findPath, getRelatedDocs, getImpact } from "../graph.js";
```

Add the function after `handleClusters`:

```typescript
export function handleImpact(db: Database, file: string, opts: GraphOpts & { depth?: number }): string {
  const doc = resolveFileHash(db, file, opts.collection);
  if (!doc) return `File "${file}" not found in index.`;

  const depth = opts.depth ?? 2;
  const impact = getImpact(db as any, doc.hash, depth);
  const lines: string[] = [`Impact analysis for ${doc.path}:`, ""];

  if (impact.direct.length > 0) {
    // Group by relation type
    const grouped = new Map<string, typeof impact.direct>();
    for (const d of impact.direct) {
      const key = d.type;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(d);
    }

    lines.push("Direct Impact (depends on this file):");
    for (const [type, items] of grouped) {
      if (items.length > 5) {
        lines.push(`  ${items.length} files — ${type}`);
      } else {
        for (const item of items) {
          const p = item.path ?? item.hash;
          lines.push(`  ${p}${' '.repeat(Math.max(1, 40 - p.length))}${type} ${item.ref}`);
        }
      }
    }
    lines.push("");
  }

  if (impact.transitive.length > 0) {
    lines.push(`Transitive Impact (${depth}-hop):`);
    for (const t of impact.transitive.slice(0, 20)) {
      const p = t.path ?? t.hash;
      lines.push(`  ${p}${' '.repeat(Math.max(1, 40 - p.length))}via ${t.via}`);
    }
    if (impact.transitive.length > 20) {
      lines.push(`  ... and ${impact.transitive.length - 20} more`);
    }
    lines.push("");
  }

  if (impact.direct.length === 0 && impact.transitive.length === 0) {
    lines.push("  No files depend on this file.");
    lines.push("");
  }

  lines.push(`Summary: ${impact.direct.length} direct, ${impact.transitive.length} transitive — Risk: ${impact.risk}`);
  return lines.join("\n");
}
```

- [ ] **Step 3: Register `impact` command in qmd.ts**

In `src/cli/qmd.ts`, update the import from `./graph.js` to include `handleImpact`:

```typescript
import { handleGraph, handlePath, handleRelated, handleSymbol, handleClusters, handleImpact } from "./graph.js";
```

Find the `case "graph":` block and add `case "impact":` after it (before the default case):

```typescript
    case "impact": {
      const store = getStore();
      const subcmd = cli.args[1];
      if (!subcmd) {
        console.error("Usage: hwicortex impact <file> [--depth <n>] [--collection <name>]");
        process.exit(1);
      }
      const depthValue = cli.values.depth as string | undefined;
      const depth = depthValue ? Math.min(parseInt(depthValue, 10) || 2, 3) : 2;
      console.log(handleImpact(store.db, subcmd, {
        collection: cli.values.collection as string | undefined,
        depth,
      }));
      break;
    }
```

Also add `depth` to the `parseArgs` options (find the `options` object in `parseArgs`):

```typescript
      depth: { type: "string" },
```

- [ ] **Step 4: Build to verify**

Run: `bun run build`
Expected: SUCCESS

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run --reporter=verbose`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/graph.ts src/cli/graph.ts src/cli/qmd.ts
git commit -m "feat(graph): add impact command for change impact analysis"
```

---

### Task 7: Manual validation against bb3-code + rebuild index

This task requires running against the actual bb3-client project.

- [ ] **Step 1: Build and link**

```bash
bun run build && bun link
```

- [ ] **Step 2: Re-index bb3-code to pick up new extraction**

```bash
cd /Users/ad03159868/bb3-client
hwicortex collection remove bb3-code
hwicortex collection add Assets/02.Script --name bb3-code --mask "**/*.cs"
```

- [ ] **Step 3: Verify symbol extraction improved**

```bash
hwicortex symbol HeartManager
hwicortex symbol PopupManager
```

Expected: symbols found with `uses_type` relations from multiple files.

- [ ] **Step 4: Test `graph` command shows uses_type**

```bash
hwicortex graph popup/common/buyheartpopup.cs
```

Expected: output includes `uses:` line with field/singleton dependencies.

- [ ] **Step 5: Test categorized `related`**

```bash
hwicortex related popup/common/buyheartpopup.cs
```

Expected: output has "Direct Dependencies", "Dependents", "Same Module", "Related Docs" sections.

- [ ] **Step 6: Test `impact` command**

```bash
hwicortex impact popup/manager/basepopup.cs
```

Expected: shows 55+ files in Direct Impact with risk: HIGH.

- [ ] **Step 7: Test Obsidian export**

```bash
hwicortex graph --obsidian -c bb3-code
```

Expected: cluster pages and relation pages include uses_type data.

- [ ] **Step 8: Commit any adjustments from manual testing**

If the noise filter list needs tuning or output formatting needs adjustments based on real data, make changes and commit:

```bash
git add -A
git commit -m "fix(graph): tune extraction and display from manual validation"
```
