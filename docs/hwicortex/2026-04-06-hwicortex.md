# HwiCortex Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** QMD를 하드포크하여 AI 세션 지식 추출 + 문서 검색 통합 도구 HwiCortex를 구축한다.

**Architecture:** QMD 코어(BM25 + 벡터 검색, SQLite, MCP)를 기반으로 ingest/(PDF 파서, 세션 파서, 파일 감시)와 knowledge/(LLM 추출, 분류, 볼트 출력) 레이어를 추가한다. Obsidian 볼트가 소스 오브 트루스이며, SQLite는 파생 인덱스이다.

**Tech Stack:** Bun, SQLite (BM25 + 벡터), node-llama-cpp (GGUF), pdfjs-dist, chokidar, @anthropic-ai/sdk

**Spec:** `docs/2026-04-06-hwicortex-design.md`

**Note:** Task 0 Step 2(QMD 구조 탐색) 완료 후, Phase 1~3의 정확한 파일 경로와 수정 범위를 확정하여 이 계획을 업데이트해야 한다.

---

## File Structure

```
hwicortex/                          (QMD 포크 루트)
├── src/
│   ├── core/                       ← QMD 기존 (최소 수정)
│   │   ├── indexer/                — source_type, project, tags 메타 필드 추가
│   │   ├── search/                 — source_type 필터 추가
│   │   ├── collection/             — 동적 컬렉션 타입 추가
│   │   └── store/                  — schema_version 테이블 + 마이그레이션 러너
│   │
│   ├── ingest/                     ← 신규
│   │   ├── pdf-parser.ts           — PDF → 마크다운 변환
│   │   ├── session-parser/
│   │   │   ├── types.ts            — 공통 파서 인터페이스 + 스키마 버전
│   │   │   ├── claude.ts           — Claude Code JSONL 파서
│   │   │   ├── codex.ts            — Codex CLI JSONL 파서
│   │   │   └── gemini.ts           — Gemini CLI 스텁 (Not Implemented)
│   │   └── watcher.ts              — 세션 디렉토리 감시 데몬
│   │
│   ├── knowledge/                  ← 신규
│   │   ├── llm-provider.ts         — LLM 통합 인터페이스 (로컬/Claude API, 재시도 포함)
│   │   ├── extractor.ts            — LLM 기반 지식 추출
│   │   ├── classifier.ts           — 프로젝트 + 주제 분류
│   │   └── vault-writer.ts         — Obsidian 볼트 마크다운 출력
│   │
│   ├── state/                      ← 신규
│   │   └── state-manager.ts        — state.json 관리 (처리 이력, 실패 큐, 워치 상태)
│   │
│   ├── config/                     ← 신규
│   │   └── config-loader.ts        — YAML 파싱, 환경 변수 치환, 검증
│   │
│   └── cli/                        ← QMD 기존 CLI 확장
│       ├── ingest.ts               — ingest 명령어
│       ├── extract.ts              — extract 명령어
│       ├── watch.ts                — watch 명령어
│       └── rebuild.ts              — rebuild 명령어
│
├── tests/
│   ├── fixtures/
│   │   ├── sessions/
│   │   │   ├── claude-sample.jsonl
│   │   │   └── codex-sample.jsonl
│   │   └── pdfs/
│   │       ├── simple.pdf
│   │       └── broken.pdf
│   ├── core/
│   │   ├── schema.test.ts
│   │   ├── migration.test.ts
│   │   ├── indexer-meta.test.ts
│   │   └── search-filter.test.ts
│   ├── ingest/
│   │   ├── pdf-parser.test.ts
│   │   ├── claude-parser.test.ts
│   │   ├── codex-parser.test.ts
│   │   ├── session-to-markdown.test.ts
│   │   └── watcher.test.ts
│   ├── knowledge/
│   │   ├── llm-provider.test.ts
│   │   ├── extractor.test.ts
│   │   ├── classifier.test.ts
│   │   └── vault-writer.test.ts
│   ├── state/
│   │   └── state-manager.test.ts
│   ├── config/
│   │   └── config-loader.test.ts
│   ├── cli/
│   │   └── extract-pipeline.test.ts
│   └── integration/
│       └── e2e.test.ts
│
└── config/
    └── default.yml                 — 기본 설정 템플릿
```

---

## Phase 0: 프로젝트 셋업

### Task 0: QMD 포크 및 프로젝트 초기화

**Files:**
- Modify: `package.json` (이름, 의존성 추가)
- Create: `config/default.yml`
- Modify: `README.md`

- [ ] **Step 1: QMD 레포 포크**

```bash
gh repo fork tobi/qmd --clone --fork-name hwicortex
cd hwicortex
```

- [ ] **Step 2: QMD 구조 탐색**

QMD 소스를 읽고 아래를 파악:
- core/indexer 문서 스키마 구조
- core/search 검색 파이프라인
- core/collection 컬렉션 관리 구조
- core/store SQLite 스키마
- CLI 명령어 등록 방식
- MCP 도구 등록 방식
- `hwicortex mcp` 명령어가 기존 QMD에 이미 있는지 확인

결과를 `docs/qmd-structure.md`로 정리. **이 결과에 따라 Phase 1~3의 정확한 파일 경로를 확정하고 이 계획을 업데이트한다.**

- [ ] **Step 3: 의존성 추가**

```bash
bun add pdfjs-dist chokidar @anthropic-ai/sdk yaml
bun add -d @types/node
```

- [ ] **Step 4: package.json 수정**

```json
{
  "name": "hwicortex",
  "bin": {
    "hwicortex": "./src/cli/index.ts"
  }
}
```

- [ ] **Step 5: 기본 설정 파일 생성**

Create `config/default.yml`:

```yaml
vault:
  path: ~/hwicortex-vault

sessions:
  watch_dirs:
    - ~/.claude/projects
    - ~/.codex/sessions
  idle_timeout_minutes: 10

llm:
  default: claude
  claude:
    api_key: ${ANTHROPIC_API_KEY}
    model: claude-sonnet-4-6
  local:
    model_path: ~/.hwicortex/models/default.gguf
  budget:
    max_tokens_per_run: 500000
    warn_threshold: 100000

ingest:
  collections: []
```

- [ ] **Step 6: 커밋**

```bash
git add package.json config/ README.md src/ bun.lockb
git commit -m "chore: fork QMD as HwiCortex, add dependencies and default config"
```

### Task 0.5: Config 로더

**Files:**
- Create: `src/config/config-loader.ts`
- Create: `tests/config/config-loader.test.ts`

- [ ] **Step 1: 테스트 작성**

```typescript
import { describe, it, expect } from "bun:test";
import { loadConfig } from "../../src/config/config-loader";

describe("ConfigLoader", () => {
  it("should load YAML config file", () => {
    const config = loadConfig("config/default.yml");
    expect(config.vault.path).toBeDefined();
    expect(config.llm.default).toBe("claude");
  });

  it("should substitute environment variables", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const config = loadConfig("config/default.yml");
    expect(config.llm.claude.api_key).toBe("test-key");
  });

  it("should throw on missing required fields", () => {
    expect(() => loadConfig("tests/fixtures/invalid-config.yml")).toThrow();
  });

  it("should merge user config with defaults", () => {
    const config = loadConfig("config/default.yml", "tests/fixtures/user-config.yml");
    // user config 값이 default를 오버라이드
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**
- [ ] **Step 3: ConfigLoader 구현**

```typescript
// src/config/config-loader.ts
import { parse as parseYaml } from "yaml";
import { readFileSync } from "fs";

export interface HwiCortexConfig {
  vault: { path: string };
  sessions: { watch_dirs: string[]; idle_timeout_minutes: number };
  llm: {
    default: "claude" | "local";
    claude: { api_key: string; model: string };
    local: { model_path: string };
    budget: { max_tokens_per_run: number; warn_threshold: number };
  };
  ingest: { collections: Array<{ name: string; path: string; pattern: string }> };
}

export function loadConfig(defaultPath: string, userPath?: string): HwiCortexConfig {
  // 1. YAML 파싱
  // 2. ${ENV_VAR} 패턴 치환
  // 3. 필수 필드 검증 (vault.path, llm.default)
  // 4. userPath 있으면 deep merge
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**
- [ ] **Step 5: 커밋**

```bash
git commit -am "feat(config): implement config loader with env var substitution and validation"
```

---

## Phase 1: 코어 수정

### Task 1: SQLite 스키마 확장 + schema_version + 마이그레이션 러너

**Files:**
- Modify: `src/core/store/` (QMD 탐색 후 정확한 파일 결정)
- Create: `tests/core/schema.test.ts`
- Create: `tests/core/migration.test.ts`

- [ ] **Step 1: 테스트 작성 — schema_version 테이블 + 마이그레이션**

```typescript
import { describe, it, expect } from "bun:test";

describe("schema_version", () => {
  it("should have schema_version table after init", () => {
    // store 초기화 후 schema_version 테이블 존재 확인
    // SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'
  });

  it("should return current version", () => {
    // version이 1 이상의 정수
  });
});

describe("migration runner", () => {
  it("should run pending migrations in order", () => {
    // version 0 → migration_v1 실행 → version 1
  });

  it("should skip already applied migrations", () => {
    // version이 이미 1이면 migration_v1 스킵
  });

  it("should backup DB before migration", () => {
    // 마이그레이션 전 .db.bak 파일 생성 확인
  });

  it("should rollback on migration failure", () => {
    // 실패 시 원래 version 유지
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

```bash
bun test tests/core/schema.test.ts tests/core/migration.test.ts
```

- [ ] **Step 3: store에 schema_version + 마이그레이션 러너 구현**

```sql
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO schema_version (version) VALUES (1);
```

마이그레이션 러너:
```typescript
// 마이그레이션 배열에서 현재 version 이후의 것만 실행
// 실행 전 DB 파일 백업 (.bak)
// 각 마이그레이션은 트랜잭션 내에서 실행
// 실패 시 트랜잭션 롤백 + 에러 보고
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

- [ ] **Step 5: 커밋**

```bash
git commit -am "feat(core): add schema_version table and migration runner"
```

### Task 2: 인덱서 메타 필드 확장

**Files:**
- Modify: `src/core/indexer/` (QMD 탐색 후 정확한 파일 결정)
- Create: `tests/core/indexer-meta.test.ts`

- [ ] **Step 1: 테스트 작성 — 메타 필드 포함 인덱싱**

```typescript
describe("indexer meta fields", () => {
  it("should index document with source_type field", () => {
    // source_type: "docs" | "sessions" | "knowledge"
  });

  it("should index document with project field", () => {
    // project: "bb3-client"
  });

  it("should index document with tags array", () => {
    // tags: ["popup", "bugfix"]
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

- [ ] **Step 3: indexer에 source_type, project, tags 메타 필드 추가**

QMD의 문서 인덱싱 스키마에 필드 추가. 정확한 구현은 QMD 구조 탐색 후 결정.

- [ ] **Step 4: 테스트 실행 → 통과 확인**

- [ ] **Step 5: 커밋**

```bash
git commit -am "feat(core): add source_type, project, tags meta fields to indexer"
```

### Task 3: 검색 필터 추가

**Files:**
- Modify: `src/core/search/` (QMD 탐색 후 정확한 파일 결정)
- Create: `tests/core/search-filter.test.ts`

- [ ] **Step 1: 테스트 작성 — source_type 필터 검색**

```typescript
describe("search with source_type filter", () => {
  it("should filter results by source_type=knowledge", () => {
    // 인덱싱: docs 1개, knowledge 1개
    // search("keyword", { source: "knowledge" })
    // 결과: knowledge만 반환
  });

  it("should return all when no filter", () => {
    // 필터 없으면 전체 반환
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

- [ ] **Step 3: search에 source 필터 옵션 추가**

검색 쿼리에 WHERE 조건 추가:
```sql
WHERE source_type = ? -- source 파라미터가 있을 때만
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

- [ ] **Step 5: 커밋**

```bash
git commit -am "feat(core): add source_type filter to search"
```

### Task 3.5: 동적 컬렉션 타입

**Files:**
- Modify: `src/core/collection/` (QMD 탐색 후 정확한 파일 결정)
- Create: `tests/core/dynamic-collection.test.ts`

설계 문서 하드포크 근거 1번: "감시 → 자동 수집 → 파싱 → 추출하는 동적 컬렉션 타입"

- [ ] **Step 1: 테스트 작성**

```typescript
describe("dynamic collection", () => {
  it("should register a session collection with watch capability", () => {
    // type: "session" 컬렉션 등록
    // watchDirs, parser 설정 포함
  });

  it("should distinguish static (docs) from dynamic (session) collections", () => {
    // static: 수동 ingest로만 업데이트
    // dynamic: watcher가 자동으로 업데이트
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**
- [ ] **Step 3: core/collection에 동적 컬렉션 타입 추가**
- [ ] **Step 4: 테스트 실행 → 통과 확인**
- [ ] **Step 5: 커밋**

```bash
git commit -am "feat(core): add dynamic collection type for session watching"
```

---

## Phase 2: 상태 관리 + 입력 처리

### Task 4: State Manager

**Files:**
- Create: `src/state/state-manager.ts`
- Create: `tests/state/state-manager.test.ts`

- [ ] **Step 1: 테스트 작성**

```typescript
import { describe, it, expect, beforeEach } from "bun:test";
import { StateManager } from "../src/state/state-manager";

describe("StateManager", () => {
  let manager: StateManager;

  beforeEach(() => {
    manager = new StateManager(tempStatePath);
  });

  it("should initialize empty state file", () => {
    const state = manager.load();
    expect(state.lastProcessedAt).toBeNull();
    expect(state.failedQueue).toEqual([]);
  });

  it("should record last processed session", () => {
    manager.markProcessed("session-abc123", "2026-04-06T10:00:00Z");
    const state = manager.load();
    expect(state.lastProcessedAt).toBe("2026-04-06T10:00:00Z");
    expect(state.processedSessions).toContain("session-abc123");
  });

  it("should add to failed queue", () => {
    manager.addToFailedQueue("session-xyz", "Parse error: unknown field");
    const state = manager.load();
    expect(state.failedQueue).toHaveLength(1);
    expect(state.failedQueue[0].sessionId).toBe("session-xyz");
    expect(state.failedQueue[0].error).toContain("Parse error");
  });

  it("should remove from failed queue after retry success", () => {
    manager.addToFailedQueue("session-xyz", "error");
    manager.markProcessed("session-xyz", "2026-04-06T11:00:00Z");
    const state = manager.load();
    expect(state.failedQueue).toHaveLength(0);
  });

  it("should return unprocessed sessions from a list", () => {
    manager.markProcessed("session-a", "2026-04-06T10:00:00Z");
    const unprocessed = manager.filterUnprocessed(["session-a", "session-b", "session-c"]);
    expect(unprocessed).toEqual(["session-b", "session-c"]);
  });

  it("should persist state across reloads", () => {
    manager.markProcessed("session-a", "2026-04-06T10:00:00Z");
    const manager2 = new StateManager(tempStatePath);
    const state = manager2.load();
    expect(state.processedSessions).toContain("session-a");
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**
- [ ] **Step 3: StateManager 구현**

```typescript
// src/state/state-manager.ts
export interface AppState {
  lastProcessedAt: string | null;
  processedSessions: string[];
  failedQueue: Array<{ sessionId: string; error: string; failedAt: string }>;
  watcherRunning: boolean;
}

export class StateManager {
  constructor(private statePath: string) {}
  load(): AppState { /* JSON 파일 읽기, 없으면 초기값 */ }
  save(state: AppState): void { /* atomic write */ }
  markProcessed(sessionId: string, timestamp: string): void { /* ... */ }
  addToFailedQueue(sessionId: string, error: string): void { /* ... */ }
  filterUnprocessed(sessionIds: string[]): string[] { /* ... */ }
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**
- [ ] **Step 5: 커밋**

```bash
git commit -am "feat(state): implement state manager for processing history and failed queue"
```

### Task 5: 세션 파서 — 공통 인터페이스

**Files:**
- Create: `src/ingest/session-parser/types.ts`

- [ ] **Step 1: 타입 정의**

```typescript
// src/ingest/session-parser/types.ts

export interface ParsedMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  timestamp?: string;
}

export interface ParsedSession {
  sessionId: string;
  project: string;
  startTime: string;
  endTime: string;
  parserVersion: string;
  messages: ParsedMessage[];
}

export interface SessionParser {
  readonly name: string;
  readonly parserVersion: string;
  canParse(filePath: string): boolean;
  parse(filePath: string): Promise<ParsedSession>;
  validateSchema(filePath: string): Promise<{ valid: boolean; errors: string[] }>;
}
```

- [ ] **Step 2: 타입 테스트 (컴파일 확인)**

```bash
bunx tsc --noEmit src/ingest/session-parser/types.ts
```

- [ ] **Step 3: 커밋**

```bash
git add src/ingest/session-parser/types.ts
git commit -m "feat(ingest): define session parser interface and types"
```

### Task 6: Claude Code 세션 파서

**Files:**
- Create: `src/ingest/session-parser/claude.ts`
- Create: `tests/fixtures/sessions/claude-sample.jsonl`
- Create: `tests/fixtures/sessions/invalid.jsonl`
- Create: `tests/fixtures/sessions/corrupted.jsonl`
- Create: `tests/ingest/claude-parser.test.ts`

- [ ] **Step 1: fixture 생성**

실제 Claude Code 세션 JSONL에서 샘플 추출하여 `tests/fixtures/sessions/claude-sample.jsonl` 생성.

주의: 실제 JSONL 스키마는 `~/.claude/projects/` 내 파일을 확인하여 정확히 매칭해야 함.

- [ ] **Step 2: 테스트 작성**

```typescript
import { describe, it, expect } from "bun:test";
import { ClaudeSessionParser } from "../../src/ingest/session-parser/claude";

describe("ClaudeSessionParser", () => {
  const parser = new ClaudeSessionParser();

  it("should identify Claude Code JSONL files", () => {
    expect(parser.canParse("tests/fixtures/sessions/claude-sample.jsonl")).toBe(true);
    expect(parser.canParse("random.txt")).toBe(false);
  });

  it("should parse session into structured messages", async () => {
    const session = await parser.parse("tests/fixtures/sessions/claude-sample.jsonl");
    expect(session.messages.length).toBeGreaterThan(0);
    expect(session.messages[0].role).toBe("user");
    expect(session.messages[1].role).toBe("assistant");
  });

  it("should collapse tool_use/tool_result into tool role", async () => {
    const session = await parser.parse("tests/fixtures/sessions/claude-sample.jsonl");
    const toolMessages = session.messages.filter(m => m.role === "tool");
    expect(toolMessages.length).toBeGreaterThan(0);
  });

  it("should extract session metadata", async () => {
    const session = await parser.parse("tests/fixtures/sessions/claude-sample.jsonl");
    expect(session.sessionId).toBeDefined();
    expect(session.startTime).toBeDefined();
    expect(session.endTime).toBeDefined();
    expect(session.parserVersion).toBe(parser.parserVersion);
  });

  it("should handle schema validation", async () => {
    const result = await parser.validateSchema("tests/fixtures/sessions/claude-sample.jsonl");
    expect(result.valid).toBe(true);
  });

  it("should return validation errors for unknown schema", async () => {
    const result = await parser.validateSchema("tests/fixtures/sessions/invalid.jsonl");
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("should gracefully handle parse failure with error details", async () => {
    // 손상된 JSONL (일부 라인이 유효하지 않은 JSON)
    await expect(parser.parse("tests/fixtures/sessions/corrupted.jsonl"))
      .rejects.toThrow(/parse/i);
  });
});
```

- [ ] **Step 3: 테스트 실행 → 실패 확인**

```bash
bun test tests/ingest/claude-parser.test.ts
```

- [ ] **Step 4: ClaudeSessionParser 구현**

```typescript
// src/ingest/session-parser/claude.ts
import { SessionParser, ParsedSession, ParsedMessage } from "./types";
import { readFileSync } from "fs";

export class ClaudeSessionParser implements SessionParser {
  readonly name = "claude-code";
  readonly parserVersion = "1.0.0";

  canParse(filePath: string): boolean {
    return filePath.endsWith(".jsonl") && filePath.includes(".claude");
  }

  async validateSchema(filePath: string): Promise<{ valid: boolean; errors: string[] }> {
    // JSONL 각 라인의 필수 필드 존재 여부 확인
    // type, message 또는 content 필드 필수
    // 알 수 없는 type 값 경고
  }

  async parse(filePath: string): Promise<ParsedSession> {
    const lines = readFileSync(filePath, "utf-8").split("\n").filter(Boolean);
    const messages: ParsedMessage[] = [];

    for (const line of lines) {
      const entry = JSON.parse(line);
      // type별 역할 매핑: human→user, assistant→assistant, tool_use/tool_result→tool
      // tool 엔트리는 <details> 블록으로 감싸서 content에 포함
    }

    return {
      sessionId: /* 파일명 또는 해시에서 추출 */,
      project: /* 파일 경로에서 프로젝트명 추출 */,
      startTime: /* 첫 메시지 timestamp */,
      endTime: /* 마지막 메시지 timestamp */,
      parserVersion: this.parserVersion,
      messages,
    };
  }
}
```

정확한 JSONL 필드명은 실제 파일을 확인하여 맞춰야 함.

- [ ] **Step 5: 테스트 실행 → 통과 확인**

```bash
bun test tests/ingest/claude-parser.test.ts
```

- [ ] **Step 6: 커밋**

```bash
git add src/ingest/session-parser/claude.ts tests/
git commit -m "feat(ingest): implement Claude Code session parser"
```

### Task 7: Codex CLI 세션 파서

**Files:**
- Create: `src/ingest/session-parser/codex.ts`
- Create: `tests/fixtures/sessions/codex-sample.jsonl`
- Create: `tests/ingest/codex-parser.test.ts`

Task 6과 동일한 TDD 패턴. Codex CLI JSONL 스키마에 맞춰 구현.

- [ ] **Step 1: fixture 생성** — `~/.codex/sessions/` 내 실제 파일 확인 후 샘플 생성
- [ ] **Step 2: 테스트 작성** — Task 6과 동일 구조 (정상 파싱 + 스키마 검증 + 실패 처리)
- [ ] **Step 3: 테스트 실행 → 실패 확인**
- [ ] **Step 4: CodexSessionParser 구현**
- [ ] **Step 5: 테스트 실행 → 통과 확인**
- [ ] **Step 6: 커밋**

```bash
git commit -am "feat(ingest): implement Codex CLI session parser"
```

### Task 7.5: Gemini CLI 파서 스텁

**Files:**
- Create: `src/ingest/session-parser/gemini.ts`

설계 문서: "Gemini CLI는 파서 인터페이스만 정의, 구현은 후순위"

- [ ] **Step 1: 스텁 생성**

```typescript
// src/ingest/session-parser/gemini.ts
import { SessionParser, ParsedSession } from "./types";

export class GeminiSessionParser implements SessionParser {
  readonly name = "gemini-cli";
  readonly parserVersion = "0.0.0";

  canParse(filePath: string): boolean {
    return filePath.endsWith(".json") && filePath.includes(".gemini");
  }

  async validateSchema(): Promise<{ valid: boolean; errors: string[] }> {
    return { valid: false, errors: ["Gemini CLI parser not yet implemented"] };
  }

  async parse(): Promise<ParsedSession> {
    throw new Error("Gemini CLI parser not yet implemented. Contributions welcome.");
  }
}
```

- [ ] **Step 2: 커밋**

```bash
git commit -am "feat(ingest): add Gemini CLI parser stub (not implemented)"
```

### Task 8: PDF 파서

**Files:**
- Create: `src/ingest/pdf-parser.ts`
- Create: `tests/fixtures/pdfs/simple.pdf`
- Create: `tests/fixtures/pdfs/broken.pdf`
- Create: `tests/ingest/pdf-parser.test.ts`

- [ ] **Step 1: fixture 생성**

테스트용 PDF 파일 준비:
- `simple.pdf`: 텍스트만 포함된 간단한 PDF
- `broken.pdf`: 손상된 PDF (0바이트 또는 잘못된 헤더)

- [ ] **Step 2: 테스트 작성**

```typescript
import { describe, it, expect } from "bun:test";
import { PdfParser } from "../src/ingest/pdf-parser";

describe("PdfParser", () => {
  const parser = new PdfParser();

  it("should extract text from simple PDF", async () => {
    const result = await parser.parse("tests/fixtures/pdfs/simple.pdf");
    expect(result.content).toContain("expected text");
    expect(result.frontmatter.source_path).toBe("tests/fixtures/pdfs/simple.pdf");
  });

  it("should return error for broken PDF", async () => {
    const result = await parser.parse("tests/fixtures/pdfs/broken.pdf");
    expect(result.error).toBeDefined();
  });

  it("should generate markdown with frontmatter", async () => {
    const result = await parser.parse("tests/fixtures/pdfs/simple.pdf");
    expect(result.markdown).toMatch(/^---\n/);
    expect(result.markdown).toContain("source_path:");
  });

  it("should record error to _errors.md format", async () => {
    const result = await parser.parse("tests/fixtures/pdfs/broken.pdf");
    expect(result.error).toBeDefined();
    expect(result.errorEntry).toContain("broken.pdf");
    // vault-writer가 이 errorEntry를 vault/docs/_errors.md에 append
  });
});
```

- [ ] **Step 3: 테스트 실행 → 실패 확인**
- [ ] **Step 4: PdfParser 구현**

```typescript
// src/ingest/pdf-parser.ts
import { getDocument } from "pdfjs-dist";

export interface PdfParseResult {
  content: string;
  markdown: string;
  frontmatter: { source_path: string; pages: number; parsed_at: string };
  error?: string;
  errorEntry?: string;  // _errors.md에 추가할 라인
}

export class PdfParser {
  async parse(filePath: string): Promise<PdfParseResult> {
    try {
      const doc = await getDocument(filePath).promise;
      let text = "";
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map((item: any) => item.str).join(" ") + "\n\n";
      }
      const frontmatter = {
        source_path: filePath,
        pages: doc.numPages,
        parsed_at: new Date().toISOString(),
      };
      const markdown = `---\n${Object.entries(frontmatter).map(([k,v]) => `${k}: ${v}`).join("\n")}\n---\n\n${text}`;
      return { content: text, markdown, frontmatter };
    } catch (e) {
      const error = String(e);
      return {
        content: "", markdown: "",
        frontmatter: { source_path: filePath, pages: 0, parsed_at: "" },
        error,
        errorEntry: `- ${new Date().toISOString()} | ${filePath} | ${error}`,
      };
    }
  }
}
```

- [ ] **Step 5: 테스트 실행 → 통과 확인**
- [ ] **Step 6: 커밋**

```bash
git commit -am "feat(ingest): implement PDF parser with error reporting"
```

### Task 9: 세션 → 마크다운 변환기

**Files:**
- Create: `src/ingest/session-to-markdown.ts`
- Create: `tests/ingest/session-to-markdown.test.ts`

ParsedSession을 Obsidian 호환 마크다운으로 변환하는 모듈. vault-writer의 `writeSession()`이 이 모듈의 출력을 소비한다.

- [ ] **Step 1: 테스트 작성**

```typescript
describe("sessionToMarkdown", () => {
  it("should generate markdown with frontmatter", () => {
    const session: ParsedSession = { /* fixture */ };
    const md = sessionToMarkdown(session);
    expect(md).toMatch(/^---\n/);
    expect(md).toContain("session_id:");
    expect(md).toContain("project:");
    expect(md).toContain("parser_version:");
  });

  it("should format tool messages as collapsed details", () => {
    const md = sessionToMarkdown(sessionWithTools);
    expect(md).toContain("<details>");
  });

  it("should separate user and assistant messages clearly", () => {
    const md = sessionToMarkdown(session);
    expect(md).toContain("### User");
    expect(md).toContain("### Assistant");
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**
- [ ] **Step 3: sessionToMarkdown 구현**
- [ ] **Step 4: 테스트 실행 → 통과 확인**
- [ ] **Step 5: 커밋**

```bash
git commit -am "feat(ingest): implement session to markdown converter"
```

---

## Phase 3: 지식 추출 (knowledge/)

### Task 10: LLM Provider 인터페이스

**Files:**
- Create: `src/knowledge/llm-provider.ts`
- Create: `tests/knowledge/llm-provider.test.ts`

- [ ] **Step 1: 테스트 작성**

```typescript
describe("LlmProvider", () => {
  it("should create Claude provider from config", () => {
    const provider = createLlmProvider({ default: "claude", claude: { api_key: "test", model: "claude-sonnet-4-6" } });
    expect(provider.name).toBe("claude");
  });

  it("should create local provider from config", () => {
    const provider = createLlmProvider({ default: "local", local: { model_path: "/path/to/model.gguf" } });
    expect(provider.name).toBe("local");
  });

  it("should have common complete() interface", async () => {
    const provider = createMockProvider();
    const result = await provider.complete("test prompt");
    expect(result).toBeDefined();
    expect(typeof result).toBe("string");
  });

  it("should retry on transient API failure (3 attempts, exponential backoff)", async () => {
    let attempts = 0;
    const flakyProvider = createFlakyMockProvider(() => {
      attempts++;
      if (attempts < 3) throw new Error("rate_limit");
      return "success";
    });
    const result = await flakyProvider.complete("test");
    expect(result).toBe("success");
    expect(attempts).toBe(3);
  });

  it("should throw after max retries exceeded", async () => {
    const alwaysFailProvider = createFlakyMockProvider(() => {
      throw new Error("rate_limit");
    });
    await expect(alwaysFailProvider.complete("test")).rejects.toThrow("rate_limit");
  });

  it("should not retry on non-transient errors", async () => {
    let attempts = 0;
    const provider = createFlakyMockProvider(() => {
      attempts++;
      throw new Error("invalid_api_key");
    });
    await expect(provider.complete("test")).rejects.toThrow("invalid_api_key");
    expect(attempts).toBe(1); // 재시도 없이 즉시 실패
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**
- [ ] **Step 3: LlmProvider 구현 (재시도 로직 포함)**

```typescript
// src/knowledge/llm-provider.ts

export interface LlmProvider {
  readonly name: string;
  complete(prompt: string, options?: { maxTokens?: number }): Promise<string>;
  estimateTokens(text: string): number;
}

const TRANSIENT_ERRORS = ["rate_limit", "overloaded", "timeout", "ECONNRESET"];
const MAX_RETRIES = 3;

class ClaudeProvider implements LlmProvider {
  readonly name = "claude";

  async complete(prompt: string, options?: { maxTokens?: number }): Promise<string> {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await this.client.messages.create({ ... });
        return response.content[0].type === "text" ? response.content[0].text : "";
      } catch (e) {
        const isTransient = TRANSIENT_ERRORS.some(t => String(e).includes(t));
        if (!isTransient || attempt === MAX_RETRIES) throw e;
        await sleep(Math.pow(2, attempt) * 1000); // exponential backoff
      }
    }
    throw new Error("unreachable");
  }

  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**
- [ ] **Step 5: 커밋**

```bash
git commit -am "feat(knowledge): implement LLM provider with retry and exponential backoff"
```

### Task 11: 지식 추출기 (extractor)

**Files:**
- Create: `src/knowledge/extractor.ts`
- Create: `tests/knowledge/extractor.test.ts`

- [ ] **Step 1: 테스트 작성**

```typescript
describe("KnowledgeExtractor", () => {
  const mockProvider: LlmProvider = {
    name: "mock",
    complete: async () => JSON.stringify({
      title: "팝업 중복 방지",
      summary: "isDuplicate 파라미터를 사용하면 된다",
      keyInsights: ["isDuplicate 파라미터 사용", "IsOpenOrInitializing() 확인"],
      tags: ["popup", "bugfix"],
      relatedTopics: ["PopupManager"],
    }),
    estimateTokens: (t) => t.length / 4,
  };

  it("should extract structured knowledge from session markdown", async () => {
    const extractor = new KnowledgeExtractor(mockProvider);
    const result = await extractor.extract(sampleSessionMarkdown);
    expect(result.title).toBe("팝업 중복 방지");
    expect(result.keyInsights).toHaveLength(2);
    expect(result.tags).toContain("popup");
  });

  it("should chunk large sessions before extraction", async () => {
    const extractor = new KnowledgeExtractor(mockProvider, { maxTokens: 100 });
    const largeSession = "x".repeat(1000);
    const result = await extractor.extract(largeSession);
    expect(result).toBeDefined();
  });

  it("should summarize tool calls to save tokens", async () => {
    const sessionWithTools = "### Tool\n<details>...long output...</details>\n".repeat(50);
    const extractor = new KnowledgeExtractor(mockProvider);
    const processed = extractor.preprocessSession(sessionWithTools);
    expect(processed.length).toBeLessThan(sessionWithTools.length);
  });

  it("should handle LLM returning invalid JSON gracefully", async () => {
    const badProvider = { ...mockProvider, complete: async () => "not json" };
    const extractor = new KnowledgeExtractor(badProvider);
    await expect(extractor.extract("session")).rejects.toThrow(/JSON/i);
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**
- [ ] **Step 3: KnowledgeExtractor 구현**

핵심 로직:
1. 세션 전처리: 도구 호출 요약 처리
2. 토큰 추정 → 임계값 초과 시 청킹
3. LLM에 추출 프롬프트 전송
4. JSON 응답 파싱 → ExtractedKnowledge 반환
5. JSON 파싱 실패 시 명확한 에러

- [ ] **Step 4: 테스트 실행 → 통과 확인**
- [ ] **Step 5: 커밋**

```bash
git commit -am "feat(knowledge): implement knowledge extractor with chunking and error handling"
```

### Task 12: 분류기 (classifier)

**Files:**
- Create: `src/knowledge/classifier.ts`
- Create: `tests/knowledge/classifier.test.ts`

- [ ] **Step 1: 테스트 작성**

```typescript
describe("Classifier", () => {
  it("should determine project folder from session project field", () => {
    const result = classify({ project: "bb3-client", tags: ["popup"] });
    expect(result.folder).toBe("bb3-client");
  });

  it("should generate file name from title", () => {
    const result = classify({ title: "팝업 중복 방지", project: "bb3-client" });
    expect(result.fileName).toMatch(/\.md$/);
  });

  it("should assign tags from extracted knowledge", () => {
    const result = classify({ tags: ["popup", "bugfix"] });
    expect(result.tags).toEqual(["popup", "bugfix"]);
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**
- [ ] **Step 3: Classifier 구현**
- [ ] **Step 4: 테스트 실행 → 통과 확인**
- [ ] **Step 5: 커밋**

```bash
git commit -am "feat(knowledge): implement knowledge classifier"
```

### Task 13: 볼트 라이터 (vault-writer)

**Files:**
- Create: `src/knowledge/vault-writer.ts`
- Create: `tests/knowledge/vault-writer.test.ts`

- [ ] **Step 1: 테스트 작성**

```typescript
describe("VaultWriter", () => {
  it("should create new knowledge file with structured format", async () => {
    const writer = new VaultWriter(tempVaultPath);
    await writer.writeKnowledge({
      title: "팝업 중복 방지",
      project: "bb3-client",
      tags: ["popup"],
      summary: "요약 내용",
      keyInsights: [{ date: "2026-04-06", sessionId: "abc123", content: "인사이트" }],
      sourceSession: "sessions/bb3-client/2026-04-06-abc123.md",
    });

    const file = readFileSync(`${tempVaultPath}/knowledge/bb3-client/popup-duplicate-fix.md`, "utf-8");
    expect(file).toContain("title: 팝업 중복 방지");
    expect(file).toContain("## 인사이트");
    expect(file).toContain("abc123");
  });

  it("should append to existing knowledge file without overwriting", async () => {
    await writer.writeKnowledge(knowledge1);
    await writer.writeKnowledge(knowledge2);

    const file = readFileSync(filePath, "utf-8");
    expect(file).toContain("abc123");
    expect(file).toContain("def456");
  });

  it("should skip if source session already processed", async () => {
    await writer.writeKnowledge(knowledge1);
    await writer.writeKnowledge(knowledge1);

    const file = readFileSync(filePath, "utf-8");
    const sources = file.match(/abc123/g);
    expect(sources).toHaveLength(1);
  });

  it("should regenerate summary when insights >= 5", async () => {
    // 5개의 인사이트를 순차적으로 추가
    for (let i = 0; i < 5; i++) {
      await writer.writeKnowledge({ ...knowledge, sessionId: `session-${i}` });
    }
    // summary가 재생성 요청 플래그 또는 LLM 호출 발생 확인
  });

  it("should write session markdown to sessions/ folder", async () => {
    await writer.writeSession("bb3-client", "2026-04-06-abc123", sessionMarkdown);
    const file = readFileSync(`${tempVaultPath}/sessions/bb3-client/2026-04-06-abc123.md`, "utf-8");
    expect(file).toBe(sessionMarkdown);
  });

  it("should use atomic write (temp + rename)", async () => {
    // 쓰기 중 파일이 불완전한 상태로 노출되지 않는지 확인
  });

  it("should append PDF parse errors to vault/docs/_errors.md", async () => {
    await writer.appendError("- 2026-04-06 | broken.pdf | parse failed");
    const file = readFileSync(`${tempVaultPath}/docs/_errors.md`, "utf-8");
    expect(file).toContain("broken.pdf");
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**
- [ ] **Step 3: VaultWriter 구현**

핵심: 구조화된 포맷 생성, 기계적 append, 중복 스킵, 인사이트 5개 시 요약 재생성 트리거, atomic write, _errors.md 관리.

- [ ] **Step 4: 테스트 실행 → 통과 확인**
- [ ] **Step 5: 커밋**

```bash
git commit -am "feat(knowledge): implement vault writer with merge, summary regen, and atomic write"
```

---

## Phase 4: 세션 감시 (watcher)

### Task 14: 파일 감시 데몬

**Files:**
- Create: `src/ingest/watcher.ts`
- Create: `tests/ingest/watcher.test.ts`

- [ ] **Step 1: 테스트 작성**

```typescript
describe("SessionWatcher", () => {
  it("should detect new file in watch directory", async () => {
    const watcher = new SessionWatcher({ watchDirs: [tempDir], idleTimeoutMs: 500 });
    const events: string[] = [];
    watcher.on("session-ready", (path) => events.push(path));
    watcher.start();

    writeFileSync(`${tempDir}/test.jsonl`, "data");
    await sleep(1000);

    expect(events).toContain(`${tempDir}/test.jsonl`);
    watcher.stop();
  });

  it("should not trigger while file is still being written", async () => {
    const watcher = new SessionWatcher({ watchDirs: [tempDir], idleTimeoutMs: 500 });
    const events: string[] = [];
    watcher.on("session-ready", (path) => events.push(path));
    watcher.start();

    writeFileSync(`${tempDir}/test.jsonl`, "line1");
    await sleep(200);
    appendFileSync(`${tempDir}/test.jsonl`, "\nline2");
    await sleep(200);
    expect(events).toHaveLength(0);

    await sleep(500);
    expect(events).toHaveLength(1);
    watcher.stop();
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**
- [ ] **Step 3: SessionWatcher 구현 (chokidar 기반)**
- [ ] **Step 4: 테스트 실행 → 통과 확인**
- [ ] **Step 5: 커밋**

```bash
git commit -am "feat(ingest): implement session watcher with idle timeout detection"
```

---

## Phase 5: CLI 확장

### Task 15: `hwicortex ingest` 명령어

**Files:**
- Create: `src/cli/ingest.ts`
- Modify: QMD CLI 진입점 (명령어 등록)

- [ ] **Step 1: CLI 명령어 구현**

```typescript
// src/cli/ingest.ts
// 인자: <path> --name <name> --pattern <pattern>
// 동작:
// 1. config-loader로 설정 로드
// 2. 경로 스캔 (pattern 매칭)
// 3. PDF → pdf-parser → vault/docs/ 저장 (에러 시 _errors.md 기록)
// 4. MD → vault/docs/ 복사
// 5. core/indexer로 인덱싱 (source_type: "docs")
```

- [ ] **Step 2: 수동 테스트**

```bash
mkdir -p /tmp/test-docs && echo "# Test" > /tmp/test-docs/test.md
hwicortex ingest /tmp/test-docs --name "test" --pattern "*.md"
hwicortex search "Test"
```

- [ ] **Step 3: 커밋**

```bash
git commit -am "feat(cli): implement ingest command"
```

### Task 16: `hwicortex extract` 명령어 + 오케스트레이션 테스트

**Files:**
- Create: `src/cli/extract.ts`
- Create: `tests/cli/extract-pipeline.test.ts`

- [ ] **Step 1: 오케스트레이션 로직 테스트 작성**

```typescript
describe("extract pipeline", () => {
  it("should process unprocessed sessions only", async () => {
    // stateManager에 session-a 처리 완료 기록
    // session-a, session-b 제공
    // session-b만 처리되는지 확인
  });

  it("should respect budget.max_tokens_per_run", async () => {
    // 토큰 상한 1000으로 설정
    // 500 토큰 세션 3개 제공
    // 2개만 처리 후 중단
  });

  it("should record failures to state and continue", async () => {
    // 세션 2개 중 첫 번째가 파싱 실패
    // 두 번째는 정상 처리
    // stateManager에 첫 번째가 실패 큐에 기록
  });

  it("--dry-run should show stats without processing", async () => {
    // 실제 처리 없이 세션 수 + 예상 토큰 반환
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

- [ ] **Step 3: CLI 명령어 구현**

```typescript
// src/cli/extract.ts
// 옵션: --session <id>, --dry-run
// 동작:
// 1. config-loader로 설정 로드
// 2. state-manager에서 마지막 처리 시점 확인
// 3. 미처리 세션 목록 수집 (+ 실패 큐 재시도 대상)
// 4. --dry-run이면: 세션 수 + 예상 토큰 표시 후 종료
// 5. budget.warn_threshold 초과 시 확인 프롬프트
// 6. 세션별: parse → markdown → vault/sessions/ 저장 → extract → classify → vault/knowledge/ 저장
// 7. 인덱싱 (source_type: "sessions" + "knowledge")
// 8. state-manager 업데이트
// 9. 에러 시: state-manager 실패 큐에 기록, 다음 세션으로 계속
// 10. 토큰 상한 초과 시: 현재 세션 완료 후 중단
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

- [ ] **Step 5: 수동 E2E 확인**

```bash
hwicortex extract --dry-run
hwicortex extract
```

- [ ] **Step 6: 커밋**

```bash
git commit -am "feat(cli): implement extract command with pipeline tests and budget safety"
```

### Task 17: `hwicortex watch` 명령어

**Files:**
- Create: `src/cli/watch.ts`

- [ ] **Step 1: CLI 명령어 구현**

```typescript
// src/cli/watch.ts
// 동작:
// 1. config-loader로 설정 로드
// 2. SessionWatcher 시작 (config의 watch_dirs + idle_timeout)
// 3. session-ready 이벤트 → extract 파이프라인 실행
// 4. state-manager로 결과 기록
// 5. Ctrl+C로 종료
```

- [ ] **Step 2: 수동 테스트**

```bash
hwicortex watch
# 다른 터미널에서 Claude Code 세션 실행 후 종료 → 자동 추출 확인
```

- [ ] **Step 3: 커밋**

```bash
git commit -am "feat(cli): implement watch command for auto-extraction"
```

### Task 18: `hwicortex search` 명령어 확장

**Files:**
- Modify: QMD 기존 search CLI

- [ ] **Step 1: --source 및 --mode 플래그 추가**

```typescript
// 기존 QMD search에 옵션 추가:
// --mode bm25|hybrid (기본: hybrid)
// --source docs|sessions|knowledge (기본: 전체)
```

- [ ] **Step 2: 수동 테스트**

```bash
hwicortex search "팝업" --source knowledge
hwicortex search "API" --mode bm25
```

- [ ] **Step 3: 커밋**

```bash
git commit -am "feat(cli): extend search with --source and --mode flags"
```

### Task 19: `hwicortex rebuild` 명령어

**Files:**
- Create: `src/cli/rebuild.ts`

- [ ] **Step 1: 구현**

```typescript
// 볼트 전체를 스캔하여 인덱스 재빌드
// 1. 기존 SQLite DB 백업
// 2. 새 DB 생성
// 3. vault/docs/ → source_type: docs로 인덱싱
// 4. vault/sessions/ → source_type: sessions로 인덱싱
// 5. vault/knowledge/ → source_type: knowledge로 인덱싱
// 6. 성공 시 백업 삭제
```

- [ ] **Step 2: 수동 테스트**

```bash
hwicortex rebuild
hwicortex search "test"  # 인덱스 정상 확인
```

- [ ] **Step 3: 커밋**

```bash
git commit -am "feat(cli): implement rebuild command"
```

---

## Phase 6: MCP 확장

### Task 20: MCP 도구에 source 필터 추가

**Files:**
- Modify: QMD MCP 서버 (query 도구에 source 파라미터 추가)

- [ ] **Step 1: query 도구 스키마에 source 파라미터 추가**

```typescript
// MCP query 도구:
// 기존 파라미터: query (string)
// 추가 파라미터: source (string, optional, enum: ["docs", "sessions", "knowledge"])
```

- [ ] **Step 2: `hwicortex mcp` 명령어 확인/등록**

QMD에 이미 `qmd mcp` 명령어가 있다면 hwicortex로 리네임만. 없다면 새로 등록.

- [ ] **Step 3: 수동 테스트**

```bash
hwicortex mcp  # MCP 서버 시작
# Claude Code에서 MCP 통해 query 호출 테스트
```

- [ ] **Step 4: 커밋**

```bash
git commit -am "feat(mcp): add source filter to query tool"
```

---

## Phase 7: 통합 테스트

### Task 21: E2E 테스트

**Files:**
- Create: `tests/integration/e2e.test.ts`

- [ ] **Step 1: E2E 테스트 작성**

```typescript
describe("HwiCortex E2E", () => {
  // 임시 볼트 + 임시 세션 디렉토리로 전체 파이프라인 테스트

  it("ingest → search flow", async () => {
    // 1. 마크다운 문서 ingest
    // 2. search로 검색
    // 3. 결과 확인
  });

  it("extract → search knowledge flow", async () => {
    // 1. fixture 세션 파일 배치
    // 2. extract 실행 (mock LLM)
    // 3. vault/sessions/에 파싱된 마크다운 존재 확인
    // 4. vault/knowledge/에 추출된 지식 존재 확인
    // 5. search --source knowledge로 검색
  });

  it("rebuild restores index from vault", async () => {
    // 1. 인덱스 삭제
    // 2. rebuild 실행
    // 3. search 정상 동작 확인
  });

  it("extract handles failures gracefully", async () => {
    // 1. 정상 세션 1개 + 손상된 세션 1개 배치
    // 2. extract 실행
    // 3. 정상 세션은 처리 완료
    // 4. 손상된 세션은 실패 큐에 기록
    // 5. state.json 확인
  });
});
```

- [ ] **Step 2: 테스트 실행 → 통과 확인**

```bash
bun test tests/integration/e2e.test.ts
```

- [ ] **Step 3: 커밋**

```bash
git commit -am "test: add E2E integration tests"
```

---

## Phase 8: 문서화

### Task 22: README 및 사용 가이드

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README 작성**

내용:
- 프로젝트 소개
- 설치 방법 (`bun install -g hwicortex`)
- 빠른 시작 가이드 (ingest → search → extract → watch)
- config.yml 설정 가이드
- MCP 서버 설정 (Claude Code 연동)
- 에러 처리 및 실패 큐 관리
- 기여 가이드 (Gemini CLI 파서 등)

- [ ] **Step 2: 커밋**

```bash
git commit -am "docs: write README and usage guide"
```
