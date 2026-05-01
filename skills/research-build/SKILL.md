---
name: research-build
description: In-session card and synthesis writing for a research topic. Triggered by "카드 만들어", "정리해줘", "<topic> 합성해줘". The assistant reads raw records / cards and writes cards / synthesis notes itself — no Anthropic key in hwicortex.
user_invocable: true
---

# Research Build — 카드 + 합성 노트 작성 (어시스턴트가 직접)

이 스킬은 **현재 세션의 어시스턴트(나)가** 카드와 합성 노트를 직접 작성하는 워크플로다.
hwicortex는 LLM 호출을 하지 않고, raw/카드 파일 IO만 담당한다.

## 트리거

- 자동: 사용자가 "카드 만들어", "이제 합쳐줘", "subtopic별로 정리", "overview 노트" 등 합성 의사를 표현할 때
- 수동: `/research-build <topic-id> [cards|synthesis|both]`

## Process

### 0. 상태 확인

```bash
hwicortex research status <id> --json
```

- `raw_records == 0` → research-pre로 fetch 먼저. 진행 중단.
- `raw_records > 0`, `cards == 0` → 1단계 (카드 작성)부터.
- `cards > 0`, `synthesis_notes == 0` → 2단계 (합성)부터.
- 둘 다 있으면 사용자에게 어느 쪽인지 묻기.

### 1. 카드 작성 (raw → cards)

raw 레코드 읽기:

```ts
import { readFileSync } from "fs";
import { join } from "path";
const raw = readFileSync(
  join(vault, "research", "_staging", topicId, "raw.jsonl"),
  "utf-8",
);
const records = raw.split("\n").filter(Boolean).map(line => JSON.parse(line));
```

각 레코드에 대해 (이미 카드가 있고 body_hash가 같으면 스킵):

```ts
import { research } from "hwicortex"; // 또는 SDK 직접
const existing = research.readCardFrontmatter(
  research.cardPath(vault, topicId, rec.id),
);
if (existing?.body_hash === rec.body_hash) continue; // 멱등 스킵
```

**카드 본문은 내가(어시스턴트가) rec.body_md를 읽고 작성한다:**
- TL;DR 3-7줄 (한 문장 bullet)
- 핵심 발췌 ≤5개 (반드시 verbatim — body_md의 부분 문자열로 검증)
- 태그 ≤8개

쓰기:

```ts
research.writeCard(vault, {
  source_id: rec.id,
  topic_id: topicId,
  url: rec.canonical_url,
  title: rec.title ?? "(untitled)",
  author: rec.author,
  published: rec.published_at,
  fetched: rec.fetched_at,
  language: rec.language,
  tags: [...],
  body_hash: rec.body_hash,
  tldr: [...],
  excerpts: [...],
});
```

발췌가 substring 검증을 통과하지 않으면 카드에 포함하지 마라 (이전 buildCard 가드와 동일 규칙).

### 2. 합성 노트 작성 (cards → notes)

카드 디렉토리 읽기:

```ts
import { readdirSync, readFileSync } from "fs";
const cardDir = join(vault, "research", "notes", topicId, "sources");
const cardFiles = readdirSync(cardDir).filter(f => f.endsWith(".md"));
```

각 카드의 frontmatter + 본문을 읽어 내가 직접:
- subtopic 클러스터 3-7개 결정 (slug + title + source_ids)
- 각 subtopic마다 합성 노트 본문 작성 (markdown footnotes로 인용: `[^source_id]`)
- overview 노트 추가 작성

쓰기:

```ts
research.writeSynthesis(vault, {
  topic_id: topicId,
  subtopic: "intro",
  generated_at: new Date().toISOString(),
  model: "<내가-사용한-모델-식별자>", // e.g. "claude-opus-4-7-via-claude-code"
  source_cards: [...cited 12-hex ids...],
  body_md: "# Intro\n\n...\n\n[^abcdef012345]: ref",
});
```

이미 존재하는 subtopic 파일은 사용자가 `--refresh` 의사를 명시한 경우만 덮어쓴다.

## Rules

- **자동 실행 금지.** 1단계 → 2단계 사이, 그리고 각 단계 시작 전 사용자 승인.
- **substring 검증을 카드 발췌에서 절대 생략하지 마라.** 환각 인용은 이 시스템 전체를 무용지물로 만든다.
- 카드 한 건 작성 후 사용자에게 "계속 진행?" 물어보지 말고, 모든 raw 레코드 처리 후 일괄 보고.
- 합성 노트의 footnote source_id는 반드시 12-hex (실제 카드 id). 임의 라벨 사용 금지.
- 비용/시간 사전 안내: "raw N건 → 카드 N건 작성, 클러스터 K개 → 합성 노트 K+1개. 진행할까요?"

## 왜 어시스턴트가 직접 쓰는가

이전 버전은 hwicortex가 ANTHROPIC_API_KEY로 Haiku/Sonnet을 호출했다. 현재는 LLM 권한이 사용자의 어시스턴트(나)에 있고, 별도 키 관리 없이 같은 작업이 된다. hwicortex는 파일 IO와 SDK 검색만 담당.
