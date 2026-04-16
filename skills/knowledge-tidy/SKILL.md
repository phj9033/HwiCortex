---
name: knowledge-tidy
description: Review and tidy wiki knowledge base — merge duplicates, fix links, clean tags, remove low-importance pages. Use /knowledge-tidy to start.
user_invocable: true
---

# Knowledge Tidy — 지식 정리

위키 지식베이스를 정리한다. 중복 병합, 링크 보강, 태그 통일, 저importance 문서 정리.

## 트리거

- 수동 전용: `/knowledge-tidy` 또는 `/knowledge-tidy --project <name>`

## Process

1. **현황 파악**
   ```bash
   hwicortex wiki list --project <project> --json
   ```
   전체 문서 수, importance 분포, 태그 분포를 요약 표시:
   ```
   📊 위키 현황 (project: hwicortex):
     - 문서 수: 42
     - importance 분포: 0 (15건), 1-5 (12건), 6-10 (8건), 11+ (7건)
     - 태그 TOP 5: sqlite(12), bug(8), architecture(6), bun(5), config(4)
   ```
   프로젝트가 지정되지 않았으면 사용자에게 질문.

2. **정리 항목 분석 & 제안**

   **A) 중복/유사 문서 병합 후보**
   타이틀과 태그가 유사한 문서 쌍을 탐지. 내용 비교가 필요하면:
   ```bash
   hwicortex wiki show "<titleA>" --project <project>
   hwicortex wiki show "<titleB>" --project <project>
   ```
   제안:
   ```
   🔄 병합 후보:
     1. "Session Timeout 처리" + "세션 만료 대응" → 하나로 통합?
     2. "SQLite WAL" + "SQLite Write-Ahead Logging" → 하나로 통합?
   ```

   **B) 링크 보강**
   관련 내용이지만 링크되지 않은 문서:
   ```
   🔗 링크 제안:
     1. "Bun SQLite Lock" ↔ "SQLite 동시성 패턴"
   ```

   **C) 태그 정리**
   유사/중복 태그 통일:
   ```
   🏷 태그 통일 제안:
     - "db", "database", "sqlite" → "sqlite"로 통일?
   ```

   **D) 저importance 문서 정리**
   importance 0이고 30일 이상 접근 없는 문서:
   ```
   🗑 삭제 후보 (importance: 0, 장기 미접근):
     1. "임시 테스트 메모" (created: 2026-03-01)
   ```

3. **사용자 문답**
   각 항목별로 승인/수정/스킵:
   ```
   위 제안을 항목별로 진행합니다:
   병합 1: "Session Timeout 처리" + "세션 만료 대응" → 승인(y) / 스킵(s)?
   ```

4. **실행**
   승인된 항목만 실행:

   병합:
   ```bash
   hwicortex wiki show "<병합 대상>" --project <project>
   # 내용을 합쳐서:
   hwicortex wiki update "<유지할 문서>" --project <project> --append "<병합할 내용>"
   hwicortex wiki rm "<삭제할 문서>" --project <project>
   ```

   링크:
   ```bash
   hwicortex wiki link "<A>" "<B>" --project <project>
   ```

   태그 변경:
   ```bash
   hwicortex wiki update "<title>" --project <project> --tags <new,tags>
   ```

   삭제:
   ```bash
   hwicortex wiki rm "<title>" --project <project>
   ```

5. **인덱스 갱신**
   ```bash
   hwicortex wiki index --project <project>
   hwicortex update --embed
   ```

6. **리포트**
   ```
   🧹 정리 완료:
     - 병합: 2건
     - 링크 추가: 3건
     - 태그 통일: 5건
     - 삭제: 1건
   ```

## Rules

- **항상 문답 기반.** 자동 삭제/병합 절대 금지.
- 모든 변경은 승인 후에만 실행.
- 병합 시 중요도가 높은 쪽을 유지하고 낮은 쪽을 삭제.
- 삭제 전 반드시 show로 내용을 확인하고 사용자에게 보여줌.
