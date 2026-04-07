# HwiCortex

QMD 하드포크 기반의 **AI 세션 지식 추출 + 문서 검색** 도구.

AI 에이전트(Claude Code, Codex CLI 등)와의 대화에서 생긴 지식을 자동 추출하고, 프로젝트 문서(마크다운, PDF)를 통합 검색할 수 있는 로컬 퍼스트 엔진이다. 추출된 지식은 Obsidian 볼트에 저장되어 탐색과 연결이 가능하다.

**핵심 가치:**
- AI와의 대화에서 얻은 지식이 휘발되지 않고 축적된다
- 프로젝트 문서를 AI가 직접 검색해서 활용한다
- Obsidian 볼트로 모든 지식을 탐색/연결할 수 있다

---

## 설치

```sh
bun install -g hwicortex
```

**시스템 요구사항:**
- Bun >= 1.0.0 또는 Node.js >= 22
- macOS: `brew install sqlite` (확장 지원용)

---

## 빠른 시작

```sh
# 1. 문서 등록 — 마크다운, PDF를 인덱싱
hwicortex ingest ./docs --name "requirements" --pattern "*.md,*.pdf"

# 2. 검색 — 하이브리드(BM25 + 벡터 + LLM 재순위) 기본
hwicortex search "로그인 스펙"

# 3. 지식 추출 — AI 세션에서 인사이트 추출
hwicortex extract --dry-run          # 예상 토큰 + 세션 수 미리 확인
hwicortex extract                    # 미처리 세션 일괄 추출

# 4. 감시 모드 — 세션 종료 시 자동 추출
hwicortex watch
```

---

## config.yml 설정 가이드

설정 파일 위치: `~/.hwicortex/config.yml`

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

# 문서 컬렉션
ingest:
  collections:
    - name: "요구사항"
      path: ~/projects/specs
      pattern: "*.md,*.pdf"
```

### 주요 설정 항목

| 항목 | 설명 | 기본값 |
|------|------|--------|
| `vault.path` | Obsidian 볼트 루트 경로 | `~/hwicortex-vault` |
| `sessions.watch_dirs` | 감시할 세션 디렉토리 목록 | Claude, Codex 기본 경로 |
| `sessions.idle_timeout_minutes` | 세션 종료 판정 대기 시간 | `10` |
| `llm.default` | 지식 추출용 LLM (`claude` 또는 `local`) | `claude` |
| `llm.budget.max_tokens_per_run` | 1회 extract 실행당 토큰 상한 | `500000` |
| `llm.budget.warn_threshold` | 경고 표시 토큰 임계값 | `100000` |

---

## MCP 서버 설정

HwiCortex는 MCP(Model Context Protocol) 서버를 내장하여 AI 에이전트가 직접 문서를 검색할 수 있다.

### Claude Code 연동

`~/.claude/settings.json`에 추가:

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

### MCP 도구 목록 (읽기 전용)

| 도구 | 설명 |
|------|------|
| `query` | 하이브리드 검색 (문서 + 세션 + 지식 통합, source 필터 지원) |
| `get` | 특정 문서 조회 (경로 또는 문서 ID) |
| `multi_get` | 여러 문서 배치 조회 (glob 패턴 지원) |
| `status` | 인덱스 상태, 컬렉션 정보, 마지막 추출 시간 |

> MCP에는 읽기 전용 도구만 노출된다. 지식 추출(`extract`)은 CLI 전용.

---

## CLI 명령어 레퍼런스

### `ingest` — 문서 등록

```sh
# 마크다운 + PDF 등록
hwicortex ingest ./specs --name "요구사항" --pattern "*.md,*.pdf"

# 마크다운만 등록
hwicortex ingest ./docs --name "기술문서" --pattern "*.md"
```

PDF는 `pdfjs-dist`로 텍스트 추출 후 마크다운으로 변환되어 볼트에 저장된다.

### `search` — 검색

```sh
# 하이브리드 검색 (기본)
hwicortex search "로그인 인증 흐름"

# BM25 키워드 검색만
hwicortex search "API endpoint" --mode bm25

# 소스 타입 필터링
hwicortex search "팝업" --source knowledge    # 추출된 지식만
hwicortex search "API" --source docs           # 등록 문서만
hwicortex search "에러" --source sessions      # 세션만
```

### `extract` — 지식 추출

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

### `watch` — 감시 모드

```sh
# 세션 디렉토리 감시 데몬 시작
hwicortex watch
```

- `chokidar`로 세션 디렉토리를 감시
- 세션 종료 감지 시 자동으로 파싱 -> 인덱싱 -> 지식 추출 실행
- 종료 판정: `idle_timeout_minutes` (기본 10분) 동안 변경 없으면 종료로 간주

### `rebuild` — 인덱스 재빌드

```sh
# 볼트 기준으로 SQLite 인덱스 전체 재빌드
hwicortex rebuild
```

Obsidian에서 직접 파일을 수정한 경우 인덱스를 동기화할 때 사용한다.

### `mcp` — MCP 서버 시작

```sh
# stdio 모드 (AI 에이전트가 서브프로세스로 실행)
hwicortex mcp

# HTTP 모드
hwicortex mcp --http                    # localhost:8181
hwicortex mcp --http --port 8080        # 커스텀 포트
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

## 기여 가이드

### 미구현 항목

다음 항목은 인터페이스만 정의되어 있으며 구현 기여를 환영한다:

- **Gemini CLI 파서** (`ingest/session-parser/gemini.ts`): 파서 인터페이스 정의됨, 구현 필요
- **LLM 작업별 라우팅**: 현재 전역 LLM 설정만 지원. 추출/요약/분류별 모델 분리 미구현
- **PPTX/DOCX 지원**: 현재 마크다운과 PDF만 지원
- **웹 UI**: CLI와 MCP만 존재, 브라우저 기반 검색/탐색 인터페이스 미구현
- **AST Symbol Extraction Phase 2** (`src/ast.ts`): 코드 청크에서 함수/클래스명 등 심볼 메타데이터 추출. 인터페이스(`SymbolInfo`)만 정의됨, 구현 시 코드 검색 정확도 개선

### 개발 환경 설정

```sh
git clone <repo-url>
cd hwicortex
bun install
bun run build
```

### 테스트

```sh
bun run test
```

테스트는 `fixtures/` 폴더의 샘플 데이터 기반 스냅샷 테스트를 사용한다.

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
│   ├── store.ts                # 데이터 액세스 레이어 (SQLite 전체 관리)
│   ├── llm.ts                  # LLM 추상화 (node-llama-cpp 래퍼)
│   ├── collections.ts          # 컬렉션 설정 관리 (YAML)
│   ├── db.ts                   # SQLite 크로스 런타임 호환
│   ├── korean.ts               # 한국어 토크나이징 (Mecab)
│   ├── ast.ts                  # AST 기반 코드 청킹 (tree-sitter)
│   ├── mcp/
│   │   └── server.ts           # MCP 서버 (stdio / HTTP)
│   ├── migration/
│   │   └── runner.ts           # DB 스키마 버전 관리 & 마이그레이션
│   └── ingest/
│       ├── pdf-parser.ts       # PDF 텍스트 추출 (pdfjs-dist)
│       └── session-parser/     # AI 세션 파서 (Claude, Codex, Gemini)
├── dist/                        # 컴파일된 JavaScript
├── test/                        # 테스트 (vitest)
├── config/                      # 설정 템플릿
└── docs/                        # 문서
```

### 동작 원리

HwiCortex는 **문서 등록 → 인덱싱 → 검색**의 파이프라인으로 동작한다. 각 단계의 원리를 설명한다.

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
| `store_collections` | 컬렉션 설정 캐시 (YAML → SQLite 동기화) |
| `llm_cache` | LLM 호출 결과 캐시 (해시 기반) |

### 사용 모델

| 용도 | 모델 | 설명 |
|------|------|------|
| 임베딩 | `embeddinggemma-300M-Q8_0` | 1152차원, Nomic 포맷 |
| 리랭킹 | `Qwen3-Reranker-0.6B-Q8_0` | 청크 관련성 재산정 |
| 쿼리 확장 | `qmd-query-expansion-1.7B` | Qwen3 파인튜닝, lex/vec/hyde 생성 |

### 핵심 설계 원칙

- **로컬 퍼스트**: 모든 LLM 추론과 검색이 로컬에서 실행된다. 외부 API 의존 없음.
- **Obsidian이 소스 오브 트루스**: SQLite는 파생 인덱스일 뿐, 볼트가 원본이다.
- **콘텐츠 주소 지정**: 해시 기반 중복 제거로 동일 내용은 한 번만 임베딩한다.
- **강한 신호 스킵**: BM25가 확신할 때는 비용이 큰 LLM 확장을 건너뛴다.
- **크래시 안전**: SQLite 트랜잭션과 삽입 순서로 중단 시에도 데이터 정합성을 보장한다.

---

## 라이선스

MIT
