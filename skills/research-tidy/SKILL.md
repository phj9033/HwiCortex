---
name: research-tidy
description: Inspect topic status and clean up stale staging artifacts. Triggered by "리서치 상태", "<topic> 정리", "staging 비워줘". Always asks before deleting.
user_invocable: true
---

# Research Tidy — 상태 확인 + 정리

토픽의 진행 상태를 보여주고, 필요시 `_staging` 캐시나 stale 카드 정리를 제안한다.
**삭제 작업은 자동 실행 금지.** 항상 사용자 승인 후 실행.

## 트리거

- 자동: "리서치 어디까지 됐지", "토픽 상태 봐줘", "캐시 비워줘" 등
- 수동: `/research-tidy <topic-id>`

## Process

1. **상태 표시**
   ```bash
   hwicortex research status <id> --json
   ```
   - `raw_records`, `cards`, `synthesis_notes`, `drafts`, `cost_usd`, 최근 이벤트 10개를 보여준다.

2. **이상 징후 체크**
   - `cards == 0` && `raw_records > 0` → fetch 시 카드 비활성화됐을 가능성.
   - `synthesis_notes == 0` && `cards > 0` → research-build 권장.
   - `_staging/<id>/raw.jsonl`이 매우 크면 (>50MB) 정리 후보.

3. **정리 제안 (사용자 확인 필수)**
   - **fetch cache 비우기**: `<vault>/research/_staging/<id>/cache/` 디렉토리 삭제 (다음 fetch가 다시 채움).
   - **draft RAG DB 재생성**: `<vault>/research/_staging/<id>/draft-rag.sqlite` 삭제 (다음 draft가 재인덱싱).
   - **stale 카드 제거**: 어떤 카드가 stale인지는 자동 판단 어려움 — 사용자가 직접 골라야 함.

4. **실행 — 명시적 승인 후에만**
   사용자가 "삭제해" 명시한 항목만 `rm -rf`로 처리.

## Rules

- **삭제 작업은 절대 자동 실행 금지.** raw.jsonl, 카드, 합성 노트, 초안은 모두 사용자 자산이다.
- cache/RAG-DB는 재생성 가능하므로 비교적 안전하지만, 그래도 승인 필수.
- 상태 출력은 항상 안전 — 자유롭게 호출.
