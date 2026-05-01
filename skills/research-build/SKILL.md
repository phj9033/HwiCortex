---
name: research-build
description: Build synthesis notes from collected research cards. Triggered by "정리해줘", "<topic> 합성해줘", "subtopic 노트 만들어". Always asks before running.
user_invocable: true
---

# Research Build — 합성 노트 생성

`hwicortex research synthesize`를 호출하여 카드들을 클러스터링하고 subtopic 노트를 작성한다.
**자동 실행 금지.** 항상 사용자 승인 후 실행.

## 트리거

- 자동: 사용자가 "이제 합쳐줘", "subtopic별로 정리", "overview 노트 만들어" 등 합성 의사를 표현할 때
- 수동: `/research-build <topic-id> [<subtopic>]`

## Process

1. **카드 존재 여부 확인**
   ```bash
   hwicortex research status <id>
   ```
   - `cards == 0`이면 fetch가 먼저 필요하다고 안내. research-pre 스킬 제안.

2. **subtopic 결정**
   - 인자가 `<topic-id> <subtopic>` 두 개면 단일 subtopic만 작성.
   - 인자가 `<topic-id>` 하나면 LLM이 자동 클러스터링하고 overview + 클러스터별 노트 생성.

3. **승인 대기**
   "Sonnet으로 합성합니다 (예상 1-3 LLM call). 진행할까요?"

4. **실행**
   ```bash
   hwicortex research synthesize <id> [--subtopic <name>] [--refresh] [--model <id>]
   ```

5. **결과 요약**
   ```
   Wrote N synthesis note(s). Cost: $X.XXXX
   ```
   파일은 `<vault>/research/notes/<id>/<subtopic>.md`에 저장된다.

## Rules

- 자동 실행 금지. 모델 호출 전 승인.
- 동일 subtopic 파일이 이미 있으면 기본은 스킵 — 다시 쓰려면 `--refresh`.
- 인용은 카드 source_id 기반 footnote (`[^abcdef012345]`).
