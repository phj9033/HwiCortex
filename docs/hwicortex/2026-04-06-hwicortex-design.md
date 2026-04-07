# HwiCortex 설계 문서

> QMD 하드포크 기반의 AI 세션 지식 추출 + 문서 검색 엔진

## 개요

HwiCortex는 QMD(https://github.com/tobi/qmd)를 하드포크하여, AI 에이전트 세션에서 지식을 자동 추출하고 요구사항/기술 문서를 통합 검색할 수 있는 로컬 퍼스트 도구이다.

### 핵심 가치

- AI와의 대화에서 얻은 지식이 휘발되지 않고 축적된다
- 프로젝트 문서를 AI가 필요시 직접 검색해서 활용한다
- Obsidian 볼트로 모든 지식을 탐색·연결할 수 있다

### 사용자

- 소규모 팀 (2-5명)
- 우선 로컬 사용, 공유 방식은 추후 결정

---

## 하드포크 근거

QMD를 래퍼/플러그인 방식이 아닌 하드포크로 진행하는 이유:

1. **컬렉션 타입 확장**: QMD의 컬렉션은 정적 문서 전용. 세션 로그처럼 "감시 → 자동 수집 → 파싱 → 추출"하는 동적 컬렉션 타입을 core/collection에 추가해야 함
2. **인덱싱 파이프라인 수정**: 세션 파싱 결과와 지식 추출 결과를 동일 인덱스에 통합하려면 core/indexer의 문서 스키마 확장이 필요 (source_type, project, tags 등 메타데이터 필드)
3. **검색 필터 추가**: "이 프로젝트의 지식만 검색", "문서만 검색", "세션만 검색" 등 source_type 기반 필터링을 core/search에 추가해야 함
4. **CLI/MCP 확장**: 기존 명령어 체계에 extract, watch 등을 자연스럽게 통합

QMD가 플러그인 시스템을 제공하지 않으므로, 이 수준의 통합은 코어 수정 없이 불가능하다.

---

## 아키텍처

```
HwiCortex (QMD 하드포크)
│
├── core/                    ← QMD 기존 코어 (최소 수정)
│   ├── indexer/             — 문서 인덱싱 (BM25 + 벡터)
│   │                          수정: source_type, project, tags 메타 필드 추가
│   ├── search/              — 하이브리드 검색 + LLM 재순위
│   │                          수정: source_type 필터 추가
│   ├── collection/          — 컬렉션 관리
│   │                          수정: 동적 컬렉션 타입 추가
│   └── store/               — SQLite 저장소
│                              수정: schema_version 테이블 추가
│
├── ingest/                  ← 신규: 입력 처리
│   ├── pdf-parser/          — PDF → 마크다운 변환
│   ├── session-parser/      — AI 세션 로그 파싱
│   │   ├── claude.ts        — Claude Code JSONL (v1 릴리스)
│   │   ├── codex.ts         — Codex CLI JSONL (v1 릴리스)
│   │   ├── gemini.ts        — Gemini CLI JSON (후순위, 인터페이스만 정의)
│   │   └── types.ts         — 공통 파서 인터페이스 + 스키마 버전 관리
│   └── doc-watcher/         — 파일 변경 감지 (문서 + 세션)
│
├── knowledge/               ← 신규: 지식 추출
│   ├── extractor.ts         — LLM 기반 지식 추출 엔진
│   ├── classifier.ts        — 프로젝트별 + 주제별 분류
│   ├── vault-writer.ts      — Obsidian 마크다운 출력
│   └── llm-provider.ts      — LLM 통합 인터페이스 (로컬/Claude API)
│
├── mcp/                     ← QMD 기존 MCP (확장)
│   └── tools: query, get, multi_get, status (읽기 전용)
│
└── cli/                     ← QMD 기존 CLI (확장)
    └── 명령어: search, ingest, extract, watch, rebuild
```

---

## 기능 상세

### 1. 문서 저장소 (ingest/)

#### 지원 형식
- 마크다운 (.md) — 그대로 인덱싱
- PDF (.pdf) — pdfjs-dist로 텍스트 추출 → 마크다운 변환

#### 등록 방식
```bash
hwicortex ingest ./specs --name "요구사항" --pattern "*.md,*.pdf"
```

#### PDF 처리
- pdfjs-dist로 텍스트 추출 후 마크다운 변환
- 이미지 포함 PDF는 텍스트만 추출 (OCR은 스코프 밖)
- 원본 PDF 경로를 프론트매터에 기록
- 변환된 마크다운은 vault/docs/ 에 저장
- 파싱 실패 시: 에러 로그 + 원본 파일 경로를 vault/docs/_errors.md에 기록, 다음 실행 시 재시도

#### 인덱싱 흐름
```
PDF/MD → ingest/pdf-parser → vault/docs/ 저장 → core/indexer → SQLite (BM25 + 벡터)
```

### 2. 세션 지식 추출 (knowledge/)

#### 세션 파서 (ingest/session-parser/)

v1 릴리스 지원 에이전트:
| 에이전트 | 로그 형식 | 경로 |
|----------|-----------|------|
| Claude Code | JSONL | ~/.claude/projects/*/sessions/ |
| Codex CLI | JSONL | ~/.codex/sessions/ (실제 경로 확인 필요) |

Gemini CLI는 파서 인터페이스만 정의, 구현은 후순위.

파싱 결과:
- 역할 구분 (user / assistant / tool)
- 도구 호출은 접힌 블록(`<details>`)으로 처리하되, 추출 시에는 요약/제거하여 토큰 절약
- 프론트매터: 프로젝트 경로, 시작/종료 시간, 세션 ID, parser_version

#### 스키마 변경 대응
- 각 파서에 `parser_version` 필드 관리
- 파싱 전 스키마 검증 (필수 필드 존재 여부 체크)
- 파싱 실패 시: 원본 보존 + state.json에 실패 기록 + 다음 실행 시 재시도 큐
- 스키마 변경 감지 시 경고 로그 출력

#### 트리거 방식

**수동 추출:**
```bash
hwicortex extract                    # 미처리 세션 일괄 추출
hwicortex extract --session <id>     # 특정 세션만
hwicortex extract --dry-run          # 예상 세션 수 + 토큰 추정치 표시
```

**자동 추출 (세션 종료 감지):**
```bash
hwicortex watch                      # 감시 데몬 시작
```
- chokidar로 세션 디렉토리 감시
- 세션 종료 판정: 파일의 마지막 엔트리 타입 확인 → 종료 마커가 없으면 idle_timeout(기본 10분) 적용
- 파싱 → 인덱싱 → 지식 추출 자동 트리거

#### 대용량 세션 처리
- 세션 크기 임계값 설정 (기본 50,000 토큰)
- 임계값 초과 시 청킹 전략:
  1. 도구 호출 로그를 요약본으로 대체 (토큰 대폭 절감)
  2. 남은 대화를 시간순 청크로 분할
  3. 청크별 추출 후 결과 병합
- 각 청크는 독립적으로 추출 가능해야 함

#### LLM 설정

config.yml에서 `llm.default`로 전역 설정 (claude | local).

- **claude (기본 권장)**: 한국어 품질, 정확도 우수. 비용 발생.
- **local**: 비용 없음. GGUF 모델 한국어 성능 제한적.

작업별 세분화 라우팅은 v1에서는 미지원. 필요시 추후 추가.

#### 비용 안전장치
```yaml
llm:
  budget:
    max_tokens_per_run: 500000     # extract 1회 실행당 토큰 상한
    warn_threshold: 100000          # 이 이상이면 확인 프롬프트
```
- `extract` 실행 전 `--dry-run`으로 예상 토큰 확인 가능
- 상한 초과 시 중단 + 나머지는 다음 실행으로 이연

#### 추출 프로세스
```
세션 마크다운 (도구 호출 요약 처리)
  → LLM 프롬프트 전송
  → 응답: { title, summary, keyInsights[], tags[], relatedTopics[] }
  → classifier: 프로젝트 폴더 결정 + 태그 부여
  → vault-writer: knowledge/{project}/{topic}.md 생성/병합
```

#### 병합 전략

지식 문서는 구조화된 포맷을 사용:

```markdown
---
title: 팝업 중복 생성 방지
project: bb3-client
tags: [popup, bugfix, unity]
created: 2026-04-06
updated: 2026-04-06
sources:
  - sessions/bb3-client/2026-04-06-abc123.md
---

## 요약
(LLM 생성 요약)

## 인사이트
- **2026-04-06** (세션 abc123): isDuplicate 파라미터 사용
- **2026-04-07** (세션 def456): IsOpenOrInitializing() 확인 방식 추가
```

- **append는 기계적**: 새 인사이트를 `## 인사이트` 섹션에 날짜와 세션 출처와 함께 추가
- **요약만 LLM**: 인사이트가 5개 이상 축적되면 `## 요약` 섹션을 LLM이 재생성
- **중복은 프론트매터로 판단**: sources 배열에 이미 있는 세션은 스킵
- **롤백**: 모든 볼트 파일은 git으로 관리 가능, 병합 전 원본은 sessions/에 보존

### 3. Obsidian 볼트 뷰어

#### 볼트 구조
```
vault/
├── docs/                         ← 등록 문서
│   ├── requirements/
│   │   └── login-spec.md         — [[태그]] 백링크 포함
│   └── technical/
│       └── api-guide.md
├── sessions/                     ← 파싱된 세션
│   └── {project}/
│       └── {date}-{session-id}.md
├── knowledge/                    ← 추출된 지식
│   └── {project}/
│       ├── popup-duplicate-fix.md
│       └── unirx-message-pattern.md
└── .obsidian/                    ← Obsidian 설정 (HwiCortex 수정 금지)
```

- `_index.md`, `_tags.md` 정적 인덱스는 생성하지 않음. Obsidian Dataview 플러그인으로 동적 조회 권장.

#### 소스 오브 트루스
- Obsidian 볼트가 소스 오브 트루스
- SQLite는 볼트의 파생 인덱스
- 볼트 파일이 수정되면 인덱스 재빌드 (`hwicortex rebuild`)

#### Obsidian 동시 접근
- HwiCortex는 `.obsidian/` 디렉토리를 절대 수정하지 않음
- 파일 쓰기는 atomic write (임시 파일 → rename) 방식으로 Obsidian 와처와의 충돌 최소화
- 기존 파일 수정 시 Obsidian의 파일 와처가 자동으로 변경을 감지

#### 메타데이터 저장
```
~/.hwicortex/
├── config.yml                    ← 전역 설정
├── vaults/
│   └── {vault-name}/
│       ├── index.db              — SQLite (BM25 + 벡터, schema_version 포함)
│       └── state.json            — 마지막 처리 세션, 워치 상태, 실패 큐
```

---

## CLI 명령어

```bash
# 문서 관리
hwicortex ingest <path> --name <name> --pattern "*.md,*.pdf"

# 검색 (하이브리드 기본, --mode bm25 으로 키워드만 가능)
hwicortex search "자연어 질문"
hwicortex search "키워드" --mode bm25
hwicortex search "팝업" --source knowledge   # 지식만 검색
hwicortex search "API" --source docs          # 문서만 검색

# 지식 추출
hwicortex extract                    # 미처리 세션 일괄 추출
hwicortex extract --session <id>     # 특정 세션만
hwicortex extract --dry-run          # 예상 토큰 + 세션 수 표시

# 감시 모드
hwicortex watch                      # 세션 감시 + 자동 추출 데몬

# MCP 서버
hwicortex mcp                        # AI 에이전트용 MCP 서버 시작

# 인덱스 관리
hwicortex rebuild                    # 볼트 기준 인덱스 전체 재빌드
```

---

## MCP 도구 (읽기 전용)

| 도구 | 설명 |
|------|------|
| `query` | 하이브리드 검색 (문서 + 세션 + 지식 통합, source 필터 지원) |
| `get` | 특정 문서 조회 (경로/ID) |
| `multi_get` | 여러 문서 배치 조회 |
| `status` | 인덱스 상태, 마지막 추출 시간 등 |

MCP에는 읽기 전용 도구만 노출. 지식 추출은 CLI 전용.

---

## 기술 스택

| 요소 | 기술 | 출처 |
|------|------|------|
| 런타임 | Bun (공식 런타임) | QMD 기반, Bun으로 확정 |
| 전문 검색 | BM25 | QMD |
| 벡터 DB | SQLite + 임베딩 | QMD |
| 임베딩 모델 | QMD 기본 모델 유지 (node-llama-cpp GGUF) | QMD |
| 로컬 LLM | node-llama-cpp (GGUF) | QMD |
| PDF 파싱 | pdfjs-dist | 신규 |
| 파일 감시 | chokidar | 신규 |
| Claude API | @anthropic-ai/sdk | 신규 |
| 설정 | YAML (config.yml) | QMD |

---

## 설정 파일 (config.yml)

```yaml
vault:
  path: ~/hwicortex-vault

sessions:
  watch_dirs:
    - ~/.claude/projects
    - ~/.codex/sessions
  idle_timeout_minutes: 10

llm:
  default: claude                   # claude | local (claude 기본 권장)
  claude:
    api_key: ${ANTHROPIC_API_KEY}
    model: claude-sonnet-4-6     # 단축명 사용, 전체 ID: claude-sonnet-4-6-20250514
  local:
    model_path: ~/.hwicortex/models/default.gguf
  budget:
    max_tokens_per_run: 500000
    warn_threshold: 100000

ingest:
  collections:
    - name: "요구사항"
      path: ~/projects/specs
      pattern: "*.md,*.pdf"
```

---

## 에러 처리

| 상황 | 동작 |
|------|------|
| LLM API 호출 실패 | 3회 재시도 (exponential backoff) → 실패 시 state.json 실패 큐에 기록, 다음 실행 시 재시도 |
| PDF 파싱 실패 | vault/docs/_errors.md에 에러 기록 + 원본 경로 보존, 스킵 후 계속 |
| 세션 파싱 실패 (스키마 변경) | 원본 보존 + 경고 로그 + 실패 큐 기록. parser_version 불일치 시 명시적 경고 |
| 인덱싱 중단 | SQLite 트랜잭션으로 원자성 보장. 중단 시 마지막 커밋 상태로 롤백 |
| 토큰 상한 초과 | 현재 세션까지 처리 후 중단. 나머지는 다음 실행으로 이연 |
| 대용량 세션 (50K+ 토큰) | 도구 호출 요약 → 청크 분할 → 청크별 추출 → 결과 병합 |

---

## 테스트 전략

| 모듈 | 방법 |
|------|------|
| 세션 파서 (claude, codex) | 실제 세션 로그 샘플 기반 스냅샷 테스트. fixtures/ 폴더에 샘플 보관 |
| PDF 파서 | 다양한 PDF 유형 (텍스트, 혼합, 깨진 파일) fixture 테스트 |
| 지식 추출기 | 고정 입력 → LLM 응답 mock → 출력 구조 검증 |
| 병합 로직 | 기계적 append + 중복 스킵 유닛 테스트 |
| CLI 통합 | ingest → search → extract 엔드투엔드 테스트 |

---

## 마이그레이션

- SQLite에 `schema_version` 테이블 포함
- 버전 변경 시 자동 마이그레이션 스크립트 실행
- 마이그레이션 실패 시 기존 DB 백업 후 재빌드 옵션 제공

---

## 스코프 외 (향후 고려)

- OCR (이미지 기반 PDF)
- 팀 공유 방식 (Git 동기화, 공유 드라이브 등)
- 웹 UI
- PPTX/DOCX 지원
- 한국어 형태소 분석기 통합
- Gemini CLI 파서 구현
- LLM 작업별 세분화 라우팅
