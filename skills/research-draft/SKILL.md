---
name: research-draft
description: Write a research-grounded draft using topic notes as RAG context. Triggered by "초안 써줘", "<topic>로 글 써줘", "draft 작성". hwicortex returns RAG hits; the assistant writes the draft body itself.
user_invocable: true
---

# Research Draft — 초안 작성 (어시스턴트가 직접)

이 스킬은 hwicortex의 RAG 검색으로 컨텍스트를 받고, **현재 세션의 어시스턴트(나)가** 초안 본문을 직접 작성한다.

## 트리거

- 자동: 사용자가 "초안 작성", "이 토픽으로 블로그", "report 만들어줘" 등 글 작성 의사를 표현할 때
- 수동: `/research-draft <topic-id> --prompt "<text>"`

## Process

### 1. 토픽 상태 확인

```bash
hwicortex research status <id> --json
```

- `cards == 0` && `synthesis_notes == 0` → 컨텍스트가 빈약함을 안내. 사용자가 그래도 진행하길 원하면 계속.
- 사용자에게 스타일 (blog/report/qa)과 prompt를 명확히 받기.

### 2. RAG 검색으로 컨텍스트 수집

```bash
hwicortex research search <id> --query "<prompt>" --top-k 12 --json
```

또는 SDK로:

```ts
import { research } from "hwicortex";
const { context } = await research.searchTopic({
  topic, vault, query: prompt, topK: 12,
});
```

`context`는 `[{source_id, title, snippet, path}, ...]` 배열. 빈 배열이면 사용자에게 알리고 진행 여부 확인.

### 3. 초안 본문 작성 (어시스턴트가 직접)

context 배열을 보고 내가 markdown 본문을 작성한다:

- 사용자의 prompt + 선택된 style (blog/report/qa)에 맞춘 어조
- 구체적 주장은 반드시 `[^source_id]` footnote로 인용 — source_id는 context의 12-hex
- footnote 정의는 본문 끝에 `[^source_id]: <짧은 ref>` 형태로 추가
- context 외의 정보 추가 금지 (할루시네이션 방지)

### 4. 초안 파일로 저장

```ts
import { research } from "hwicortex";
const path = research.writeDraftFile(vault, {
  topic_id: topicId,
  slug: research.slugFromPrompt(prompt), // 또는 사용자 지정 slug
  prompt,
  generated_at: new Date().toISOString(),
  model: "<내가-사용한-모델-식별자>",
  context_sources: context.map(c => c.path),
  include_vault: false,
  body_md: "<내가 작성한 markdown>",
});
```

같은 날 동일 slug가 이미 있으면 자동으로 `-2`, `-3` 접미사 추가됨.

### 5. 결과 안내

- 파일 경로 출력
- 인용한 source_id 개수
- (선택) 사용자에게 미리보기 — 본문 첫 200자 정도

## Rules

- **자동 실행 금지.** prompt 받기 전, search 후 context 표시 후, 본문 작성 전 단계마다 승인.
- **`[^source_id]`의 source_id는 반드시 12-hex.** 위치 라벨 사용 금지.
- **context 밖 정보 추가 금지.** 모르는 것은 모른다고 쓰거나 footnote 없이 두기.
- `hwicortex_index: false`로 저장되므로 메인 검색 인덱스에 초안이 다시 검색되진 않음.
- RAG 인덱싱이 처음이면 임베딩 모델 로드 시간이 걸릴 수 있음을 사전 안내.
