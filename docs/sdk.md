# SDK (라이브러리 모드)

HwiCortex를 TypeScript/JavaScript 프로젝트에서 직접 import하여 사용할 수 있다.

진입점: `src/index.ts` → `dist/index.js`

## 설치

```sh
# 로컬 경로로 설치 (개발 중)
bun add /path/to/hwicortex

# npm publish 후
bun add hwicortex
```

## 기본 사용

```typescript
import { createStore } from "hwicortex";

const store = await createStore({
  dbPath: "./my-index.sqlite",
  config: {
    collections: {
      docs: { path: "./docs", pattern: "**/*.md" },
      code: { path: "./src", pattern: "**/*.ts" },
    },
  },
});

// 하이브리드 검색 (쿼리 확장 + BM25 + 벡터 + 리랭킹)
const results = await store.search({ query: "인증 흐름" });
for (const r of results) {
  console.log(`${r.file} (score: ${r.score})`);
}

await store.close();
```

## 검색

```typescript
// 하이브리드 검색 (추천)
const results = await store.search({
  query: "인증 흐름",
  limit: 10,
  collection: "docs",       // 특정 컬렉션만 (선택)
  minScore: 0.3,            // 최소 점수 (선택)
});

// BM25 키워드 검색 (LLM 불필요, 빠름)
const lexResults = await store.searchLex("cancelOrder");

// 벡터 유사도 검색
const vecResults = await store.searchVector("에러 처리 패턴");

// 쿼리 확장만 실행 (검색 없이)
const expanded = await store.expandQuery("auth flow");
```

### SearchResult 타입

```typescript
interface SearchResult {
  file: string;        // 파일 경로
  title: string;       // 문서 제목
  score: number;       // 관련성 점수
  snippet: string;     // 매칭된 스니펫
  docid: string;       // 문서 ID (#abc123)
  collection: string;  // 컬렉션 이름
  context: string | null; // 컬렉션 컨텍스트
}
```

## 문서 조회

```typescript
// 단일 문서 (경로 또는 docid)
const doc = await store.get("src/auth/login.ts");
if (!("error" in doc)) {
  console.log(doc.title, doc.file, doc.body);
}

const docById = await store.get("#abc123");

// 여러 문서 배치 조회
const { docs, errors } = await store.multiGet("src/auth/*.ts");
```

## 컬렉션 관리

```typescript
// 추가 / 삭제 / 이름 변경
await store.addCollection("notes", {
  path: "/path/to/notes",
  pattern: "**/*.md",
});
await store.removeCollection("notes");
await store.renameCollection("notes", "my-notes");

// 목록 조회
const collections = await store.listCollections();
const defaults = await store.getDefaultCollectionNames();
```

## 인덱싱

```typescript
// 파일시스템 스캔으로 인덱스 업데이트
const result = await store.update({
  onProgress: (info) => console.log(`[${info.collection}] ${info.file}`),
});
console.log(`indexed: ${result.indexed}, updated: ${result.updated}`);

// 벡터 임베딩 생성
const embedResult = await store.embed({
  onProgress: (info) => console.log(`${info.current}/${info.total}`),
});
```

## 컨텍스트 관리

```typescript
// 컬렉션에 컨텍스트 추가 (검색 품질 개선)
await store.addContext("docs", "/api", "REST API 엔드포인트 문서");
await store.setGlobalContext("Spring Boot 기반 주문 관리 시스템");

// 조회 / 삭제
const contexts = await store.listContexts();
const global = await store.getGlobalContext();
await store.removeContext("docs", "/api");
```

## 상태 확인

```typescript
const status = await store.getStatus();
console.log(status.totalDocuments, status.collections);

const health = await store.getIndexHealth();
console.log(`stale embeddings: ${health.staleEmbeddings}`);
```

## 유틸리티

```typescript
import {
  extractSnippet,
  addLineNumbers,
  extractSymbolsAndRelations,
  getASTStatus,
  getDefaultDbPath,
} from "hwicortex";

// 텍스트에서 쿼리 관련 스니펫 추출
const snippet = extractSnippet(body, queryTerms);

// 줄번호 추가
const numbered = addLineNumbers(text, startLine);

// AST 심볼/관계 추출
const analysis = await extractSymbolsAndRelations(code, "typescript");
```

## 내보내는 타입

```typescript
// 검색
type SearchResult, HybridQueryResult, HybridQueryOptions, HybridQueryExplain
type ExpandedQuery, StructuredSearchOptions

// 문서
type DocumentResult, DocumentNotFound, MultiGetResult

// 컬렉션
type Collection, CollectionConfig, NamedCollection, ContextMap

// 인덱스
type IndexStatus, IndexHealthInfo, SearchHooks
type ReindexProgress, ReindexResult, EmbedProgress, EmbedResult

// AST
type AstSymbol, AstRelation, AstAnalysis
type ChunkStrategy  // "auto" | "regex"
```

## 응용 예시: Express API

```typescript
import express from "express";
import { createStore, type QMDStore } from "hwicortex";

const app = express();
let store: QMDStore;

app.get("/api/search", async (req, res) => {
  const query = req.query.q as string;
  if (!query) return res.status(400).json({ error: "q required" });

  const results = await store.search({
    query,
    limit: Number(req.query.limit) || 10,
  });
  res.json(results.map((r) => ({
    file: r.file, score: r.score, snippet: r.snippet,
  })));
});

store = await createStore({
  dbPath: "./index.sqlite",
  config: { collections: { docs: { path: "./docs", pattern: "**/*.md" } } },
});
await store.update();
app.listen(3000);
```

## 응용 예시: CI 문서 품질 검사

```typescript
import { createStore } from "hwicortex";

const store = await createStore({
  dbPath: ":memory:",
  config: { collections: { docs: { path: "./docs", pattern: "**/*.md" } } },
});
await store.update();

const status = await store.getStatus();
if (status.totalDocuments < 10) {
  console.error(`문서 부족: ${status.totalDocuments}개`);
  process.exit(1);
}
await store.close();
```
