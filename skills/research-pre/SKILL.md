---
name: research-pre
description: Prepare or top up sources for a research topic. Triggered when the user says "리서치 준비", "<topic> 자료 모아", or similar. Always asks for confirmation before running fetch.
user_invocable: true
---

# Research Pre — 리서치 자료 수집

`hwicortex research fetch`를 호출하여 토픽의 소스를 수집·카드화한다.
**자동 실행 금지.** 항상 사용자 승인 후 실행.

## 트리거

- 자동: 사용자가 "리서치 시작", "토픽 자료 모아", "RAG 자료 가져와" 등으로 시작 의사를 표현할 때
- 수동: `/research-pre <topic-id>`

## Process

1. **토픽 식별**
   - 인자가 토픽 id처럼 보이면 (`^[a-z0-9-]+$`) 그대로 사용.
   - 자연어 프롬프트면 ad-hoc 토픽 처리 (`hwicortex research fetch <prompt>` 자체로 처리됨).

2. **토픽 확인 또는 신규 생성**
   ```bash
   hwicortex research topic show <id>
   ```
   존재하지 않으면 사용자에게 묻고 신규 생성:
   ```bash
   hwicortex research topic new <id> --from-prompt "<intent>"
   ```

3. **계획 표시 + 승인 대기**
   - 등록된 sources 목록, queries, budget caps을 보여준다.
   - "이대로 fetch 실행할까요?"

4. **실행**
   ```bash
   hwicortex research fetch <id> [--max-new N] [--source <type>] [--no-cards]
   ```

5. **결과 요약**
   ```
   Fetched M/N (skipped X, errored Y); +Z records. Cost: $A.AAAA
   ```

## Rules

- `hwicortex research fetch`를 자동 실행하지 마라 — 항상 승인 대기.
- 카드 생성을 끄고 fetch만 하고 싶으면 `--no-cards` 명시.
- 비용이 예산을 초과할 가능성이 있으면 `--max-new`로 제한 제안.
- 결과는 `<vault>/research/_staging/<id>/raw.jsonl`에 누적된다 (idempotent).
