---
name: research-draft
description: Generate a research-grounded draft from topic notes. Triggered by "초안 써줘", "<topic>로 글 써줘", "draft 작성". Always asks before running.
user_invocable: true
---

# Research Draft — 초안 작성

`hwicortex research draft`를 호출하여 토픽 노트들을 RAG 컨텍스트로 사용해 초안을 생성한다.
**자동 실행 금지.** 항상 사용자 승인 후 실행.

## 트리거

- 자동: 사용자가 "초안 작성", "이 토픽으로 블로그", "report 만들어줘" 등 글 작성 의사를 표현할 때
- 수동: `/research-draft <topic-id> --prompt "<text>"`

## Process

1. **토픽 + 컨텍스트 확인**
   ```bash
   hwicortex research status <id>
   ```
   - cards/notes가 너무 적으면 사용자에게 알리고 진행 여부 확인.
   - 컨텍스트가 절대 필요하면 `--require-context` 추가 권장.

2. **스타일 + 옵션 협의**
   - `--style blog | report | qa` (기본 report)
   - `--top-k N` (기본 12)
   - `--include-vault` (vault 전체로 검색 범위 확장 — 신중하게)

3. **승인 대기**
   "Sonnet으로 초안 작성합니다. 컨텍스트 N hits, 예상 비용 ~$X.XX. 진행할까요?"

4. **실행**
   ```bash
   hwicortex research draft <id> --prompt "<text>" [--slug <s>] [--style <s>] [--top-k N] [--include-vault] [--require-context]
   ```

5. **결과 출력**
   - 파일 경로 (`<vault>/research/drafts/<id>/<YYYY-MM-DD>-<slug>.md`)
   - 인용된 source_id 개수와 비용

## Rules

- 자동 실행 금지. RAG 인덱싱이 처음이면 시간이 걸릴 수 있음을 안내.
- `hwicortex_index: false`로 저장되므로 메인 인덱스에 영향 없음.
- 같은 날 동일 slug가 있으면 자동으로 `-2`, `-3` 접미사 추가.
