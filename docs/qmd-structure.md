# QMD 코드베이스 구조 분석

> Task 0 Step 2 결과물. HwiCortex 하드포크를 위한 QMD 내부 아키텍처 문서.

## 파일 구조 (실제)

```
src/
├── index.ts               ← SDK 진입점 (QMDStore 인터페이스 export)
├── store.ts               ← 핵심 (4576줄): 인덱싱, 검색, 청킹 전부 포함
├── collections.ts         ← 컬렉션 설정 관리
├── db.ts                  ← SQLite 추상화 (Bun/Node.js 호환)
├── llm.ts                 ← LLM 래퍼 (임베딩, 리랭킹, 생성)
├── cli/
│   ├── qmd.ts             ← CLI 명령어 디스패처 (3400줄, switch문)
│   └── formatter.ts       ← 출력 포매팅 (CSV, XML, JSON, MD)
└── mcp/
    └── server.ts          ← MCP 서버 (도구, 리소스, HTTP)
```

**중요**: 설계 문서의 `core/indexer/`, `core/search/`, `core/collection/`, `core/store/` 디렉토리 구조는 QMD에 존재하지 않음. 모두 `store.ts` + `collections.ts`에 통합되어 있음.

---

## SQLite 스키마

### documents 테이블
```sql
id INTEGER PRIMARY KEY,
collection TEXT NOT NULL,
path TEXT NOT NULL,
title TEXT NOT NULL,
hash TEXT NOT NULL,          -- → content(hash) FK
created_at TEXT NOT NULL,
modified_at TEXT NOT NULL,
active INTEGER DEFAULT 1,
UNIQUE(collection, path)
```

### content 테이블 (CAS)
```sql
hash TEXT PRIMARY KEY,       -- SHA256
doc TEXT NOT NULL,
created_at TEXT NOT NULL
```

### content_vectors 테이블
```sql
hash TEXT NOT NULL,
seq INTEGER NOT NULL,        -- 청크 순서
pos INTEGER NOT NULL,        -- 원본 내 오프셋
model TEXT NOT NULL,
embedded_at TEXT NOT NULL,
PRIMARY KEY (hash, seq)
```

### documents_fts (FTS5 가상 테이블)
```sql
filepath TEXT,
title TEXT,
body TEXT,
tokenize='porter unicode61'
```

### store_collections 테이블
```sql
name TEXT PRIMARY KEY,
path TEXT NOT NULL,
pattern TEXT DEFAULT '**/*.md',
ignore_patterns TEXT,
include_by_default INTEGER DEFAULT 1,
update_command TEXT,
context TEXT                 -- JSON
```

### llm_cache, store_config
- llm_cache: LLM API 호출 캐시 (hash → result)
- store_config: 키-값 메타데이터 (config_hash 등)

**schema_version 테이블은 존재하지 않음** → 신규 추가 필요

---

## HwiCortex 수정 대상 매핑

| 설계 문서 (원래) | 실제 QMD 파일 | 수정 내용 |
|------------------|---------------|-----------|
| core/store/ | `src/store.ts` (740~869줄) | schema_version 테이블 + 마이그레이션 러너 추가 |
| core/indexer/ | `src/store.ts` (1171줄 `reindexCollection()`) | documents 테이블에 source_type, project, tags 컬럼 추가 |
| core/search/ | `src/store.ts` (2927줄 `searchFTS()`, 3906줄 `hybridQuery()`) | source_type WHERE 필터 추가 |
| core/collection/ | `src/collections.ts` (27줄 `Collection` 인터페이스) | type 필드 추가 (filesystem/session/dynamic) |
| CLI 명령어 등록 | `src/cli/qmd.ts` (2822줄 switch문) | ingest, extract, watch, rebuild case 추가 |
| MCP 도구 등록 | `src/mcp/server.ts` (172줄 `createMcpServer()`) | query 도구에 source 파라미터 추가 |

---

## 핵심 함수 레퍼런스

| 함수 | 파일 | 라인 | 용도 |
|------|------|------|------|
| `reindexCollection()` | store.ts | 1171 | 파일시스템 스캔 → 인덱싱 |
| `generateEmbeddings()` | store.ts | 1397 | 벡터 임베딩 생성 |
| `hybridQuery()` | store.ts | 3906 | 하이브리드 검색 (BM25 + 벡터 + 리랭크) |
| `searchFTS()` | store.ts | 2927 | BM25 검색 |
| `searchVec()` | store.ts | 3002 | 벡터 검색 |
| `structuredSearch()` | store.ts | 4302 | 사전 확장 쿼리 검색 |
| `loadConfig()` | collections.ts | 150 | YAML 설정 로드 |
| `createStore()` | index.ts | 338 | SDK 스토어 생성 |
| `startMcpServer()` | mcp/server.ts | 540 | MCP stdio 서버 |
| `startMcpHttpServer()` | mcp/server.ts | 565 | MCP HTTP 서버 |

---

## 검색 파이프라인

```
hybridQuery() 흐름:
1. BM25 프로브 (원본 쿼리)
2. 쿼리 확장 (LLM → lex/vec/hyde 변형)
3. 타입별 검색 (lex→FTS, vec/hyde→벡터)
4. RRF 퓨전 (역순위 합산)
5. 청크 추출 (키워드 매칭)
6. LLM 리랭킹 (Qwen3-Reranker)
7. 위치 가중 블렌딩
8. 중복 제거 + 필터 + 슬라이스
```

### 현재 검색 필터
- `collection`: 컬렉션명 필터
- `minScore`: 점수 임계값
- `intent`: LLM 힌트
- `limit`: 최대 결과 수

### 추가할 필터
- `source_type`: docs | sessions | knowledge (documents 테이블 컬럼 기반)

---

## CLI 명령어 등록 패턴

```typescript
// src/cli/qmd.ts 2822줄 switch문에 case 추가
case "ingest": {
  // cli.args[0]: path, cli.opts: name, pattern
  break;
}
```

## MCP 도구 등록 패턴

```typescript
// src/mcp/server.ts, createMcpServer() 내부
server.registerTool(
  "tool_name",
  {
    title: "...",
    description: "...",
    inputSchema: z.object({...}),
    annotations: { readOnlyHint: true },
  },
  async (input) => {
    return { content: [...] };
  }
);
```

---

## 컬렉션 인터페이스

```typescript
// src/collections.ts:27
interface Collection {
  path: string;
  pattern: string;           // "**/*.md"
  ignore?: string[];
  context?: ContextMap;
  update?: string;           // bash 명령어
  includeByDefault?: boolean;
}
```

---

## 주요 상수

```
청킹: CHUNK_SIZE_CHARS=3600, OVERLAP=540
검색: STRONG_SIGNAL_MIN_SCORE=0.85, RERANK_CANDIDATE_LIMIT=40
모델: embeddinggemma, Qwen3-Reranker-0.6B, Qwen3-1.7B
기본 글로브: **/*.md
DB 경로: ~/.cache/qmd/index.sqlite
설정 경로: ~/.config/qmd/index.yml
```
