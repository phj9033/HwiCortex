# HwiCortex

[QMD](https://github.com/tobi/qmd) 하드포크 기반의 **AI 세션 지식 추출 + 문서 검색** 도구.

AI 에이전트(Claude Code, Codex CLI 등)와의 대화에서 생긴 지식을 자동 추출하고, 프로젝트 문서(마크다운, PDF, 코드)를 통합 검색할 수 있는 로컬 퍼스트 엔진이다. 추출된 지식은 Obsidian 볼트에 저장되어 탐색과 연결이 가능하다.

**핵심 가치:**
- AI와의 대화에서 얻은 지식이 휘발되지 않고 축적된다
- 프로젝트 문서를 AI가 직접 검색해서 활용한다
- Obsidian 볼트로 모든 지식을 탐색/연결할 수 있다

---

## 설치

```sh
# 소스에서 설치
git clone <repo-url>
cd hwicortex
bun install       # 또는: npm install
bun run build     # TypeScript → dist/ 컴파일
bun link          # 'hwicortex' 명령어를 글로벌로 등록
```

**시스템 요구사항:**
- Node.js >= 22.0.0 또는 Bun >= 1.0.0
- macOS: `brew install sqlite` (확장 지원용, 선택)

---

## 빠른 시작

HwiCortex는 두 가지 축으로 사용된다:
- **문서 검색** (QMD 기반): 프로젝트 폴더를 컬렉션으로 등록하고 하이브리드 검색
- **지식 추출** (HwiCortex 고유): AI 세션에서 인사이트를 자동 추출

### 문서 검색 (QMD)

```sh
# 1. 프로젝트 폴더를 컬렉션으로 등록
hwicortex collection add ~/work/my-project --name myproject
hwicortex collection add ~/work/docs --name docs --mask '**/*.md'

# 2. 인덱싱
hwicortex update

# 3. 컨텍스트 추가 (선택, 검색 품질 개선)
hwicortex context add qmd://myproject/ "Spring Boot 주문 관리 API 서버"

# 4. 검색
hwicortex query "주문 취소 로직이 어디에 있지?"    # 하이브리드 (추천)
hwicortex search "cancelOrder"                      # BM25 키워드 검색 (빠름)
hwicortex vsearch "에러 처리 패턴"                  # 벡터 유사도 검색

# 5. 문서 조회
hwicortex get "src/orders/cancel.ts"               # 경로로 조회
hwicortex get "#abc123"                             # 문서 ID로 조회
hwicortex multi-get "src/orders/*.ts"              # 여러 파일 조회

# 6. 벡터 임베딩 생성 (선택, 벡터 검색 활성화)
hwicortex pull                                      # 모델 다운로드
hwicortex embed                                     # 임베딩 생성
```

### 지식 추출 (HwiCortex)

프로젝트 루트에 `hwicortex.yaml` 설정 파일이 필요하다 (템플릿: `config/default.yml`).

```sh
# 1. 설정 파일 복사
cp config/default.yml hwicortex.yaml
# hwicortex.yaml을 프로젝트에 맞게 수정

# 2. 문서 등록 — 마크다운, PDF를 볼트에 인덱싱
hwicortex ingest ./docs --name "requirements" --pattern "*.md,*.pdf"

# 3. 지식 추출 — AI 세션에서 인사이트 추출
hwicortex extract --dry-run          # 예상 토큰 + 세션 수 미리 확인
hwicortex extract                    # 미처리 세션 일괄 추출

# 4. 감시 모드 — 세션 종료 시 자동 추출
hwicortex watch
```

---

## 다른 프로젝트에서 사용하기

HwiCortex를 다른 프로젝트에서 사용하는 방법은 세 가지다.

### 방법 1: CLI 도구로 사용

글로벌 설치 후 터미널 어디서든 사용한다.

```sh
# 글로벌 설치 (hwicortex 프로젝트 디렉토리에서)
cd hwicortex
bun install && bun run build && bun link

# 다른 프로젝트에서 컬렉션 등록 및 검색
cd ~/other-project
hwicortex collection add . --name other-project
hwicortex update
hwicortex query "인증 로직이 어떻게 동작하지?"
```

### 방법 2: SDK (라이브러리)로 사용

TypeScript/JavaScript 프로젝트에서 직접 import하여 프로그래밍 방식으로 사용한다.

```sh
# 다른 프로젝트에서 의존성 추가
cd ~/other-project

# 로컬 경로로 설치 (개발 중)
bun add /path/to/hwicortex

# 또는 npm에 publish 후
# bun add hwicortex
```

#### 기본 사용: 검색

```typescript
import { createStore } from "hwicortex";

const store = await createStore({
  dbPath: "./my-index.sqlite",
  config: {
    collections: {
      docs: { path: "./docs", pattern: "**/*.md" },
    },
  },
});

// 하이브리드 검색 (쿼리 확장 + BM25 + 벡터 + 리랭킹)
const results = await store.search({ query: "인증 흐름" });
for (const r of results) {
  console.log(`${r.file} (score: ${r.score})`);
}

// BM25 키워드 검색 (LLM 불필요, 빠름)
const lexResults = await store.searchLex("cancelOrder");

// 벡터 유사도 검색
const vecResults = await store.searchVector("에러 처리 패턴");

await store.close();
```

#### 컬렉션 & 인덱스 관리

```typescript
// 컬렉션 추가/삭제
await store.addCollection("notes", { path: "/path/to/notes", pattern: "**/*.md" });
await store.removeCollection("notes");
await store.renameCollection("notes", "my-notes");

// 컬렉션 목록 조회
const collections = await store.listCollections();
console.log(collections);

// 파일시스템 스캔으로 인덱스 업데이트
const updateResult = await store.update({
  onProgress: (info) => console.log(`[${info.collection}] ${info.file}`),
});
console.log(`indexed: ${updateResult.indexed}, updated: ${updateResult.updated}`);

// 벡터 임베딩 생성
const embedResult = await store.embed({
  onProgress: (info) => console.log(`embedding: ${info.current}/${info.total}`),
});
```

#### 문서 조회

```typescript
// 단일 문서 조회 (경로 또는 docid)
const doc = await store.get("src/auth/login.ts");
if (!("error" in doc)) {
  console.log(doc.title, doc.file);
}

// docid로 조회
const docById = await store.get("#abc123");

// 여러 문서 배치 조회
const { docs, errors } = await store.multiGet("src/auth/*.ts");
```

#### 컨텍스트 관리

```typescript
// 컬렉션에 컨텍스트 추가 (검색 품질 개선)
await store.addContext("docs", "/api", "REST API 엔드포인트 문서");
await store.setGlobalContext("Spring Boot 기반 주문 관리 시스템");

// 컨텍스트 목록 조회
const contexts = await store.listContexts();
```

#### 응용 예시: Slack 봇에 문서 검색 연동

```typescript
import { createStore } from "hwicortex";

const store = await createStore({
  dbPath: "./docs-index.sqlite",
  config: {
    collections: {
      wiki: { path: "./wiki", pattern: "**/*.md" },
      runbook: { path: "./runbook", pattern: "**/*.md" },
    },
  },
});

// 인덱스 업데이트 (앱 시작 시)
await store.update();

// Slack 이벤트 핸들러에서 검색
async function handleSlackQuestion(question: string): Promise<string> {
  const results = await store.search({ query: question, limit: 3 });

  if (results.length === 0) return "관련 문서를 찾지 못했습니다.";

  return results
    .map((r) => `- *${r.title ?? r.file}* (score: ${r.score.toFixed(2)})\n  ${r.snippet}`)
    .join("\n");
}
```

#### 응용 예시: CI에서 문서 품질 검사

```typescript
import { createStore } from "hwicortex";

const store = await createStore({
  dbPath: ":memory:",  // 임시 인메모리 DB
  config: {
    collections: {
      docs: { path: "./docs", pattern: "**/*.md" },
    },
  },
});

await store.update();
const status = await store.getStatus();

// 문서 수가 기준 미달이면 CI 실패
if (status.totalDocuments < 10) {
  console.error(`문서 수 부족: ${status.totalDocuments}개 (최소 10개 필요)`);
  process.exit(1);
}

// 빈 문서 확인
const health = await store.getIndexHealth();
console.log(`stale embeddings: ${health.staleEmbeddings}`);

await store.close();
```

#### 응용 예시: Express API에 검색 엔드포인트 추가

```typescript
import express from "express";
import { createStore, type QMDStore } from "hwicortex";

const app = express();
let store: QMDStore;

app.get("/api/search", async (req, res) => {
  const query = req.query.q as string;
  if (!query) return res.status(400).json({ error: "q parameter required" });

  const results = await store.search({
    query,
    limit: Number(req.query.limit) || 10,
    collection: req.query.collection as string | undefined,
  });

  res.json(results.map((r) => ({
    file: r.file,
    score: r.score,
    snippet: r.snippet,
  })));
});

// 서버 시작
store = await createStore({
  dbPath: "./search-index.sqlite",
  config: {
    collections: {
      docs: { path: "./docs", pattern: "**/*.md" },
      code: { path: "./src", pattern: "**/*.ts" },
    },
  },
});
await store.update();

app.listen(3000, () => console.log("Search API running on :3000"));
```

### 방법 3: MCP 서버로 연동

AI 에이전트(Claude Code, Cursor 등)가 직접 문서를 검색할 수 있다.

```sh
# stdio 모드 (AI 에이전트가 서브프로세스로 실행)
hwicortex mcp

# HTTP 모드
hwicortex mcp --http                    # localhost:8181
hwicortex mcp --http --port 8080        # 커스텀 포트
hwicortex mcp --http --daemon           # 백그라운드 데몬으로 실행
hwicortex mcp stop                      # 데몬 종료
```

Claude Code 연동 설정 (`~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "hwicortex": {
      "command": "hwicortex",
      "args": ["mcp"]
    }
  }
}
```

### 사용 방법 비교

| 방식 | 장점 | 사용 사례 |
|------|------|-----------|
| **CLI** (`bun link`) | 설치 간단, 즉시 사용 | 터미널에서 검색, 인덱싱, 지식 추출 |
| **SDK** (`import`) | 프로그래밍 제어, 타입 지원 | 앱에 검색 기능 통합, CI 스크립트 |
| **MCP 서버** | AI 도구와 직접 연동 | Claude Code, Cursor, IDE 플러그인 |

---

## 설정

HwiCortex는 두 개의 독립된 설정 체계를 사용한다:

| 설정 | 저장 위치 | 용도 |
|------|-----------|------|
| **QMD 컬렉션** | `~/.cache/qmd/index.sqlite` (DB 내부) | 문서 검색 컬렉션 관리 (`hwicortex collection add`로 등록) |
| **HwiCortex 프로젝트** | `./hwicortex.yaml` (프로젝트 루트) | 지식 추출, 세션 감시, LLM 설정 |

### hwicortex.yaml 설정 가이드

프로젝트 루트에 `hwicortex.yaml`을 생성한다 (템플릿: `config/default.yml`).

```yaml
# 볼트 경로 — Obsidian으로 열 수 있는 디렉토리
vault:
  path: ~/hwicortex-vault

# 세션 감시 설정
sessions:
  watch_dirs:
    - ~/.claude/projects        # Claude Code 세션
    - ~/.codex/sessions         # Codex CLI 세션
  idle_timeout_minutes: 10      # 세션 종료 판정 기준 (분)

# LLM 설정
llm:
  default: claude               # claude | local
  claude:
    api_key: ${ANTHROPIC_API_KEY}
    model: claude-sonnet-4-6
  local:
    model_path: ~/.hwicortex/models/default.gguf
  # 비용 안전장치
  budget:
    max_tokens_per_run: 500000  # extract 1회당 토큰 상한
    warn_threshold: 100000      # 이 이상이면 확인 프롬프트

# 문서 컬렉션 (ingest용)
ingest:
  collections:
    - name: "요구사항"
      path: ~/projects/specs
      pattern: "*.md,*.pdf"
```

### 주요 파일 위치

| 파일 | 경로 | 설명 |
|------|------|------|
| SQLite 인덱스 | `~/.cache/qmd/index.sqlite` | 검색 인덱스 DB (컬렉션 설정 포함) |
| LLM 모델 캐시 | `~/.cache/qmd/models/` | HuggingFace에서 다운로드된 모델 |
| HwiCortex 설정 | `./hwicortex.yaml` | 지식 추출/세션 감시 설정 (프로젝트별) |
| 설정 템플릿 | `config/default.yml` | 기본 설정 파일 템플릿 |
| 위키 저장소 | `vault/wiki/{project}/` | 프로젝트 디렉토리 내 |
| 글로벌 바이너리 | `which hwicortex`로 확인 | `bun link`가 생성한 심볼릭 링크 |

### 환경 변수

| 변수 | 설명 |
|------|------|
| `QMD_EMBED_MODEL` | 임베딩 모델 URI 오버라이드 |
| `QMD_RERANK_MODEL` | 리랭킹 모델 URI 오버라이드 |
| `QMD_GENERATE_MODEL` | 생성 모델 URI 오버라이드 |
| `QMD_EMBED_CONTEXT_SIZE` | 임베딩 컨텍스트 크기 (기본 2048) |
| `QMD_RERANK_CONTEXT_SIZE` | 리랭킹 컨텍스트 크기 (기본 4096) |
| `QMD_EDITOR_URI` | 에디터 URI 템플릿 (기본: `vscode://file/{path}:{line}:{col}`) |
| `ANTHROPIC_API_KEY` | Claude API 키 (지식 추출 시 필요) |
| `NO_COLOR` | 터미널 컬러 비활성화 |

---

## CLI 명령어 레퍼런스

### 문서 검색 (QMD 기반)

#### 컬렉션 관리

```sh
hwicortex collection add <path> --name <n> [--mask <glob>]  # 폴더 인덱싱
hwicortex collection list                                     # 전체 컬렉션 목록
hwicortex collection show <name>                              # 컬렉션 상세 정보
hwicortex collection remove <name>                            # 컬렉션 삭제
hwicortex collection rename <old> <new>                       # 컬렉션 이름 변경
hwicortex collection include <name>                           # 기본 검색 대상에 포함
hwicortex collection exclude <name>                           # 기본 검색 대상에서 제외
hwicortex collection update-cmd <name> <cmd>                  # 사전 업데이트 명령 설정
```

#### 검색

```sh
hwicortex query <query>                  # 하이브리드 검색 (확장 + BM25 + 벡터 + 리랭킹, 추천)
hwicortex search <query>                 # BM25 키워드 검색 (LLM 불필요, 빠름)
hwicortex vsearch <query>                # 벡터 유사도 검색

# 옵션
-c, --collection <name>            # 특정 컬렉션만 검색
-n <num>                           # 결과 수 제한
--all                              # 모든 결과 반환
--min-score <num>                  # 최소 점수 임계값
--full                             # 전체 문서 내용 포함
--no-rerank                        # 리랭킹 스킵 (빠름)
--chunk-strategy <auto|regex>      # 청킹 전략

# 출력 포맷
--json | --csv | --md | --xml | --files
```

#### 문서 조회

```sh
hwicortex get <file|#docid>              # 단일 문서 조회
hwicortex multi-get <pattern>            # 여러 문서 조회 (glob 또는 쉼표 구분)
hwicortex ls [collection[/path]]         # 인덱싱된 파일 목록
```

#### 컨텍스트 관리

```sh
hwicortex context add [path] "설명"      # 컨텍스트 추가 (기본: 현재 디렉토리)
hwicortex context add qmd://docs/ "설명" # 가상 경로로 추가
hwicortex context add / "전역 컨텍스트"  # 모든 컬렉션에 적용
hwicortex context list                   # 전체 컨텍스트 목록
hwicortex context check                  # 컨텍스트 없는 컬렉션/경로 확인
hwicortex context rm <path>              # 컨텍스트 삭제
```

#### 인덱스 관리

```sh
hwicortex status                         # 인덱스 상태 및 컬렉션 통계
hwicortex update [--pull]                # 전체 재인덱싱 (--pull: git pull 먼저)
hwicortex embed                          # 벡터 임베딩 생성/갱신
hwicortex pull                           # LLM 모델 다운로드
hwicortex cleanup                        # 캐시 정리 및 DB vacuum
```

#### 위키

```sh
hwicortex wiki create "제목" --project <name> --tags t1,t2 --body "내용"
hwicortex wiki update "제목" --project <name> --append "추가 내용"
hwicortex wiki list [--project <name>] [--tag <tag>]
hwicortex wiki show "제목" --project <name>
hwicortex wiki rm "제목" --project <name>
hwicortex wiki link "A" "B" --project <name>
hwicortex wiki unlink "A" "B" --project <name>
hwicortex wiki links "제목" --project <name>
hwicortex wiki index --project <name>
hwicortex wiki reset-importance --project <name> | --all [--all-counts]

# 위키 옵션
--no-count          # importance/hit count 추적 스킵 (스크립트/자동화용)
--auto-merge        # 생성 시 유사 페이지에 자동 병합 (MCP/SDK용)
--force             # 생성 시 유사도 검사 스킵
--all-counts        # reset-importance에서 hit_count까지 포함 초기화
```

위키 페이지는 `vault/wiki/{project}/`에 Obsidian 호환 마크다운으로 저장된다.
생성 시 유사한 기존 페이지가 있으면 자동 감지하여 병합을 제안한다.
검색(`search`/`query`) 결과에 위키 페이지가 포함되면 해당 페이지의 `hit_count`가 자동 증가하여 중요도를 추적한다.

### 지식 추출 (HwiCortex 고유)

> 아래 명령어들은 프로젝트 루트에 `hwicortex.yaml` 설정 파일이 필요하다.

#### `ingest` — 문서 등록 (볼트에 저장)

```sh
# 마크다운 + PDF 등록
hwicortex ingest ./specs --name "요구사항" --pattern "*.md,*.pdf"

# 마크다운만 등록
hwicortex ingest ./docs --name "기술문서" --pattern "*.md"
```

PDF는 `pdfjs-dist`로 텍스트 추출 후 마크다운으로 변환되어 볼트에 저장된다.

#### `extract` — 지식 추출

```sh
# 미처리 세션 일괄 추출
hwicortex extract

# 특정 세션만 추출
hwicortex extract --session <session-id>

# 드라이런 — 실행 전 예상 확인
hwicortex extract --dry-run
# 출력 예시: "미처리 세션 12개, 예상 토큰 ~320,000"
```

추출 결과는 `vault/knowledge/{project}/` 에 마크다운으로 저장된다.

#### `watch` — 감시 모드

```sh
# 세션 디렉토리 감시 데몬 시작
hwicortex watch
```

- `chokidar`로 세션 디렉토리를 감시
- 세션 종료 감지 시 자동으로 파싱 -> 인덱싱 -> 지식 추출 실행
- 종료 판정: `idle_timeout_minutes` (기본 10분) 동안 변경 없으면 종료로 간주

#### `rebuild` — 인덱스 재빌드

```sh
# 볼트 기준으로 SQLite 인덱스 전체 재빌드
hwicortex rebuild
```

Obsidian에서 직접 파일을 수정한 경우 인덱스를 동기화할 때 사용한다.

### 기타

```sh
hwicortex bench <fixture.json>           # 검색 품질 벤치마크 실행
hwicortex skill show                     # QMD 스킬 출력
hwicortex skill install [--global]       # Claude Code용 스킬 설치
```

---

## 볼트 구조

```
vault/
├── docs/                         ← 등록 문서 (ingest)
│   ├── requirements/
│   │   └── login-spec.md
│   └── technical/
│       └── api-guide.md
├── sessions/                     ← 파싱된 세션 로그
│   └── {project}/
│       └── {date}-{session-id}.md
├── knowledge/                    ← 추출된 지식
│   └── {project}/
│       ├── popup-duplicate-fix.md
│       └── unirx-message-pattern.md
├── wiki/                         ← 위키 페이지 (importance/hit_count 추적)
│   └── {project}/
│       └── {title}.md            — frontmatter에 importance, hit_count 등 메트릭 포함
└── .obsidian/                    ← Obsidian 설정 (HwiCortex 수정 안 함)
```

- Obsidian 볼트가 소스 오브 트루스, SQLite는 파생 인덱스
- HwiCortex는 `.obsidian/` 디렉토리를 절대 수정하지 않음

---

## 에러 처리

### 실패 큐 및 재시도 메커니즘

| 상황 | 동작 |
|------|------|
| LLM API 호출 실패 | 3회 재시도 (exponential backoff) -> 실패 시 `state.json` 실패 큐에 기록, 다음 실행 시 자동 재시도 |
| PDF 파싱 실패 | `vault/docs/_errors.md`에 에러 기록 + 원본 경로 보존, 스킵 후 계속 진행 |
| 세션 파싱 실패 | 원본 보존 + 경고 로그 + 실패 큐 기록. 스키마 변경 시 `parser_version` 불일치 경고 |
| 인덱싱 중단 | SQLite 트랜잭션으로 원자성 보장. 마지막 커밋 상태로 롤백 |
| 토큰 상한 초과 | 현재 세션까지 처리 후 중단. 나머지는 다음 실행으로 이연 |

### 대용량 세션 처리

50,000 토큰을 초과하는 세션은 자동으로 분할 처리된다:

1. 도구 호출 로그를 요약본으로 대체 (토큰 절감)
2. 남은 대화를 시간순 청크로 분할
3. 청크별 독립 추출 후 결과 병합

---

## 개발

### 개발 환경 설정

```sh
git clone <repo-url>
cd hwicortex
bun install
bun link                           # 'hwicortex' 명령어 등록
```

### 소스에서 실행

```sh
bun src/cli/qmd.ts <command>       # 빌드 없이 직접 실행
bun run build                      # TypeScript → dist/ 컴파일
```

### 테스트

```sh
npx vitest run --reporter=verbose test/
```

### 기여 가이드

다음 항목은 인터페이스만 정의되어 있으며 구현 기여를 환영한다:

- **Gemini CLI 파서** (`src/ingest/session-parser/gemini.ts`): 파서 인터페이스 정의됨, 구현 필요
- **LLM 작업별 라우팅**: 현재 전역 LLM 설정만 지원. 추출/요약/분류별 모델 분리 미구현
- **PPTX/DOCX 지원**: 현재 마크다운과 PDF만 지원
- **웹 UI**: CLI와 MCP만 존재, 브라우저 기반 검색/탐색 인터페이스 미구현
- **AST Symbol Extraction Phase 2** (`src/ast.ts`): 코드 청크에서 함수/클래스명 등 심볼 메타데이터 추출

---

## 아키텍처

### 전체 구조

```
hwicortex/
├── src/
│   ├── cli/
│   │   ├── qmd.ts              # CLI 메인 라우터 (명령어 디스패치)
│   │   ├── ingest.ts           # 문서 등록(인제스트) 처리
│   │   ├── extract.ts          # AI 세션 지식 추출
│   │   ├── watch.ts            # 세션 디렉토리 감시 데몬
│   │   ├── rebuild.ts          # 볼트 기준 인덱스 재빌드
│   │   └── formatter.ts        # 출력 포맷팅 (JSON, CSV, XML, MD)
│   ├── index.ts                # SDK 엔트리포인트 (라이브러리 모드)
│   ├── store.ts                # 데이터 액세스 레이어 (SQLite 전체 관리)
│   ├── llm.ts                  # LLM 추상화 (node-llama-cpp 래퍼)
│   ├── collections.ts          # 컬렉션 설정 관리 (YAML)
│   ├── db.ts                   # SQLite 크로스 런타임 호환
│   ├── korean.ts               # 한국어 형태소 분석 (mecab-ko)
│   ├── ast.ts                  # AST 기반 코드 청킹 (tree-sitter)
│   ├── wiki.ts                 # 위키 CRUD + importance 추적
│   ├── config/
│   │   └── config-loader.ts    # YAML 설정 로더 (hwicortex.yaml)
│   ├── mcp/
│   │   └── server.ts           # MCP 서버 (stdio / HTTP)
│   ├── migration/
│   │   └── runner.ts           # DB 스키마 버전 관리 & 마이그레이션
│   ├── ingest/
│   │   ├── pdf-parser.ts       # PDF 텍스트 추출 (pdfjs-dist)
│   │   ├── watcher.ts          # 세션 디렉토리 파일 감시 (chokidar)
│   │   ├── session-to-markdown.ts  # 세션 → 마크다운 변환
│   │   └── session-parser/     # AI 세션 파서 (Claude, Codex, Gemini)
│   └── knowledge/
│       └── extractor.ts        # LLM 기반 지식 추출
├── dist/                        # 컴파일된 JavaScript
├── bin/
│   └── hwicortex               # 셸 래퍼 (Node/Bun 자동 감지)
├── config/
│   └── default.yml             # 설정 파일 템플릿
├── test/                        # 테스트 (vitest)
└── vault/                       # Obsidian 볼트 (지식 저장소)
```

### 동작 원리

HwiCortex는 **문서 등록 → 인덱싱 → 검색**의 파이프라인으로 동작한다.

#### 1단계: 문서 등록 (Ingest)

```
문서 디렉토리 (마크다운, PDF)
  ↓  glob 패턴 매칭
파일 목록 수집
  ↓  콘텐츠 해시 계산
content 테이블에 저장 (해시 기반 중복 제거)
  ↓
documents 테이블에 메타데이터 기록 (컬렉션, 경로, 제목, 수정일)
```

- **콘텐츠 주소 지정 저장소**: 파일 내용의 해시를 키로 사용한다. 동일한 내용의 파일은 하나만 저장되므로 임베딩도 공유된다.
- **PDF**: `pdfjs-dist`로 텍스트를 추출한 뒤 마크다운으로 변환하여 볼트에 저장한다.
- **활성화 플래그**: 삭제된 파일은 `active=0`으로 표시되며 검색에서 제외된다.

#### 2단계: 스마트 청킹

문서를 임베딩하기 전에 의미 단위로 분할한다.

```
원본 문서
  ↓  정규식 패턴으로 경계 점수 계산
    - H1~H6 헤딩 (점수 100→50)
    - 코드 펜스 경계 (점수 80)
    - 수평선 (점수 60)
    - 문단 구분 (점수 20)
    - 리스트 항목 (점수 5)
  ↓
900 토큰 단위 청크 (15% 오버랩)
  ↓  ±200 토큰 범위에서 최적 분할점 탐색
최종 청크 목록
```

- **코드 펜스 보호**: 코드 블록 내부에서는 절대 분할하지 않는다.
- **AST 청킹** (`--chunk-strategy auto`): `.ts/.js/.py/.go/.rs` 파일은 tree-sitter로 함수/클래스 경계에서 분할한다.

#### 3단계: 임베딩 생성

```
청크 목록
  ↓  embeddinggemma (300M, 1152차원) 또는 Qwen3-Embedding
배치 임베딩 (32개씩)
  ↓
content_vectors 테이블 (메타데이터)
  ↓
vectors_vec 가상 테이블 (sqlite-vec, float[1152])
```

- 모든 LLM 추론은 **node-llama-cpp**로 로컬에서 실행된다. 외부 API 호출 없음.
- 모델은 `~/.cache/qmd/models/`에 캐시되며 최초 실행 시 HuggingFace에서 자동 다운로드된다.
- **크래시 안전**: `content_vectors`를 먼저 기록한 후 `vectors_vec`에 삽입한다.

#### 4단계: 검색

HwiCortex는 세 가지 검색 모드를 제공한다.

| 모드 | 명령어 | 원리 |
|------|--------|------|
| **키워드 검색** | `search` | SQLite FTS5 BM25 스코어링 |
| **벡터 검색** | `vsearch` | sqlite-vec 코사인 거리 KNN |
| **하이브리드 검색** | `query` | BM25 + 벡터 + 쿼리 확장 + 리랭킹 |

#### 5단계: 하이브리드 검색 파이프라인 (`query`)

가장 핵심적인 검색 흐름이다:

```
사용자 쿼리
  ↓
① 강한 신호 탐지
   BM25로 빠른 프로브 (20건)
   상위 점수 ≥ 0.85 이고 2위와 격차 ≥ 0.15 → 확장 스킵
  ↓  (약한 신호일 때)
② 쿼리 확장 (LLM)
   - lex: 키워드 변형 (BM25용)
   - vec: 의미 재표현 (벡터 검색용)
   - hyde: 가상 문서 (예상 답변 형태)
  ↓
③ 병렬 검색
   - FTS: 원본 + lex 확장 쿼리들
   - 벡터: 모든 쿼리를 한 번에 배치 임베딩 → KNN
  ↓
④ Reciprocal Rank Fusion (RRF)
   RRF 점수 = Σ (가중치 / (60 + 순위 + 1)) + 위치 보너스
   원본 쿼리 결과에 2배 가중치
  ↓
⑤ 리랭킹 (LLM)
   상위 40건의 최적 청크를 선별하여
   Qwen3-Reranker로 관련성 점수 재산정
  ↓
⑥ 블렌딩
   최종 = 위치가중치 × RRF점수 + (1-위치가중치) × 리랭크점수
   순위 1~3:  0.75 (검색 신뢰)
   순위 4~10: 0.60
   순위 10+:  0.40 (리랭커 신뢰)
  ↓
최종 결과 반환
```

### 데이터베이스 스키마

| 테이블 | 역할 |
|--------|------|
| `content` | 콘텐츠 주소 지정 저장소 (해시 → 문서 텍스트) |
| `documents` | 파일 메타데이터 (컬렉션, 경로, 해시, 활성 여부) |
| `documents_fts` | FTS5 가상 테이블 (전문 검색 인덱스) |
| `content_vectors` | 임베딩 메타데이터 (해시, 청크 순서, 모델) |
| `vectors_vec` | sqlite-vec 가상 테이블 (벡터 인덱스, float[1152]) |
| `store_collections` | 컬렉션 설정 (CLI/SDK로 등록된 컬렉션 정보) |
| `llm_cache` | LLM 호출 결과 캐시 (해시 기반) |

### 사용 모델

| 용도 | 모델 | 설명 |
|------|------|------|
| 임베딩 | `embeddinggemma-300M-Q8_0` | 1152차원, Nomic 포맷 |
| 리랭킹 | `Qwen3-Reranker-0.6B-Q8_0` | 청크 관련성 재산정 |
| 쿼리 확장 | `qmd-query-expansion-1.7B` | Qwen3 파인튜닝, lex/vec/hyde 생성 |

### MCP 도구 목록 (읽기 전용)

| 도구 | 설명 |
|------|------|
| `query` | 하이브리드 검색 (문서 + 세션 + 지식 통합, source 필터 지원) |
| `get` | 특정 문서 조회 (경로 또는 문서 ID) |
| `multi_get` | 여러 문서 배치 조회 (glob 패턴 지원) |
| `status` | 인덱스 상태, 컬렉션 정보, 마지막 추출 시간 |

> MCP에는 읽기 전용 도구만 노출된다. 지식 추출(`extract`)은 CLI 전용.

### 핵심 설계 원칙

- **로컬 퍼스트**: 모든 LLM 추론과 검색이 로컬에서 실행된다. 외부 API 의존 없음.
- **Obsidian이 소스 오브 트루스**: SQLite는 파생 인덱스일 뿐, 볼트가 원본이다.
- **콘텐츠 주소 지정**: 해시 기반 중복 제거로 동일 내용은 한 번만 임베딩한다.
- **강한 신호 스킵**: BM25가 확신할 때는 비용이 큰 LLM 확장을 건너뛴다.
- **크래시 안전**: SQLite 트랜잭션과 삽입 순서로 중단 시에도 데이터 정합성을 보장한다.
- **한국어 형태소 분석**: mecab-ko가 설치된 환경에서는 한국어 텍스트를 내용 형태소(명사, 동사, 형용사)로 분해하여 인덱싱한다. "검색"으로 "검색했다", "검색하는" 등의 활용형을 매칭할 수 있다.

---

## 라이선스

MIT
