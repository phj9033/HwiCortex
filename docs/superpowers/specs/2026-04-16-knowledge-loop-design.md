# Knowledge Loop Design Spec

**Date:** 2026-04-16
**Status:** Draft

## Overview

AI 대화에서 지식을 자동 추출하여 위키에 축적하고, 작업 전 관련 지식을 검색하여 참고하는 순환 시스템. 4개의 스킬이 기존 `hwicortex` CLI를 조합하여 동작하며, 코드 변경은 최소한으로 제한.

**코드 변경 사항:**
- `hwicortex update --embed` 플래그 추가
- `hwicortex wiki list --json` 지원 추가
- CLAUDE.md에 `--stdin`, `--auto-merge` 플래그 문서화

## Architecture

```
┌──────────────────────────────────────────────────┐
│                   지식 루프                        │
│                                                   │
│  ┌──────────────┐   작업    ┌───────────────┐     │
│  │knowledge-pre │──▶ 개발 ──▶│knowledge-post │     │
│  │(자동+수동)    │           │(자동+수동)     │     │
│  └──────┬───────┘           └──────┬────────┘     │
│         │ 검색                      │ 저장/업데이트 │
│         ▼                          ▼              │
│  ┌─────────────────────────────────────────┐      │
│  │        hwicortex wiki (위키 저장소)       │      │
│  │  - project별 분리                        │      │
│  │  - importance 자동 추적                  │      │
│  │  - 검색 인덱스에 포함 (wiki 컬렉션)       │      │
│  └─────────────────────────────────────────┘      │
│           ▲                    ▲                   │
│           │ 수동 정리           │ 배치 처리         │
│    ┌──────┴───────┐    ┌──────┴──────────┐        │
│    │knowledge-tidy│    │knowledge-ingest │        │
│    │(수동)         │    │(수동)            │        │
│    └──────────────┘    └─────────────────┘        │
└──────────────────────────────────────────────────┘
```

## Skills

### 1. knowledge-pre (작업 전 지식 검색)

**트리거:**
- 자동: 사용자가 구현/수정/디버깅 등 작업을 지시할 때
- 수동: `/knowledge-pre` 또는 `/knowledge-pre "검색어"`

**플로우:**

```
1. 작업 의도 파악
   사용자 메시지에서 핵심 키워드/주제 추출

2. 지식 검색 (요약 목록)
   hwicortex query "<작업 의도>" -c wiki --json -n 5

3. 결과 판단
   - 결과 없음 → "관련 지식 없음" 한 줄 출력, 작업 진행
   - 결과 있음 → 타이틀 + 요약 목록 표시

4. 필요한 원문 로드
   AI가 관련도 높다고 판단한 항목만:
   hwicortex wiki show "<title>" --project <project>
   로드한 내용을 컨텍스트에 반영

5. 작업 시작
   "참고한 지식: <타이틀 목록>" 한 줄 출력 후 작업 진행
```

**핵심 원칙:**
- 검색 결과 없으면 지체 없이 작업 진행 (블로킹하지 않음)
- 토큰 절약: 원문 로드는 최대 2건, body가 2000토큰 초과 시 스킵
- wiki show 시 hit_count 자동 증가 → 자주 참조되는 지식의 importance가 자연 증가
- CLI 에러 발생 시 에러 메시지 출력하고 작업 계속 진행 (블로킹하지 않음)

### 2. knowledge-post (작업 후 지식 저장)

**트리거:**
- 자동: 작업 완료 시점 (커밋 후, 또는 사용자가 완료 확인)
- 수동: `/knowledge-post`

**플로우:**

```
1. 대화 분석
   현재 대화에서 저장할 만한 인사이트 판단:
   - 버그 원인과 해법
   - 아키텍처 결정과 근거
   - 재사용 가능한 패턴/절차
   - 삽질 경험 (이렇게 하면 안 된다)
   저장할 게 없으면 → 아무 출력 없이 종료

2. 인사이트별 중복 체크
   hwicortex search -c wiki "<인사이트 키워드>" -n 3 --json

3. 분기 판단
   A) 유사 문서 있음 → 기존 문서에 append
      hwicortex wiki update "<title>" --project <project> --append "<새 인사이트>"

   B) 유사 문서 없음 → 새 문서 생성
      echo "<body>" | hwicortex wiki create "<title>" --project <project> \
        --tags <tags> --auto-merge --stdin

4. 관련 문서 링크
   hwicortex wiki link "<새/업데이트된 문서>" "<관련 문서>" --project <project>

5. 인덱스 갱신
   hwicortex update --embed

6. 리포트 출력
   승인 없이 자동 저장. 리포트로 무엇을 했는지만 알려줌.
```

**핵심 원칙:**
- 승인 없이 자동 저장, 리포트만 출력 (CLAUDE.md의 "자동 실행 금지" 규칙의 명시적 예외 — knowledge-post 스킬에 한함)
- 저장할 인사이트가 없으면 조용히 종료 (불필요한 출력 없음)
- 프로젝트명은 현재 작업 디렉토리 컨텍스트에서 추론
- CLI 에러 발생 시 에러 메시지 출력 후 다음 인사이트 처리 계속

### 3. knowledge-ingest (세션 배치 처리)

**트리거:**
- 수동 전용: `/knowledge-ingest` 또는 `/knowledge-ingest --project <name>`

**플로우:**

```
1. 미처리 세션 스캔
   hwicortex extract --dry-run
   → 처리 가능한 세션 목록 + 각 세션 요약 표시

2. 세션 선택
   "N개 미처리 세션 발견. 전체 처리? 또는 번호 선택?"
   사용자가 선택

3. 선택된 세션별 처리
   hwicortex extract --session <id>
   → LLM이 추출한 인사이트 목록 제시

   각 인사이트에 대해:
     [저장] / [스킵] 표시
   사용자: 전체 승인 / 개별 수정 / 스킵

4. 승인된 인사이트를 wiki로 저장
   - 중복 체크: hwicortex search -c wiki "<키워드>" --json
   - 유사 있음 → hwicortex wiki update --append
   - 유사 없음 → hwicortex wiki create --auto-merge --stdin
   - 관련 문서 링크

5. 인덱스 갱신
   hwicortex update --embed

6. 리포트 출력
```

**핵심 원칙:**
- 기존 extract 파이프라인의 LLM 추출 결과를 활용
- 문답 기반 — 사용자가 뭘 넣을지 선택
- 처리된 세션은 state에 기록되어 중복 처리 방지

### 4. knowledge-tidy (지식 정리)

**트리거:**
- 수동 전용: `/knowledge-tidy` 또는 `/knowledge-tidy --project <name>`

**플로우:**

```
1. 현황 파악
   hwicortex wiki list --project <project> --json
   → 전체 문서 수, importance 분포, 태그 분포 요약

2. 정리 항목 분석 & 제안

   A) 중복/유사 문서 병합 후보
      타이틀/태그 유사 문서 쌍 탐지
      hwicortex wiki show로 내용 비교
      → "이 2개를 병합할까요?"

   B) 링크 보강
      관련 내용인데 링크 안 된 문서 발견
      → "이 문서들을 링크할까요?"

   C) 태그 정리
      유사 태그 통일 제안
      → "태그를 이렇게 통일할까요?"

   D) 저importance 문서 정리
      importance 0, 오래된 문서 목록 제시
      → "이 문서들 삭제할까요?"

3. 사용자 문답
   항목별로 승인/수정/스킵 선택

4. 실행
   hwicortex wiki update / link / rm

5. 인덱스 갱신
   hwicortex update --embed

6. 리포트 출력
```

**핵심 원칙:**
- 항상 문답 기반 — 자동 삭제/병합 없음
- 정리 후 `hwicortex wiki index --project <project>` (위키 목차 재생성) + `hwicortex update --embed` (검색 인덱스 갱신) 둘 다 실행

## Code Changes

### 1. `hwicortex update --embed` 플래그 추가

**변경 파일:** `src/cli/qmd.ts`

**동작:**
- `hwicortex update` — 기존과 동일 (인덱스만 갱신)
- `hwicortex update --embed` — 인덱스 갱신 후, `getHashesNeedingEmbedding(db)`로 임베딩이 없는(null) 청크 해시를 조회하여 해당 해시만 embed 실행

**구현:** update 명령 끝에 `--embed` 플래그 체크 → 기존 `embed` 로직(`generateEmbeddings`) 호출. 전체 재임베딩이 아닌 누락분만 처리하므로 변경이 적을 때는 빠르게 완료.

### 2. `hwicortex wiki list --json` 지원 추가

**변경 파일:** `src/cli/wiki.ts`

현재 `wiki list`는 plain text만 출력. `--json` 플래그 추가하여 title, project, tags, importance를 JSON 배열로 출력. knowledge-tidy 스킬이 구조화된 데이터로 분석하기 위해 필요.

### 3. CLAUDE.md 업데이트

`wiki create` 명령에 `--stdin`, `--auto-merge`, `--force` 플래그 문서화. knowledge-post 스킬의 자동 저장 예외 규칙 추가.

## Prerequisite: Wiki Collection Setup

wiki 문서가 검색에 잡히려면 wiki vault를 컬렉션으로 등록해야 함.

```bash
hwicortex collection add <vault>/wiki --name wiki --mask "**/*.md"
hwicortex update --embed
```

이것은 초기 1회 설정. 스킬 설치 가이드에 포함.

## Deliverables

| 산출물 | 유형 | 설명 |
|--------|------|------|
| `skills/knowledge-pre/SKILL.md` | 스킬 | 작업 전 지식 검색 |
| `skills/knowledge-post/SKILL.md` | 스킬 | 작업 후 지식 저장 |
| `skills/knowledge-ingest/SKILL.md` | 스킬 | 세션 배치 처리 |
| `skills/knowledge-tidy/SKILL.md` | 스킬 | 지식 정리 |
| `src/cli/qmd.ts` | 코드 변경 | `update --embed` 플래그 추가 |
| `src/cli/wiki.ts` | 코드 변경 | `wiki list --json` 지원 추가 |
| `CLAUDE.md` | 문서 갱신 | `--stdin`/`--auto-merge` 플래그 문서화, 자동 저장 예외 규칙 |
| 설치 가이드 | 문서 | wiki 컬렉션 등록 방법 |

## Design Decisions

1. **CLI 순수 의존** — 전용 서브커맨드 없이 기존 CLI 조합으로 구현. 부족하면 이후 확장.
2. **extract 독립 유지** — extract 파이프라인은 배치 처리용으로 유지. 스킬은 wiki CLI 직접 조작.
3. **knowledge-post는 자동, tidy/ingest는 문답** — 저장은 마찰 최소화, 정리/배치는 사용자 판단 필요.
4. **프로젝트별 분리** — 모든 대화에서 추출하되, --project로 위키 분리 저장.
