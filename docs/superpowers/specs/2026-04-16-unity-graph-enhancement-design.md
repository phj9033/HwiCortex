# Unity Graph Enhancement Design

## Goal

Improve hwicortex graph analysis for Unity C# projects by:
1. Extracting field type references and Singleton access patterns from C# code
2. Restructuring `related` output into categorized sections
3. Adding an `impact` command for change impact analysis

These changes transform `related` from a flat list of 55 sibling classes into a focused view of actual business-logic dependencies, and add a new tool for assessing modification risk.

## Context

Current C# extraction (`ast-csharp.ts`) only captures `extends`, `implements`, and `uses_type` (RequireComponent, asset loading). This causes clustering to group all BasePopup descendants together, and `related` returns the entire cluster regardless of actual runtime dependency.

In Unity projects, the dominant inter-class connection patterns are:
- **Field type references**: `[SerializeField] private HeartManager heartManager;`
- **Singleton access**: `PopupManager.Instance.Show<T>()`

Neither is currently extracted.

## Part 1: C# Relation Extraction Enhancement

### 1.1 Field Type Reference Extraction

Extract type names from field declarations in class/struct bodies.

**Source patterns:**
```csharp
public class BuyHeartPopup : BasePopup {
    [SerializeField] private HeartManager heartManager;  // → uses_type: HeartManager
    [SerializeField] Button buyButton;                    // → uses_type: Button
    private BillingHelper billing;                        // → uses_type: BillingHelper
    public List<RewardItem> rewards;                      // → uses_type: RewardItem
}
```

**AST approach:**
- Walk `field_declaration` nodes inside `class_declaration` / `struct_declaration`
- Extract the type node text
- For generic types (`List<RewardItem>`), extract the inner type argument(s)
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
- **C# primitives:** `int`, `float`, `double`, `bool`, `string`, `byte`, `long`, `char`, `decimal`, `object`, `void`
- **Unity ubiquitous types:** `GameObject`, `Transform`, `MonoBehaviour`, `Component`, `ScriptableObject`, `Vector2`, `Vector3`, `Vector4`, `Quaternion`, `Color`, `Color32`, `Rect`, `Bounds`
- **Collection wrappers:** `List`, `Dictionary`, `HashSet`, `Queue`, `Stack`, `Array`, `IEnumerable`, `IList`, `IDictionary`, `ICollection`
- **System types:** `Action`, `Func`, `Task`, `CancellationToken`, `IDisposable`

Generic inner types are NOT excluded — `List<RewardItem>` excludes `List` but keeps `RewardItem`.

**Deduplication:** Multiple fields referencing the same type in one file emit only one `uses_type` relation per (sourceSymbol, targetRef) pair.

### 1.4 Files Modified

- `src/ast-csharp.ts` — add field type + singleton extraction logic
- `test/ast-csharp.test.ts` — add test cases

## Part 2: CLI Enhancement

### 2.1 `related` Categorized Output

Restructure `related` output into 4 sections:

```
$ hwicortex related popup/common/buyheartpopup.cs

Direct Dependencies (this file uses):
  popup/manager/basepopup.cs          extends BasePopup
  game/data/userdatamanager.cs        uses UserDataManager (Singleton)
  game/data/billinghelper.cs          uses BillingHelper (field)

Dependents (uses this file):
  popup/manager/popupmanager.cs       uses_type BuyHeartPopup

Same Module (cluster members, excluding above):
  popup/common/buyitempopup.cs
  popup/common/confirmpopup.cs

Related Docs:
  bb3-docs/2026-04-09-heart.md        "하트 시스템 기획 정리"
```

**Implementation:**
- `getFileGraph()` already returns categorized relation data
- **Direct Dependencies:** outgoing relations (extends, implements, uses_type)
- **Dependents:** incoming relations (extendedBy, implementedBy, incoming uses_type)
- **Same Module:** cluster members minus files already shown in Dependencies/Dependents
- **Related Docs:** BM25 search using file's symbol names against doc collections (top 3). Only shown if doc collections exist.
- Each relation line shows the relation type for context

**Flags:**
- `--json` — structured JSON output for programmatic use
- Existing flags (`--collection`, `--full`) remain unchanged

### 2.2 `impact` Command

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
- **Direct Impact:** all files with incoming relations to this file's hash (reverse of dependencies)
- **Transitive Impact:** BFS 2 hops from direct dependents, collecting their dependents. Deduplicate against direct set.
- **Risk level:** based on direct dependent count
  - 1-3: LOW
  - 4-10: MEDIUM
  - 11+: HIGH
- **Summary line:** counts + risk level

**Flags:**
- `--depth <n>` — transitive hop depth (default: 2, max: 3)
- `--json` — structured output
- `-c, --collection` — scope to collection

### 2.3 Files Modified

- `src/cli/graph.ts` — refactor `handleRelated`, add `handleImpact`
- `src/graph.ts` — add `getImpact()` query function, add `getRelatedDocs()` function
- `src/cli/qmd.ts` — register `impact` command

## Testing Strategy

- **Unit tests** (`test/ast-csharp.test.ts`): field type extraction, singleton pattern extraction, noise filtering, deduplication
- **Unit tests** (`test/graph.test.ts`): impact traversal, categorized related output
- **Manual validation**: run against bb3-code collection, compare `related` and `impact` output before/after

## Scope Boundaries

- No `using` statement / import extraction (low signal in Unity projects)
- No method call graph (high complexity, defer to future)
- No delegate/event tracking (defer)
- No AI skill integration (explicitly excluded)
- Filter list is hardcoded, not configurable (adjust based on usage feedback)
