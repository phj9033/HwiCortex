---
name: knowledge-tidy
description: Review and tidy wiki knowledge base — merge duplicates, fix links, clean tags, remove low-importance pages. Use /knowledge-tidy to start.
user_invocable: true
---

# Knowledge Tidy — 지식 정리

hwicortex 위키 지식베이스를 정리한다. 중복 병합, 링크 보강, 태그 통일, 저importance 문서 정리.

## 설정

다른 프로젝트에 복사할 때 아래 값만 변경한다:

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `WIKI_PROJECT` | wiki --project 인자 | 현재 디렉토리명 |
| `WIKI_COLLECTION` | hwicortex -c 인자 | `wiki` |

> 프로젝트명이 지정되지 않으면 현재 작업 디렉토리 이름을 사용한다.

## 트리거

- 수동 전용: `/knowledge-tidy` 또는 `/knowledge-tidy --project <name>`

## Process

1. **현황 파악**
   ```bash
   hwicortex wiki list --project $WIKI_PROJECT --json
   ```
   전체 문서 수, importance 분포, 태그 분포를 요약 표시:
   ```
   📊 위키 현황 (project: $WIKI_PROJECT):
     - 문서 수: 42
     - importance 분포: 0 (15건), 1-5 (12건), 6-10 (8건), 11+ (7건)
     - 태그 TOP 5: <tag1>(12), <tag2>(8), <tag3>(6), <tag4>(5), <tag5>(4)
   ```
   프로젝트가 지정되지 않았으면 사용자에게 질문.

2. **정리 항목 분석 & 제안**

   **A) 중복/유사 문서 병합 후보**
   타이틀과 태그가 유사한 문서 쌍을 탐지. 내용 비교가 필요하면:
   ```bash
   hwicortex wiki show "<titleA>" --project $WIKI_PROJECT
   hwicortex wiki show "<titleB>" --project $WIKI_PROJECT
   ```
   제안:
   ```
   🔄 병합 후보:
     1. "<titleA>" + "<titleB>" → 하나로 통합?
   ```

   **B) 링크 보강**
   관련 내용이지만 링크되지 않은 문서:
   ```
   🔗 링크 제안:
     1. "<titleA>" ↔ "<titleB>"
   ```

   **C) 태그 정리**
   유사/중복 태그 통일:
   ```
   🏷 태그 통일 제안:
     - "<tagA>", "<tagB>", "<tagC>" → "<tagA>"로 통일?
   ```

   **D) 저importance 문서 정리**
   importance 0이고 30일 이상 접근 없는 문서:
   ```
   🗑 삭제 후보 (importance: 0, 장기 미접근):
     1. "<title>" (created: YYYY-MM-DD)
   ```

3. **사용자 문답**
   각 항목별로 승인/수정/스킵:
   ```
   위 제안을 항목별로 진행합니다:
   병합 1: "<titleA>" + "<titleB>" → 승인(y) / 스킵(s)?
   ```

4. **실행**
   승인된 항목만 실행:

   병합:
   ```bash
   hwicortex wiki show "<병합 대상>" --project $WIKI_PROJECT
   hwicortex wiki update "<유지할 문서>" --project $WIKI_PROJECT --append "<병합할 내용>"
   hwicortex wiki rm "<삭제할 문서>" --project $WIKI_PROJECT
   ```

   링크:
   ```bash
   hwicortex wiki link "<A>" "<B>" --project $WIKI_PROJECT
   ```

   태그 변경:
   ```bash
   hwicortex wiki update "<title>" --project $WIKI_PROJECT --tags <new,tags>
   ```

   삭제:
   ```bash
   hwicortex wiki rm "<title>" --project $WIKI_PROJECT
   ```

5. **인덱스 갱신**
   ```bash
   hwicortex wiki index --project $WIKI_PROJECT
   hwicortex update --embed
   ```

6. **리포트**
   ```
   🧹 정리 완료:
     - 병합: N건
     - 링크 추가: N건
     - 태그 통일: N건
     - 삭제: N건
   ```

## Rules

- **항상 문답 기반.** 자동 삭제/병합 절대 금지.
- 모든 변경은 승인 후에만 실행.
- 병합 시 중요도가 높은 쪽을 유지하고 낮은 쪽을 삭제.
- 삭제 전 반드시 show로 내용을 확인하고 사용자에게 보여줌.
