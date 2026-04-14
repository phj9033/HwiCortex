# Graph Integration Design

**Date:** 2026-04-14
**Status:** Approved
**Branch:** `feature/graph-integration`

## Overview

HwiCortex에 코드 관계 그래프 기능을 추가한다. AST에서 심볼과 관계를 추출하여 SQLite에 저장하고, 클러스터 자동 감지, CLI 명령, 검색 결과 보강, Obsidian 시각화를 제공한다. LLM 호출 없이, 기존 `update` 플로우에 통합.

## Design Decisions

- LLM 의미 추출은 포함하지 않음 (비용 + HwiCortex의 "로컬 우선" 철학)
- MCP 서버 미사용 예정 — 그래프 기능은 CLI 전용
- `calls` 관계는 import된 심볼과 교차 검증하여 노이즈 필터링
- 클러스터링은 label propagation (외부 의존성 없이 순수 JS)
- 시각화는 Obsidian 호환 마크다운 (HTML 시각화 제외)

## Data Model

### `symbols` table

AST에서 추출한 심볼(함수, 클래스, 타입 등).

```sql
CREATE TABLE symbols (
  id INTEGER PRIMARY KEY,
  hash TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,  -- function, class, interface, type, enum, method
  line INTEGER,
  FOREIGN KEY (hash) REFERENCES content(hash)
);
CREATE INDEX idx_symbols_hash ON symbols(hash);
CREATE INDEX idx_symbols_name ON symbols(name);
```

### `relations` table

심볼/파일 간 관계.

```sql
CREATE TABLE relations (
  id INTEGER PRIMARY KEY,
  source_hash TEXT NOT NULL,
  target_hash TEXT,
  target_ref TEXT NOT NULL,
  type TEXT NOT NULL,  -- imports, calls, extends, implements, uses_type
  source_symbol TEXT,
  target_symbol TEXT,
  confidence REAL DEFAULT 1.0,
  FOREIGN KEY (source_hash) REFERENCES content(hash)
);
CREATE INDEX idx_relations_source ON relations(source_hash);
CREATE INDEX idx_relations_target ON relations(target_hash);
CREATE INDEX idx_relations_type ON relations(type);
```

### `clusters` and `cluster_members` tables

자동 감지된 모듈 그룹.

```sql
CREATE TABLE clusters (
  id INTEGER PRIMARY KEY,
  collection TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(collection, name)
);

CREATE TABLE cluster_members (
  cluster_id INTEGER NOT NULL,
  hash TEXT NOT NULL,
  PRIMARY KEY (cluster_id, hash),
  FOREIGN KEY (cluster_id) REFERENCES clusters(id),
  FOREIGN KEY (hash) REFERENCES content(hash)
);
```

## AST Symbol & Relation Extraction

### New types in `ast.ts`

```typescript
interface AstSymbol {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'enum' | 'method';
  line: number;
}

interface AstRelation {
  type: 'imports' | 'calls' | 'extends' | 'implements' | 'uses_type';
  sourceSymbol?: string;
  targetRef: string;
  targetSymbol?: string;
}

interface AstAnalysis {
  breakPoints: AstBreakPoint[];
  symbols: AstSymbol[];
  relations: AstRelation[];
}
```

### Language-specific extraction

**TypeScript/JavaScript:**
- `import_statement` → imports relation + cache imported symbol names
- `class_declaration` → extends/implements + symbol registration
- `function_declaration`, `arrow_function` → symbol registration
- `call_expression` → cross-check with imported symbols → calls relation

**Python:**
- `import_from_statement` → imports
- `class_definition` → extends (base classes from argument_list)
- `call` → calls (imported names only)

**Go:**
- `import_spec` → imports
- `type_spec` with embedded struct → extends
- `call_expression` → calls

**Rust:**
- `use_declaration` → imports
- `impl_item` (trait impl) → implements
- `call_expression` → calls

### `calls` filtering policy

- Only track calls to imported symbols (cross-validate with import list)
- Only target functions defined within the same collection
- Exclude stdlib/external package calls

### target_hash resolution

1. Relative path (`./auth`) → match against `documents.path` in same collection
2. On failure → `target_hash = NULL`, preserve `target_ref`
3. Re-attempt NULL target_hash resolution on subsequent `update` runs

## Indexing Integration

### Modified `update` flow

```
scan → hash → document → chunk → FTS
                ↓
         AST parseable? → extract symbols/relations → save to DB
                                    ↓
                             resolve target_hash
                                    ↓
                             cluster detection (per collection)
```

- AST-supported languages only (.ts, .js, .tsx, .jsx, .py, .go, .rs)
- Skip if content hash unchanged (already extracted)
- `--force` re-extracts symbols/relations
- Clustering runs after all relations extracted for a collection

### Clustering algorithm

Label propagation (pure JS, no external dependency):
1. Build adjacency from `relations` table for a collection
2. Run label propagation until convergence
3. Name clusters by most-imported symbol
4. Save to `clusters` / `cluster_members`

## CLI Commands

### New commands

```sh
hwicortex graph <file>              # Show file relationships
hwicortex path <fileA> <fileB>      # Find connection path
hwicortex related <file>            # Direct relations + same cluster
hwicortex graph clusters [--collection <name>]  # List clusters
hwicortex symbol <name>             # Find symbol definition & usages
```

### Search result enhancement

Append relation context to `search`/`query` results:

```
[0.92] src/store.ts — "createStore function handles..."
       cluster: store-core | imported by: 12 files
```

Disable with `--no-graph` flag.

## Obsidian Visualization

### Cluster index pages

Generated at `vault/wiki/{project}/_clusters/`:

```markdown
---
title: "Cluster: store-core"
tags: [cluster, auto-generated]
---

## store-core

**핵심 심볼:** createStore, SearchEngine, ContentStore
**파일 수:** 8

### 파일 목록
- [[store]] — imports: db, collections, llm
- [[db]] — imports: (외부)
...

### 관계 요약
- 내부 연결: 15
- 외부 의존: 4
```

### File relation notes (optional)

Generated with `hwicortex graph --obsidian`:

```markdown
---
title: "store.ts"
tags: [graph, store-core]
related: [[db]], [[collections]], [[llm]]
---

## 심볼
- `createStore` (function)
- `SearchEngine` (class)

## 관계
- imports: [[db]], [[collections]], [[llm]], [[ast]]
- imported by: [[cli/qmd]], [[index]], [[mcp/server]]
```

## What Changes (Before vs After)

| | Before | After |
|---|---|---|
| "이 파일이 뭐랑 연결돼?" | 직접 코드 열어서 확인 | `hwicortex graph <file>` |
| "A에서 B까지 어떻게 연결돼?" | 불가능 | `hwicortex path A B` |
| "이 함수 어디서 쓰이지?" | grep 수동 검색 | `hwicortex symbol <name>` |
| "이 코드베이스 구조가 뭐야?" | 사람이 파악 | `hwicortex graph clusters` |
| 검색 결과 | 문서 조각만 | 문서 조각 + 관계 컨텍스트 + 클러스터 |
| Obsidian | wiki 페이지만 | wiki + 클러스터 인덱스 + 관계 노트 |
| 인덱싱 | `update` 한 번 | `update` 한 번 (관계 자동 포함) |
| 추가 비용 | — | LLM 호출 없음, AST 파싱만 |
