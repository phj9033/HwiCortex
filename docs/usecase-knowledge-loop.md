# 유즈케이스: 지식 루프

AI 에이전트와 작업하면서 축적되는 인사이트를 자동으로 수집, 검색, 정리하는 순환 워크플로우.

## 개요

```
           ┌──────────────────────────────────────┐
           │          지식 루프 사이클              │
           │                                      │
  ┌────────┴─────────┐               ┌────────────┴──────────┐
  │ knowledge-pre    │               │ knowledge-post        │
  │ 작업 전 지식 검색 │               │ 작업 후 인사이트 저장  │
  └────────┬─────────┘               └────────────┬──────────┘
           │                                      │
           │  ┌──────────────────────────┐        │
           └─►│     위키 지식베이스       │◄───────┘
              │  (Obsidian 호환 마크다운)  │
              └────────────┬─────────────┘
                   ▲       │       ▲
                   │       │       │
        ┌──────────┘       │       └──────────┐
  ┌─────┴──────────┐ ┌────┴──────────┐ ┌─────┴──────────┐
  │ knowledge-ingest│ │ hwicortex     │ │ knowledge-tidy │
  │ 과거 세션 배치   │ │ watch         │ │ 위키 정리/병합  │
  │ 처리            │ │ 자동 추출     │ │                │
  └────────────────┘ └──────────────┘ └────────────────┘
```

**핵심 가치**: 팀이나 개인이 AI와 작업하며 발견한 버그 원인, 아키텍처 결정, 삽질 경험 등을 위키에 쌓아두면, 이후 같은 주제를 다룰 때 자동으로 관련 지식이 검색되어 중복 삽질을 방지한다.

## 초기 셋업

### 1. vault 디렉토리 설정

```bash
# Obsidian vault 또는 별도 디렉토리 지정
export QMD_VAULT_DIR=~/my-vault
```

### 2. wiki 컬렉션 등록

```bash
hwicortex collection add $QMD_VAULT_DIR/wiki --name wiki --mask "**/*.md"
hwicortex update --embed
```

### 3. 프로젝트 설정 (세션 자동 추출 사용 시)

프로젝트 루트에 `hwicortex.yaml`을 생성한다:

```yaml
vault:
  path: ~/my-vault

sessions:
  watch_dirs:
    - ~/.claude/projects       # Claude Code 세션 로그
  idle_timeout_minutes: 10     # 세션 종료 판단 대기 시간

llm:
  default: claude
  claude:
    api_key: ${ANTHROPIC_API_KEY}
    model: claude-sonnet-4-6
  budget:
    max_tokens_per_run: 500000
```

### 4. 확인

```bash
hwicortex collection list   # wiki 컬렉션 표시 확인
hwicortex status            # 인덱스 상태 확인
```

## 일상 워크플로우

### 사이클 1: 작업 전 — 관련 지식 자동 검색

작업을 시작하면 `knowledge-pre`가 위키에서 관련 지식을 자동 검색한다.

```
사용자: SQLite 동시 쓰기 오류 수정해줘

에이전트 (자동):
  hwicortex query "SQLite 동시 쓰기 오류 WAL BUSY" -c wiki --json -n 5

  📋 관련 지식 발견:
    1. "SQLite WAL 모드 설정" (importance: 8) — WAL 모드로 동시성 향상
    2. "Bun SQLite BUSY 에러 해법" (importance: 5) — busy_timeout 설정 필요

  참고한 지식: SQLite WAL 모드 설정, Bun SQLite BUSY 에러 해법
  (이전에 축적된 지식을 바탕으로 작업 시작)
```

수동으로도 호출 가능하다:

```
사용자: /knowledge-pre "벡터 검색 성능 최적화"
```

**특징**:
- 검색 실패 또는 결과 없음 시 블로킹하지 않고 바로 작업 진행
- 원문 로드는 최대 2건, 2000토큰 이내
- show 호출 시 hit_count가 자동 증가하여 자주 참조되는 문서의 importance가 올라감

### 사이클 2: 작업 후 — 인사이트 자동 저장

작업이 끝나면 `knowledge-post`가 대화를 분석하여 인사이트를 위키에 자동 저장한다.

```
(작업 완료, 커밋 후)

에이전트 (자동):
  대화 분석 → 인사이트 2건 발견

  중복 체크:
  hwicortex search -c wiki "SQLite busy_timeout 설정" -n 3 --json
  → 기존 "Bun SQLite BUSY 에러 해법" 발견 → append

  hwicortex search -c wiki "vitest 타임아웃 설정" -n 3 --json
  → 유사 문서 없음 → 새로 생성

  저장 실행:
  hwicortex wiki update "Bun SQLite BUSY 에러 해법" --project hwicortex --append "..."
  echo "..." | hwicortex wiki create "Vitest 타임아웃 설정법" --project hwicortex --tags vitest,config --auto-merge --stdin
  hwicortex wiki link "Vitest 타임아웃 설정법" "Bun SQLite BUSY 에러 해법" --project hwicortex
  hwicortex update --embed

  📝 지식 저장 완료:
    - 업데이트: "Bun SQLite BUSY 에러 해법" (+busy_timeout 값 튜닝 사례)
    - 신규: "Vitest 타임아웃 설정법" (tags: vitest, config)
    - 링크: "Vitest 타임아웃 설정법" ↔ "Bun SQLite BUSY 에러 해법"
```

수동으로도 호출 가능하다:

```
사용자: /knowledge-post
```

**특징**:
- 승인 없이 자동 저장한다 (CLAUDE.md의 명시적 예외)
- 저장할 인사이트가 없으면 아무 출력 없이 조용히 종료
- 하나의 인사이트 = 하나의 위키 페이지 원칙
- 기존 문서와 유사하면 병합, 아니면 새로 생성

### 사이클 3: 과거 세션 배치 처리

쌓여 있는 AI 세션 로그를 한 번에 처리하려면 `knowledge-ingest`를 사용한다.

```
사용자: /knowledge-ingest --project hwicortex

에이전트:
  hwicortex extract --dry-run

  3개 미처리 세션 발견:
    1. 2026-04-15 — Bun SQLite 동시성 디버깅
    2. 2026-04-14 — 벡터 검색 최적화
    3. 2026-04-13 — 위키 링크 기능 추가

  전체 처리? 또는 번호 선택? (예: 1,3)

사용자: 1,2

에이전트:
  hwicortex extract --session 2026-04-15-bun-sqlite

  세션 "Bun SQLite 동시성 디버깅"에서 추출:
    [1] WAL 모드에서 checkpoint 주기 설정 → 저장?
    [2] better-sqlite3 vs bun:sqlite 벤치마크 결과 → 저장?
    [3] 임시 디버깅 로그 출력 방법 → 저장?

  전체 승인(a) / 번호 선택 / 스킵(s)?

사용자: 1,2

에이전트:
  (중복 체크 → 저장 → 링크 → 다음 세션 처리...)

  📥 인제스트 완료 (2개 세션 처리):
    - 신규: 3건
    - 업데이트: 1건
    - 스킵: 2건
```

**특징**:
- 세션 선택, 인사이트 선택 모두 사용자 승인 필요
- `hwicortex extract --dry-run`으로 미리 확인 가능
- 실패한 세션은 건너뛰고 다음으로 진행

### 사이클 4: 자동 추출 (백그라운드)

`hwicortex watch`를 띄워두면 세션이 끝날 때마다 자동으로 인사이트를 추출한다.

```bash
# 터미널에서 백그라운드 실행
hwicortex watch &
```

동작:
1. `sessions.watch_dirs`의 `.jsonl` 파일을 감시
2. 파일이 `idle_timeout_minutes` (기본 10분) 동안 변경 없으면 세션 완료로 판단
3. 자동으로 세션 파싱 → LLM 인사이트 추출 → vault에 저장
4. 상태를 `.state.json`에 기록하여 중복 처리 방지

### 사이클 5: 위키 정리

위키가 커지면 `knowledge-tidy`로 정리한다.

```
사용자: /knowledge-tidy --project hwicortex

에이전트:
  hwicortex wiki list --project hwicortex --json

  📊 위키 현황 (project: hwicortex):
    - 문서 수: 42
    - importance 분포: 0 (15건), 1-5 (12건), 6-10 (8건), 11+ (7건)
    - 태그 TOP 5: sqlite(12), bug(8), architecture(6), bun(5), config(4)

  🔄 병합 후보:
    1. "SQLite WAL 모드" + "SQLite WAL 설정법" → 내용 90% 중복

  🔗 링크 제안:
    1. "벡터 검색 최적화" ↔ "sqlite-vec 설치 가이드" — 관련 내용이나 미링크

  🏷 태그 통일 제안:
    - "db", "database", "sqlite" → "sqlite"로 통일

  🗑 삭제 후보 (importance: 0, 30일+ 미접근):
    1. "임시 테스트 메모" (created: 2026-03-01)

  항목별로 진행합니다:
  병합 1: "SQLite WAL 모드" + "SQLite WAL 설정법" → 승인(y) / 스킵(s)?

사용자: y

에이전트:
  hwicortex wiki show "SQLite WAL 설정법" --project hwicortex
  hwicortex wiki update "SQLite WAL 모드" --project hwicortex --append "..."
  hwicortex wiki rm "SQLite WAL 설정법" --project hwicortex
  (계속 진행...)

  🧹 정리 완료:
    - 병합: 1건
    - 링크 추가: 1건
    - 태그 통일: 3건
    - 삭제: 1건
```

**특징**:
- 모든 변경은 사용자 승인 후에만 실행
- 병합 시 importance가 높은 쪽을 유지
- 삭제 전 반드시 내용을 보여줌

## importance 시스템

위키 페이지에는 자동으로 importance 점수가 부여된다.

### 점수 계산

```
importance = show×1 + append×2 + update×1 + link×1 + merge×3
```

| 행동 | 가중치 | 설명 |
|------|--------|------|
| show (조회) | ×1 | `wiki show`로 열람할 때 |
| append (추가) | ×2 | 기존 문서에 인사이트 추가 |
| update (수정) | ×1 | 내용/태그 업데이트 |
| link (링크) | ×1 | 다른 문서와 연결 |
| merge (병합) | ×3 | 다른 문서를 흡수 |

### 활용

- `knowledge-pre`가 검색 결과를 표시할 때 importance 순으로 정렬
- `knowledge-tidy`가 importance 0 + 장기 미접근 문서를 삭제 후보로 판단
- 자주 참조/갱신되는 문서는 importance가 자연스럽게 올라감
- `hwicortex wiki reset-importance`로 초기화 가능

## 실제 루프 시나리오

### 1일차: 프로젝트 시작

```
사용자: 인증 시스템 구현해줘
에이전트: (knowledge-pre) 관련 지식 없음 → 바로 작업
          (작업 완료)
          (knowledge-post) 📝 신규: "JWT 인증 구현 패턴" (tags: auth, jwt)
```

### 3일차: 비슷한 작업

```
사용자: 다른 서비스에서도 인증 추가해줘
에이전트: (knowledge-pre) 📋 관련 지식 발견:
            1. "JWT 인증 구현 패턴" (importance: 2)
          → 1일차의 경험을 참고하여 더 빠르게 구현
          (knowledge-post) 📝 업데이트: "JWT 인증 구현 패턴" (+리프레시 토큰 처리 추가)
```

### 2주차: 동료가 같은 프로젝트 작업

```
동료: 인증 관련 버그 수정해줘
에이전트: (knowledge-pre) 📋 관련 지식 발견:
            1. "JWT 인증 구현 패턴" (importance: 5) — 구현 히스토리 + 주의사항
          → 이전 팀원의 지식을 활용하여 버그 원인 빠르게 파악
```

### 한 달 후: 지식 정리

```
사용자: /knowledge-tidy --project myapp
에이전트: 📊 문서 28건 분석
          🔄 병합 후보 2건, 🗑 삭제 후보 3건
          → 정리 후 깔끔한 지식베이스 유지
```

## 위키 저장 구조

HwiCortex 위키는 Obsidian 호환 마크다운이다.

### 파일 구조

```
vault/wiki/
├── hwicortex/
│   ├── sqlite-wal-모드-설정.md
│   ├── bun-sqlite-busy-에러-해법.md
│   ├── vitest-타임아웃-설정법.md
│   └── _index.md                  # 자동 생성 인덱스
├── myapp/
│   ├── jwt-인증-구현-패턴.md
│   └── _index.md
└── ...
```

### 페이지 frontmatter

```yaml
---
title: SQLite WAL 모드 설정
project: hwicortex
tags: [sqlite, performance, config]
sources: [session-2026-04-15]
related: [bun-sqlite-busy-에러-해법]
importance: 8
hit_count: 12
count_show: 5
count_append: 2
count_update: 1
count_link: 1
count_merge: 0
count_search_hit: 3
count_query_hit: 2
last_accessed: 2026-04-16
created: 2026-04-10
updated: 2026-04-16
---

## 내용
WAL (Write-Ahead Logging) 모드를 활성화하면 ...

## 관련 문서
- [[bun-sqlite-busy-에러-해법]]
```

Obsidian에서 직접 열어서 편집/탐색할 수 있다.

## 스킬 요약

| 스킬 | 호출 | 승인 | 용도 |
|------|------|------|------|
| `/knowledge-pre` | 자동 + 수동 | 불필요 | 작업 전 관련 지식 검색 |
| `/knowledge-post` | 자동 + 수동 | 불필요 (자동 저장) | 작업 후 인사이트 저장 |
| `/knowledge-ingest` | 수동 전용 | 필요 (세션/인사이트 선택) | 과거 세션 배치 처리 |
| `/knowledge-tidy` | 수동 전용 | 필요 (항목별 승인) | 위키 정리/병합/삭제 |

## CLI 빠른 참조

```bash
# 위키 관리
hwicortex wiki create "제목" --project <n> --tags t1,t2 --body "..."
hwicortex wiki update "제목" --project <n> --append "추가 내용"
hwicortex wiki show "제목" --project <n>
hwicortex wiki list --project <n> --json
hwicortex wiki link "문서A" "문서B" --project <n>
hwicortex wiki rm "제목" --project <n>
hwicortex wiki index --project <n>

# 세션 추출
hwicortex extract --dry-run          # 미처리 세션 확인
hwicortex extract --session <id>     # 특정 세션 추출
hwicortex watch                      # 자동 감시 모드

# 인덱싱
hwicortex update --embed             # FTS + 벡터 갱신

# 검색
hwicortex query "키워드" -c wiki     # 하이브리드 검색
hwicortex search "키워드" -c wiki    # BM25 검색 (LLM 불필요)
```
