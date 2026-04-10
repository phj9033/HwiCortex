# Wiki Importance Tracking & Similarity Detection

## Overview

Wiki 페이지에 동작별 카운트를 추적하여 중요도를 수치화하고, 새 페이지 생성 시 유사 페이지를 감지하여 병합을 제안하는 기능.

## 1. Frontmatter 스키마

기존 `WikiMeta`에 다음 필드를 추가한다. 현재 `parseFrontmatter()`가 flat key-value만 지원하므로, counts는 flat 필드로 저장한다:

```yaml
---
title: JWT 인증 흐름
project: demo
tags: [auth, security]
sources: []
related: [세션 관리]
count_show: 5
count_append: 3
count_update: 1
count_link: 2
count_merge: 1
count_search_hit: 8
count_query_hit: 4
importance: 12
hit_count: 12
last_accessed: 2026-04-10
created: 2026-04-01
updated: 2026-04-10
---
```

- `count_*`: 동작별 원시 카운트 (7종)
- `importance`: 직접 관심 집계값 (count_* 에서 가중치 적용 자동 계산)
- `hit_count`: 검색 노출 집계값 (count_* 에서 자동 계산)
- `last_accessed`: 마지막 직접 접근일 (show/update/link/merge 시 갱신, 검색 히트는 제외)

### 하위 호환

- 기존 wiki 페이지에 `count_*`가 없으면 모두 0으로 간주
- 마이그레이션 불필요 — 첫 접근 시 자동으로 count 필드 생성

## 2. 카운트 증가 조건

| 동작 | count 필드 | importance 가중치 | hit_count 가중치 |
|------|-----------|-------------------|------------------|
| `wiki show` | count_show +1 | ×1 | — |
| `wiki update --append` | count_append +1 | ×2 | — |
| `wiki update --body` | count_update +1 | ×1 | — |
| `wiki link` | count_link +1 (양쪽) | ×1 | — |
| `wiki create` → 유사 병합 | count_merge +1 | ×3 | — |
| `search` 결과에 wiki 히트 | count_search_hit +1 | — | ×1 |
| `query` 결과에 wiki 히트 | count_query_hit +1 | — | ×1 |

### 계산 공식

```
importance = count_show×1 + count_append×2 + count_update×1 + count_link×1 + count_merge×3
hit_count  = count_search_hit + count_query_hit
```

### 카운트 증가 방지

- `--no-count` 플래그: show/update/search/query 시 카운트 증가 안 함 (스크립트/자동화용)
- `wiki list`, `wiki index`, `wiki rm` → 카운트 변동 없음

## 3. reset-importance

```sh
# importance 계열만 초기화 (count_show, count_append, count_update, count_link, count_merge + importance 값)
hwicortex wiki reset-importance --project demo

# 모든 카운트 전부 초기화 (importance + hit_count + 모든 count_* 필드)
hwicortex wiki reset-importance --project demo --all-counts

# 전 프로젝트 importance 계열 초기화
hwicortex wiki reset-importance --all

# 전 프로젝트 모든 카운트 초기화
hwicortex wiki reset-importance --all --all-counts
```

- `last_accessed`는 리셋 대상 아님 (항상 유지)
- 주기적 리셋으로 "최근 중요도" 트래킹 가능 (월별 리셋 등)

## 4. 유사도 감지 및 병합

### 전제 조건

유사도 감지는 FTS 인덱스에 wiki 페이지가 등록된 경우에만 동작한다. wiki 페이지가 FTS에 없으면 유사도 체크를 건너뛰고 새 페이지를 바로 생성한다.

### 체크 시점

`wiki create` 실행 시 기존 wiki 페이지를 FTS로 검색하여 유사 페이지 탐지.

### 검색 방식

1. **제목 매칭**: 새 제목을 FTS `documents_fts`에서 wiki 컬렉션 한정으로 검색 (BM25)
2. **본문 매칭**: 새 body 텍스트로 동일하게 FTS 검색
3. **점수 합산**: `제목 score × 2 + 본문 score` → 상위 1건 추출
4. **임계값**: 합산 score가 threshold 이상이면 유사 페이지로 판정
   - threshold는 config로 조정 가능

### CLI 인터페이스

```
$ hwicortex wiki create "JWT 리프레시 토큰" --project demo --body "만료 시 갱신"
⚠ 유사 페이지 발견: "JWT 인증 흐름" (score: 0.82)
  병합할까요? [Y/n]: Y
✓ "JWT 인증 흐름"에 내용 병합 (importance: 5 → 8)
```

### 비인터랙티브 환경

stdin이 TTY가 아닌 경우 (MCP, pipe, SDK):
- `--auto-merge`도 `--force`도 없으면 → `--force`와 동일하게 동작 (새 페이지 생성)
- 유사 페이지 발견 시 경고를 stderr로 출력

### 플래그

- `--auto-merge`: 유사 페이지 있으면 확인 없이 자동 병합 (MCP/SDK용)
- `--force`: 유사도 체크 건너뛰고 무조건 새 페이지 생성

### 병합 시 동작

1. 기존 페이지 body에 구분선 + 새 내용 append:
   ```markdown
   (기존 내용)

   ---
   > 병합됨: "JWT 리프레시 토큰" (2026-04-10)

   만료 시 갱신 로직...
   ```
2. `count_merge` +1, importance 재계산
3. 새 페이지의 tags가 있으면 기존 페이지 tags에 합산 (중복 제거)
4. `updated`, `last_accessed` 갱신
5. 새 페이지는 생성하지 않음

### 병합 거부 시 (N)

1. 새 페이지 생성 (count_* 모두 0)
2. 유사 페이지와 자동 link 생성

## 5. Obsidian 시각화 가이드

Obsidian에서 importance/hit_count를 활용하는 방법 (구현 아닌 사용 가이드):

### Dataview 테이블

Dataview 플러그인 설치 후 노트에 아래 쿼리 삽입:

```dataview
TABLE count_show as "조회", count_append as "보강",
      count_merge as "병합", importance as "관심도",
      count_search_hit as "검색", count_query_hit as "쿼리",
      hit_count as "노출"
FROM "wiki/{project}"
SORT importance DESC
```

### Dataview JS 바 차트

```dataviewjs
dv.pages('"wiki/demo"')
  .sort(p => p.importance, 'desc')
  .limit(10)
  .forEach(p => {
    const bar = "█".repeat(Math.min(p.importance || 0, 30))
    dv.paragraph(`${p.file.name}: ${bar} (${p.importance || 0})`)
  })
```

### Graph View

- importance가 높은 페이지는 merge/link가 많아 자연스럽게 큰 노드로 표현됨
- Juggl 플러그인 사용 시 frontmatter 값으로 노드 크기/색상 직접 제어 가능

### 인사이트 해석

| 패턴 | 의미 |
|------|------|
| importance 높고 hit_count 낮음 | 직접 자주 참조하지만 검색에 안 걸림 → 태그/제목 개선 필요 |
| importance 낮고 hit_count 높음 | 검색에 자주 걸리지만 안 읽음 → 정리 필요하거나 노이즈 |
| 둘 다 높음 | 핵심 지식 |
| count_merge 높음 | 여러 주제가 수렴하는 허브 페이지 |

## 6. 코드 변경 범위

| 파일 | 변경 내용 |
|------|-----------|
| `src/wiki.ts` | `WikiMeta`에 count_*/importance/hit_count/last_accessed 추가. `parseFrontmatter()` 수정 (count_* 필드 파싱). `buildFrontmatter()` 수정 (count_* 필드 출력). `bumpCount()`, `recalcImportance()`, `resetImportance()`, `findSimilar()` 함수 추가 |
| `src/cli/wiki.ts` | `show`에 카운트 증가, `create`에 유사도 체크+인터랙티브 프롬프트 (TTY 체크 포함), `reset-importance` 서브커맨드, `--no-count`/`--auto-merge`/`--force` 플래그 |
| `src/cli/search.ts` (또는 search/query CLI 핸들러) | search/query 결과 반환 후 wiki 컬렉션 결과를 식별하여 `bumpCount("search_hit")`/`bumpCount("query_hit")` 호출. store.ts는 변경하지 않음 (side-effect-free 유지) |
| `test/wiki.test.ts` | 카운트 증가/리셋, 유사도 감지, 병합, 가중치 계산, 하위 호환 테스트 |
| `test/wiki-cli.test.ts` | CLI 플래그 통합 테스트 |
| `CLAUDE.md` | `reset-importance`, `--no-count`, `--auto-merge`, `--force` 명령어/플래그 문서화 |
