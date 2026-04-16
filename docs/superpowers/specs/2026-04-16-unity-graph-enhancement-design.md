# Unity Graph Enhancement Design

## Goal

Improve hwicortex graph analysis for Unity C# projects by:
1. Extracting field type references and Singleton access patterns from C# code
2. Fixing existing graph layer to surface `uses_type` relations
3. Restructuring `related` output into categorized sections
4. Adding an `impact` command for change impact analysis

These changes transform `related` from a flat list of 55 sibling classes into a focused view of actual business-logic dependencies, and add a new tool for assessing modification risk.

## Context

Current C# extraction (`ast-csharp.ts`) only captures `extends`, `implements`, and `uses_type` (RequireComponent, asset loading). This causes clustering to group all BasePopup descendants together, and `related` returns the entire cluster regardless of actual runtime dependency.

In Unity projects, the dominant inter-class connection patterns are:
- **Field type references**: `[SerializeField] private HeartManager heartManager;`
- **Singleton access**: `PopupManager.Instance.Show<T>()`

Neither is currently extracted.

### Existing bugs to fix

1. **`FileGraphInfo` and CLI do not surface `uses_type` relations.** `getFileGraph()` has no `usesType`/`usedByType` fields. All existing `uses_type` relations (RequireComponent, asset references) are stored in the DB but silently discarded by the graph query and CLI layers. Must add `usesType` and `usedByType` fields to `FileGraphInfo`, and update `getFileGraph()`, `handleGraph()`, and `handleRelated()` to consume them.

2. **`handleRelated` does not iterate `extends`/`implements` outgoing relations.** It only collects from `imports`, `calls`, `wikiLinks` and their reverses. Must add `extends`/`extendedBy`/`implements`/`implementedBy` to the related file collection.

3. **Existing RequireComponent extraction missing `sourceSymbol`.** The relation is pushed as `{ type: "uses_type", targetRef }` without identifying which class has the attribute. Must add `sourceSymbol` for consistency with the new extractions.

## Part 1: C# Relation Extraction Enhancement

### 1.1 Field Type Reference Extraction

Extract type names from field and property declarations in class/struct bodies.

**Source patterns:**
```csharp
public class BuyHeartPopup : BasePopup {
    [SerializeField] private HeartManager heartManager;  // → uses_type: HeartManager
    [SerializeField] Button buyButton;                    // → uses_type: Button
    private BillingHelper billing;                        // → uses_type: BillingHelper
    public List<RewardItem> rewards;                      // → uses_type: RewardItem
    public HeartManager HeartMgr { get; set; }            // → uses_type: HeartManager
    private HeartManager? optionalRef;                    // → uses_type: HeartManager
    private HeartManager[] managerArray;                  // → uses_type: HeartManager
}
```

**AST approach:**
- Walk `field_declaration` and `property_declaration` nodes inside `class_declaration` / `struct_declaration`
- Extract the type node text
- For generic types (`List<RewardItem>`), extract the inner type argument(s)
- For nullable types (`HeartManager?`), strip trailing `?`
- For array types (`HeartManager[]`), extract the element type
- Strip namespace prefixes (`UnityEngine.UI.Button` → `Button`)

**Relation emitted:**
- `type`: `"uses_type"`
- `sourceSymbol`: enclosing class/struct name
- `targetRef`: extracted type name

### 1.2 Singleton Access Pattern Extraction

Extract `Xxx.Instance` member access patterns.

**Source patterns:**
```csharp
PopupManager.Instance.Show<BuyHeartPopup>();   // → uses_type: PopupManager
UserDataManager.Instance.GetHeartCount();       // → uses_type: UserDataManager
```

**AST approach:**
- Walk `member_access_expression` nodes
- Match pattern: identifier `.` `Instance`
- Extract the left-hand identifier as the referenced type

**Relation emitted:**
- `type`: `"uses_type"`
- `sourceSymbol`: enclosing class name
- `targetRef`: the Singleton class name (e.g., `PopupManager`)

### 1.3 Noise Filter

Exclude common types that add noise without useful dependency signal.

**Excluded categories (hardcoded):**
- **C# primitives:** `int`, `float`, `double`, `bool`, `string`, `byte`, `long`, `char`, `decimal`, `object`, `void`, `var`
- **Unity ubiquitous types:** `GameObject`, `Transform`, `MonoBehaviour`, `Component`, `ScriptableObject`, `Vector2`, `Vector3`, `Vector4`, `Quaternion`, `Color`, `Color32`, `Rect`, `Bounds`
- **Collection wrappers:** `List`, `Dictionary`, `HashSet`, `Queue`, `Stack`, `Array`, `IEnumerable`, `IList`, `IDictionary`, `ICollection`
- **System types:** `Action`, `Func`, `Task`, `CancellationToken`, `IDisposable`

Generic inner types are NOT excluded — `List<RewardItem>` excludes `List` but keeps `RewardItem`.

**Deduplication:** Multiple fields referencing the same type in one file emit only one `uses_type` relation per (sourceSymbol, targetRef) pair.

### 1.4 Fix existing RequireComponent extraction

Update the RequireComponent block in `ast-csharp.ts` to include `sourceSymbol` (the enclosing class name). This requires finding the nearest ancestor `class_declaration` for each attribute node.

### 1.5 Files Modified

- `src/ast-csharp.ts` — add field/property type + singleton extraction, fix RequireComponent sourceSymbol
- `test/ast-csharp.test.ts` — add test cases

## Part 2: Graph Layer Fixes

### 2.1 Add `uses_type` to FileGraphInfo

In `src/graph.ts`:
- Add `usesType: RelationRow[]` and `usedByType: RelationRow[]` fields to `FileGraphInfo`
- Update `getFileGraph()` to populate them from outgoing/incoming `"uses_type"` relations

### 2.2 Update `graph <file>` display

In `src/cli/graph.ts`:
- `handleGraph()` must display `uses_type` and `used by (type)` sections alongside existing extends/implements/imports/calls

### 2.3 Files Modified

- `src/graph.ts` — extend `FileGraphInfo` interface and `getFileGraph()`
- `src/cli/graph.ts` — update `handleGraph()` display

## Part 3: CLI Enhancement

### 3.1 `related` Categorized Output

Restructure `related` output into 4 sections:

```
$ hwicortex related popup/common/buyheartpopup.cs

Direct Dependencies (this file uses):
  popup/manager/basepopup.cs          extends BasePopup
  game/data/userdatamanager.cs        uses_type UserDataManager
  game/data/billinghelper.cs          uses_type BillingHelper

Dependents (uses this file):
  popup/manager/popupmanager.cs       uses_type BuyHeartPopup

Same Module (cluster members, excluding above):
  popup/common/buyitempopup.cs
  popup/common/confirmpopup.cs

Related Docs:
  bb3-docs/2026-04-09-heart.md        "하트 시스템 기획 정리"
```

**Implementation:**
- **Direct Dependencies:** all outgoing relations (extends, implements, uses_type, imports, calls)
- **Dependents:** all incoming relations (extendedBy, implementedBy, usedByType, importedBy, calledBy)
- **Same Module:** cluster members minus files already shown in Dependencies/Dependents
- **Related Docs:** raw FTS5 query against `documents_fts` using the file's symbol names, filtered to doc-type collections (top 3). Only shown if doc collections exist. Implemented as `getRelatedDocs()` in `graph.ts` using direct SQL (consistent with existing pattern where `graph.ts` operates on the Database directly).
- Each relation line shows the relation type for context

**Flags:**
- `--json` — structured JSON output:
  ```json
  {
    "file": "popup/common/buyheartpopup.cs",
    "dependencies": [{ "path": "...", "type": "extends", "ref": "BasePopup" }],
    "dependents": [{ "path": "...", "type": "uses_type", "ref": "BuyHeartPopup" }],
    "module": ["popup/common/buyitempopup.cs"],
    "docs": [{ "path": "...", "title": "...", "score": 0.94 }]
  }
  ```
- Existing flags (`--collection`, `--full`) remain unchanged

### 3.2 `impact` Command

New command for change impact analysis.

```
$ hwicortex impact popup/manager/basepopup.cs

Direct Impact (depends on this file):
  55 files extend BasePopup
  popup/manager/popupmanager.cs       uses_type BasePopup

Transitive Impact (2-hop):
  game/data/userdatamanager.cs        via BuyHeartPopup → UserDataManager
  ...

Summary: 55 direct, 12 transitive — Risk: HIGH
```

**Implementation:**
- **Direct Impact:** all files with incoming relations to this file's hash
- **Transitive Impact:** BFS from direct dependents, loading relations per-hash. For typical Unity projects (< 1000 files, < 100 direct dependents), per-hash queries are acceptable. No batch optimization needed initially.
- **Risk level:** based on direct dependent count
  - 1-3: LOW
  - 4-10: MEDIUM
  - 11+: HIGH
- **Summary line:** counts + risk level

**Flags:**
- `--depth <n>` — transitive hop depth (default: 2, max: 3)
- `--json` — structured output (same shape as `related --json` with added `transitive` and `risk` fields)
- `-c, --collection` — scope to collection

### 3.3 Files Modified

- `src/cli/graph.ts` — refactor `handleRelated`, add `handleImpact`
- `src/graph.ts` — add `getImpact()` query function, add `getRelatedDocs()` function
- `src/cli/qmd.ts` — register `impact` command

## Testing Strategy

- **Unit tests** (`test/ast-csharp.test.ts`): field type extraction, property extraction, singleton pattern extraction, noise filtering, deduplication, nullable/array type handling, RequireComponent sourceSymbol
- **Unit tests** (`test/graph.test.ts`): `uses_type` in FileGraphInfo, impact traversal, categorized related output
- **Manual validation**: run against bb3-code collection, compare `related` and `impact` output before/after

## Scope Boundaries

- No `using` statement / import extraction (low signal in Unity projects)
- No method call graph (high complexity, defer to future)
- No delegate/event tracking (defer)
- No AI skill integration (explicitly excluded)
- Filter list is hardcoded, not configurable (adjust based on usage feedback)
