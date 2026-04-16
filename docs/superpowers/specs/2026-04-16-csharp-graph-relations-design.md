# C# Graph Relations Redesign

## Summary

Remove all existing C# relation extraction logic from `ast.ts` and replace with a focused module (`src/ast-csharp.ts`) that extracts only two categories of relations: inheritance/implementation and asset references.

## Motivation

Current C# extraction has several problems:
- `using` directives mapped to `imports` don't represent real dependencies
- I-prefix heuristic for interface detection, while standard in C#, is mixed in with noisy relation types
- Only 3 hardcoded asset reference patterns (`RequireComponent`, `Resources.Load`, `Addressables.LoadAssetAsync`)
- Path-based resolution doesn't fit C# where class name != file path

## Design

### Node Definition

Each node is a C# script identified by its class name (file name). No method-level symbols.

### File Structure

**Delete:**
- `ast.ts`: `SYMBOL_QUERIES.csharp` entry
- `ast.ts`: `else if (language === "csharp")` relation extraction block
- C# test cases in `ast-relations.test.ts`, `ast.test.ts`, `graph-integration.test.ts`
- **Keep**: `LANGUAGE_QUERIES.csharp` (chunking용, 그래프와 무관), `graph.test.ts`의 symbol-name fallback resolution 테스트 (resolution 로직 검증용)

**Create:**
- `src/ast-csharp.ts` — C# symbol + relation extraction

**Modify:**
- `ast.ts` — delegate to `ast-csharp.ts` when `language === "csharp"`

### Module API

`ast-csharp.ts` exports:
```typescript
export function extractCSharpSymbolsAndRelations(
  rootNode: SyntaxNode,
  filepath: string
): { symbols: AstSymbol[]; relations: AstRelation[] };
```

`ast.ts`의 `extractSymbolsAndRelations`에서 `language === "csharp"`일 때 이 함수로 위임. tree-sitter 파서 초기화/삭제는 `ast.ts`가 담당.

**Unchanged:**
- DB schema, `graph.ts` (`FileGraphInfo`), CLI, resolution logic

### Symbol Extraction

| kind | tree-sitter node | example |
|------|-----------------|---------|
| `class` | `class_declaration` | `PlayerController` |
| `interface` | `interface_declaration` | `IDamageable` |
| `enum` | `enum_declaration` | `WeaponType` |
| `type` | `struct_declaration` | `Vector3Int` |

Method symbols are excluded — node granularity is script (class) level. This is an intentional behavioral change: previously indexed C# method symbols will disappear from the `symbols` table after reindex.

### Relation Extraction

#### Inheritance / Implementation

| type | condition | example |
|------|-----------|---------|
| `extends` | base_list class inheritance | `class Player : MonoBehaviour` |
| `implements` | base_list interface | `class Player : IDamageable` |

Detection: I-prefix + uppercase second char = `implements`, otherwise `extends`. Generic params stripped (`Base<T>` -> `Base`), namespace prefixes stripped.

#### Component Dependencies (`uses_type` via attribute)

| pattern | example |
|---------|---------|
| `[RequireComponent(typeof(T))]` | `[RequireComponent(typeof(Rigidbody))]` |

Extract from `attribute` nodes where name is `RequireComponent`, then find `typeof_expression` children.

#### Asset References (`uses_type` via invocation)

Extract generic type parameter from `invocation_expression`:

| pattern | example |
|---------|---------|
| `Resources.Load<T>()` | `Resources.Load<AudioClip>("sfx")` |
| `Resources.LoadAll<T>()` | `Resources.LoadAll<Sprite>("icons")` |
| `Addressables.LoadAssetAsync<T>()` | `Addressables.LoadAssetAsync<GameObject>(key)` |
| `Addressables.InstantiateAsync()` | No generic — separate string match, fixed `targetRef: "GameObject"` |
| `AssetBundle.LoadAsset<T>()` | `bundle.LoadAsset<Texture2D>("tex")` |
| `AssetBundle.LoadAllAssets<T>()` | `bundle.LoadAllAssets<Material>()` |

Generic invocations detected via regex:
```
/(?:Resources\.Load(?:All)?|Addressables\.LoadAssetAsync|(?:\w+\.)?LoadAsset|(?:\w+\.)?LoadAllAssets)<(\w+)>/
```

`Addressables.InstantiateAsync` has no generic parameter — detected by separate string match (`funcText.includes("InstantiateAsync")`), maps to `targetRef: "GameObject"`.

**Not generated:** `imports` (from using directives), `calls`.

### Resolution

No changes to `resolveTargetHashes`. C# relations use the existing symbol-name fallback path:
- `extends Player` -> symbolLookup finds `Player` class hash
- `uses_type AudioClip` -> matches if `AudioClip.cs` exists in collection, otherwise unresolved (Unity built-in, expected)

### Test Plan (`test/ast-csharp.test.ts`)

| test | verifies |
|------|----------|
| symbol extraction | class, interface, enum, struct extracted / method excluded |
| extends | `class A : B` -> extends relation |
| implements | `class A : IFoo` -> implements relation |
| mixed inheritance | `class A : B, IFoo, IBar` -> 1 extends + 2 implements |
| generic strip | `Base<T>` -> targetRef `Base` |
| Resources.Load | `Resources.Load<AudioClip>()` -> uses_type |
| Addressables | `Addressables.LoadAssetAsync<GameObject>()` -> uses_type |
| AssetBundle | `bundle.LoadAsset<Texture2D>()` -> uses_type |
| InstantiateAsync | no generic -> targetRef `GameObject` |
| no using imports | using directive present but no imports relation generated |
| RequireComponent | `[RequireComponent(typeof(Rigidbody))]` -> uses_type |
