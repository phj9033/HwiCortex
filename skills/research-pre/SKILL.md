---
name: research-pre
description: Gather sources for a research topic. Triggered by "리서치 준비", "<topic> 자료 모아", or similar. Runs hwicortex CLI for HTTP fetch only — card generation is research-build's job.
user_invocable: true
---

# Research Pre — 자료 수집 (fetch만)

이 스킬은 `hwicortex research fetch`로 **HTTP fetch + 추출 + raw.jsonl 적재**만 수행한다.
LLM 호출이 아예 없다 (fetch 단계는 카드를 만들지 않음).

카드 생성은 별도 단계 — research-build 스킬이 raw 레코드를 읽고 어시스턴트가 직접 작성한다.

## 트리거

- 자동: 사용자가 "리서치 시작", "토픽 자료 모아", "RAG 자료 가져와" 등으로 시작 의사를 표현할 때
- 수동: `/research-pre <topic-id>`

## Process

1. **토픽 식별 + 확인**
   ```bash
   hwicortex research topic show <id>
   ```
   존재하지 않으면 사용자에게 묻고 신규 생성:
   ```bash
   hwicortex research topic new <id> --from-prompt "<intent>"
   ```

2. **계획 표시 + 승인 대기**
   - 등록된 sources, queries, budget caps을 보여준다.
   - "이대로 fetch 실행할까요? (LLM 호출 없음, HTTP fetch만)"

3. **실행**
   ```bash
   hwicortex research fetch <id> [--max-new N] [--source <type>]
   ```

4. **결과 요약**
   ```
   Fetched M/N (skipped X, errored Y); +Z records.
   ```
   raw 레코드는 `<vault>/research/_staging/<id>/raw.jsonl`에 누적 (idempotent).

5. **다음 단계 안내**
   "카드를 작성하려면 `/research-build <id>`를 호출하세요. 이 세션에서 제가 raw 레코드를 읽고 카드 마크다운을 직접 작성합니다."

## Rules

- `hwicortex research fetch`를 자동 실행하지 마라 — 항상 승인 대기.
- 비용이 예산을 초과할 가능성이 있으면 `--max-new`로 제한 제안.
- 결과는 `<vault>/research/_staging/<id>/raw.jsonl`에 누적된다 (idempotent).
- **이 스킬은 LLM 호출을 하지 않는다.** 카드/합성/초안은 research-build, research-draft 스킬이 어시스턴트의 작업으로 처리.
