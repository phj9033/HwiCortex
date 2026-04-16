# C# Graph Relations Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace noisy C# relation extraction with focused inheritance/implementation + asset reference extraction in a dedicated module.

**Architecture:** Extract C# logic from `ast.ts` into `src/ast-csharp.ts`. The new module receives a tree-sitter `SyntaxNode` and returns `{ symbols, relations }`. Only `extends`, `implements`, and `uses_type` relations are generated — no `imports` or `calls`.

**Tech Stack:** TypeScript, web-tree-sitter (tree-sitter-c-sharp grammar), vitest

**Spec:** `docs/superpowers/specs/2026-04-16-csharp-graph-relations-design.md`

---

### Task 1: Create `ast-csharp.ts` with symbol extraction + tests

**Files:**
- Create: `src/ast-csharp.ts`
- Create: `test/ast-csharp.test.ts`

- [ ] **Step 1: Write failing test for C# symbol extraction**

In `test/ast-csharp.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { extractSymbolsAndRelations } from "../src/ast.js";

describe("C# symbol extraction (ast-csharp)", () => {
  it("extracts class, interface, enum, struct but not method", async () => {
    const code = `
using UnityEngine;

public class PlayerController : MonoBehaviour {
    public enum State { Idle, Run }
    public void Update() {}
}

public interface IDamageable {
    void TakeDamage(float amount);
}

public struct HitInfo {
    public float damage;
}
`;
    const result = await extractSymbolsAndRelations(code, "PlayerController.cs");
    const names = result.symbols.map(s => s.name);
    expect(names).toContain("PlayerController");
    expect(names).toContain("State");
    expect(names).toContain("IDamageable");
    expect(names).toContain("HitInfo");
    // method should NOT be extracted
    expect(names).not.toContain("Update");
    expect(names).not.toContain("TakeDamage");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --reporter=verbose test/ast-csharp.test.ts`
Expected: FAIL — `Update` will be in symbols because old code still extracts methods.

- [ ] **Step 3: Create `src/ast-csharp.ts` with symbol extraction**

```typescript
import type { AstSymbol, AstRelation } from "./ast.js";

// web-tree-sitter types
type SyntaxNode = import("web-tree-sitter").SyntaxNode;

/**
 * C# symbol query — class, interface, enum, struct only.
 * Methods excluded: node granularity is script (class) level.
 */
export const CSHARP_SYMBOL_QUERY = `
  (class_declaration name: (identifier) @class_name)
  (interface_declaration name: (identifier) @interface_name)
  (enum_declaration name: (identifier) @enum_name)
  (struct_declaration name: (identifier) @type_name)
`;

/**
 * Extract C# symbols and relations from a parsed AST.
 * Called by ast.ts when language === "csharp".
 *
 * @param rootNode - Tree-sitter root node of the parsed C# file
 * @param filepath - File path (for diagnostics only)
 */
export function extractCSharpSymbolsAndRelations(
  rootNode: SyntaxNode,
  _filepath: string,
): { symbols: AstSymbol[]; relations: AstRelation[] } {
  const symbols: AstSymbol[] = [];
  const relations: AstRelation[] = [];

  // --- Symbol extraction via manual AST walk ---
  for (const node of rootNode.descendantsOfType("class_declaration")) {
    const name = node.childForFieldName("name")?.text;
    if (name) symbols.push({ name, kind: "class", line: node.startPosition.row + 1 });
  }
  for (const node of rootNode.descendantsOfType("interface_declaration")) {
    const name = node.childForFieldName("name")?.text;
    if (name) symbols.push({ name, kind: "interface", line: node.startPosition.row + 1 });
  }
  for (const node of rootNode.descendantsOfType("enum_declaration")) {
    const name = node.childForFieldName("name")?.text;
    if (name) symbols.push({ name, kind: "enum", line: node.startPosition.row + 1 });
  }
  for (const node of rootNode.descendantsOfType("struct_declaration")) {
    const name = node.childForFieldName("name")?.text;
    if (name) symbols.push({ name, kind: "type", line: node.startPosition.row + 1 });
  }

  // --- Relation extraction (Task 2, 3 will fill this in) ---

  return { symbols, relations };
}
```

- [ ] **Step 4: Wire `ast-csharp.ts` into `ast.ts`**

In `src/ast.ts`:

1. Remove the `csharp` entry from `SYMBOL_QUERIES` (lines 465-471).
2. Remove the `else if (language === "csharp") { ... }` block (lines 736-806). Note: `LANGUAGE_QUERIES.csharp` (line 146) is for chunking and must NOT be removed.
3. Add import and delegation:

```typescript
// At top of file, after existing imports:
import { extractCSharpSymbolsAndRelations, CSHARP_SYMBOL_QUERY } from "./ast-csharp.js";
```

In `extractSymbolsAndRelations`, after parsing the tree and before the symbol query section (~line 519), add early return for C#:

```typescript
    if (language === "csharp") {
      const result = extractCSharpSymbolsAndRelations(tree.rootNode, filepath);
      tree.delete();
      parser.delete();
      return result;
    }
```

For `SYMBOL_QUERIES`, replace the `csharp` entry with:
```typescript
  csharp: CSHARP_SYMBOL_QUERY,
```

This keeps the query available for `getASTStatus()` health checks while the actual extraction is handled by the dedicated module.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run --reporter=verbose test/ast-csharp.test.ts`
Expected: PASS

- [ ] **Step 6: Run full test suite to check for regressions**

Run: `npx vitest run --reporter=verbose`
Expected: Some C# tests in other files will fail (expected — we'll clean those up in Task 4).

- [ ] **Step 7: Commit**

```bash
git add src/ast-csharp.ts src/ast.ts test/ast-csharp.test.ts
git commit -m "feat(graph): create ast-csharp module with symbol extraction"
```

---

### Task 2: Add inheritance/implementation relation extraction

**Files:**
- Modify: `src/ast-csharp.ts`
- Modify: `test/ast-csharp.test.ts`

- [ ] **Step 1: Write failing tests for inheritance relations**

Append to `test/ast-csharp.test.ts`:

```typescript
  it("extracts extends relation", async () => {
    const code = `public class Player : MonoBehaviour { }`;
    const result = await extractSymbolsAndRelations(code, "Player.cs");
    const ext = result.relations.filter(r => r.type === "extends");
    expect(ext).toHaveLength(1);
    expect(ext[0].sourceSymbol).toBe("Player");
    expect(ext[0].targetRef).toBe("MonoBehaviour");
  });

  it("extracts implements relation via I-prefix", async () => {
    const code = `public class Player : IDamageable { }`;
    const result = await extractSymbolsAndRelations(code, "Player.cs");
    const impl = result.relations.filter(r => r.type === "implements");
    expect(impl).toHaveLength(1);
    expect(impl[0].sourceSymbol).toBe("Player");
    expect(impl[0].targetRef).toBe("IDamageable");
  });

  it("extracts mixed inheritance: 1 extends + 2 implements", async () => {
    const code = `public class Player : MonoBehaviour, IDamageable, ISerializable { }`;
    const result = await extractSymbolsAndRelations(code, "Player.cs");
    const ext = result.relations.filter(r => r.type === "extends");
    const impl = result.relations.filter(r => r.type === "implements");
    expect(ext).toHaveLength(1);
    expect(ext[0].targetRef).toBe("MonoBehaviour");
    expect(impl).toHaveLength(2);
    expect(impl.map(r => r.targetRef).sort()).toEqual(["IDamageable", "ISerializable"]);
  });

  it("strips generic params from base type", async () => {
    const code = `public class Pool : ObjectPool<Enemy> { }`;
    const result = await extractSymbolsAndRelations(code, "Pool.cs");
    const ext = result.relations.filter(r => r.type === "extends");
    expect(ext[0].targetRef).toBe("ObjectPool");
  });

  it("does NOT generate imports from using directives", async () => {
    const code = `
using UnityEngine;
using System.Collections.Generic;

public class Foo : MonoBehaviour { }
`;
    const result = await extractSymbolsAndRelations(code, "Foo.cs");
    const imports = result.relations.filter(r => r.type === "imports");
    expect(imports).toHaveLength(0);
  });

  it("does NOT generate calls relations", async () => {
    const code = `
using UnityEngine;

public class Player : MonoBehaviour {
    void Start() {
        Debug.Log("hello");
        GetComponent<Rigidbody>();
    }
}
`;
    const result = await extractSymbolsAndRelations(code, "Player.cs");
    const calls = result.relations.filter(r => r.type === "calls");
    expect(calls).toHaveLength(0);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --reporter=verbose test/ast-csharp.test.ts`
Expected: FAIL — relations array is empty.

- [ ] **Step 3: Implement inheritance extraction in `ast-csharp.ts`**

Add to `extractCSharpSymbolsAndRelations`, replacing the `// --- Relation extraction ---` comment:

```typescript
  // --- Inheritance / Implementation ---
  for (const classNode of [
    ...rootNode.descendantsOfType("class_declaration"),
    ...rootNode.descendantsOfType("struct_declaration"),
  ]) {
    const nameNode = classNode.childForFieldName("name");
    const className = nameNode?.text;
    if (!className) continue;

    const baseList = classNode.childForFieldName("bases")
      ?? classNode.descendantsOfType("base_list")[0];
    if (!baseList) continue;

    for (const base of baseList.namedChildren) {
      let typeName = base.text;
      // Strip generic params: Foo<T> -> Foo
      const genericIdx = typeName.indexOf("<");
      if (genericIdx > 0) typeName = typeName.substring(0, genericIdx);
      // Strip namespace prefix: Ns.Foo -> Foo
      const dotIdx = typeName.lastIndexOf(".");
      if (dotIdx >= 0) typeName = typeName.substring(dotIdx + 1);

      // I-prefix convention: IFoo = implements, otherwise extends
      const relType = typeName.startsWith("I")
        && typeName.length > 1
        && typeName[1]?.toUpperCase() === typeName[1]
        ? "implements" : "extends";

      relations.push({ type: relType, sourceSymbol: className, targetRef: typeName });
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --reporter=verbose test/ast-csharp.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ast-csharp.ts test/ast-csharp.test.ts
git commit -m "feat(graph): add C# inheritance/implementation relation extraction"
```

---

### Task 3: Add asset reference + RequireComponent extraction

**Files:**
- Modify: `src/ast-csharp.ts`
- Modify: `test/ast-csharp.test.ts`

- [ ] **Step 1: Write failing tests for asset references**

Append to `test/ast-csharp.test.ts`:

```typescript
  it("extracts RequireComponent as uses_type", async () => {
    const code = `
[RequireComponent(typeof(Rigidbody))]
public class Player : MonoBehaviour { }
`;
    const result = await extractSymbolsAndRelations(code, "Player.cs");
    const usesType = result.relations.filter(r => r.type === "uses_type");
    expect(usesType.some(r => r.targetRef === "Rigidbody")).toBe(true);
  });

  it("extracts Resources.Load<T> as uses_type", async () => {
    const code = `
public class Loader : MonoBehaviour {
    void Start() {
        var clip = Resources.Load<AudioClip>("sfx/hit");
    }
}
`;
    const result = await extractSymbolsAndRelations(code, "Loader.cs");
    const usesType = result.relations.filter(r => r.type === "uses_type");
    expect(usesType.some(r => r.targetRef === "AudioClip")).toBe(true);
  });

  it("extracts Addressables.LoadAssetAsync<T> as uses_type", async () => {
    const code = `
public class Loader : MonoBehaviour {
    async void Start() {
        var handle = Addressables.LoadAssetAsync<GameObject>(key);
    }
}
`;
    const result = await extractSymbolsAndRelations(code, "Loader.cs");
    const usesType = result.relations.filter(r => r.type === "uses_type");
    expect(usesType.some(r => r.targetRef === "GameObject")).toBe(true);
  });

  it("extracts AssetBundle.LoadAsset<T> as uses_type", async () => {
    const code = `
public class Loader : MonoBehaviour {
    void Start() {
        var tex = bundle.LoadAsset<Texture2D>("main");
    }
}
`;
    const result = await extractSymbolsAndRelations(code, "Loader.cs");
    const usesType = result.relations.filter(r => r.type === "uses_type");
    expect(usesType.some(r => r.targetRef === "Texture2D")).toBe(true);
  });

  it("extracts Addressables.InstantiateAsync as uses_type with GameObject", async () => {
    const code = `
public class Spawner : MonoBehaviour {
    async void Spawn() {
        var handle = Addressables.InstantiateAsync(prefabRef);
    }
}
`;
    const result = await extractSymbolsAndRelations(code, "Spawner.cs");
    const usesType = result.relations.filter(r => r.type === "uses_type");
    expect(usesType.some(r => r.targetRef === "GameObject")).toBe(true);
  });

  it("extracts Resources.LoadAll<T> as uses_type", async () => {
    const code = `
public class Loader : MonoBehaviour {
    void Start() {
        var sprites = Resources.LoadAll<Sprite>("icons");
    }
}
`;
    const result = await extractSymbolsAndRelations(code, "Loader.cs");
    const usesType = result.relations.filter(r => r.type === "uses_type");
    expect(usesType.some(r => r.targetRef === "Sprite")).toBe(true);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --reporter=verbose test/ast-csharp.test.ts`
Expected: FAIL — no uses_type relations generated.

- [ ] **Step 3: Implement asset reference extraction in `ast-csharp.ts`**

Add after the inheritance block in `extractCSharpSymbolsAndRelations`:

```typescript
  // --- RequireComponent attribute ---
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

  // --- Asset references (generic invocations + InstantiateAsync) ---
  const ASSET_LOAD_REGEX = /(?:Resources\.Load(?:All)?|Addressables\.LoadAssetAsync|(?:\w+\.)?LoadAsset|(?:\w+\.)?LoadAllAssets)<(\w+)>/;

  for (const invocation of rootNode.descendantsOfType("invocation_expression")) {
    const funcNode = invocation.childForFieldName("function");
    if (!funcNode) continue;
    const funcText = funcNode.text;

    const genericMatch = funcText.match(ASSET_LOAD_REGEX);
    if (genericMatch?.[1]) {
      relations.push({ type: "uses_type", targetRef: genericMatch[1] });
      continue;
    }

    // Addressables.InstantiateAsync — no generic, always GameObject
    if (funcText.includes("InstantiateAsync")) {
      relations.push({ type: "uses_type", targetRef: "GameObject" });
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --reporter=verbose test/ast-csharp.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ast-csharp.ts test/ast-csharp.test.ts
git commit -m "feat(graph): add C# asset reference and RequireComponent extraction"
```

---

### Task 4: Remove old C# tests and verify full suite

**Files:**
- Modify: `test/ast-relations.test.ts` — remove C# test cases (lines ~61-100)
- Modify: `test/graph-integration.test.ts` — remove C# integration test (lines 134-161)
- Keep: `test/graph.test.ts` — symbol-name fallback test stays (resolution logic unchanged)
- Keep: `LANGUAGE_QUERIES.csharp` in `ast.ts` (line 146, chunking용 — 변경 불필요)

- [ ] **Step 1: Remove C# tests from `ast-relations.test.ts`**

Remove the two C# test blocks:
- `"extracts C# symbols (class, method, interface, enum, struct)"` (line 63)
- `"extracts C# relations (using, extends, implements, attributes, generic loads)"` (line 80)

And the `// --- C# ---` comment (line 61).

- [ ] **Step 2: Remove C# test from `graph-integration.test.ts`**

Remove the test block `"extracts C# symbols and resolves inheritance by symbol name"` (lines 134-161, including the closing `});` of the describe block if it becomes the last test — check context).

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run --reporter=verbose`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add test/ast-relations.test.ts test/graph-integration.test.ts
git commit -m "test: remove old C# test cases replaced by ast-csharp tests"
```
