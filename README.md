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

## 라이선스

MIT
