---
name: knowledge-ingest
description: Batch process local AI session files, review extracted insights with user, and save selected ones to wiki. Use /knowledge-ingest to start.
user_invocable: true
---

# Knowledge Ingest — 세션 배치 처리

로컬 AI 세션 파일들을 읽어 인사이트를 추출하고, 사용자와 문답하며 선별하여 위키에 저장한다.

## 트리거

- 수동 전용: `/knowledge-ingest` 또는 `/knowledge-ingest --project <name>`

## Process

1. **미처리 세션 스캔**
   ```bash
   hwicortex extract --dry-run
   ```
   처리 가능한 세션 목록과 각 세션 요약을 표시.
   미처리 세션이 없으면 → `처리할 세션이 없습니다.` 출력 후 종료.

2. **세션 선택 (사용자 문답)**
   ```
   N개 미처리 세션 발견:
     1. 2026-04-15 — Bun SQLite 동시성 디버깅
     2. 2026-04-14 — 그래프 클러스터링 개선
     3. 2026-04-13 — 위키 링크 기능 추가

   전체 처리? 또는 번호 선택? (예: 1,3)
   ```
   사용자 응답을 기다린다.

3. **선택된 세션 처리**
   각 세션에 대해:
   ```bash
   hwicortex extract --session <id>
   ```
   LLM이 추출한 인사이트 목록을 제시:
   ```
   세션 "Bun SQLite 동시성 디버깅"에서 추출:
     [1] Bun SQLite WAL 모드 설정법 → 저장?
     [2] 동시 쓰기 시 BUSY 에러 원인과 해법 → 저장?
     [3] vitest 테스트 픽스처 패턴 → 저장?

   전체 승인(a) / 번호 선택 / 스킵(s)?
   ```
   사용자 응답을 기다린다.

4. **승인된 인사이트를 wiki로 저장**
   각 승인된 인사이트에 대해:

   중복 체크:
   ```bash
   hwicortex search -c wiki "<인사이트 키워드>" -n 3 --json
   ```

   유사 문서 있음:
   ```bash
   hwicortex wiki update "<title>" --project <project> --append "<인사이트>"
   ```

   유사 문서 없음:
   ```bash
   echo "<body>" | hwicortex wiki create "<title>" --project <project> --tags <tags> --auto-merge --stdin
   ```

   관련 문서 링크:
   ```bash
   hwicortex wiki link "<문서A>" "<문서B>" --project <project>
   ```

5. **인덱스 갱신**
   모든 저장 완료 후 1회:
   ```bash
   hwicortex update --embed
   ```

6. **리포트 출력**
   ```
   📥 인제스트 완료 (N개 세션 처리):
     - 신규: M건
     - 업데이트: K건
     - 스킵: J건
   ```

## Rules

- 항상 사용자와 문답하며 진행. 자동 저장 없음.
- 세션 선택, 인사이트 선택 모두 사용자 승인 필요.
- 프로젝트명은 인자로 받거나, 없으면 사용자에게 질문.
- extract 실패 시 에러 보고 후 다음 세션으로 진행.
