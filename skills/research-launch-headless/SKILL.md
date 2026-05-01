---
name: research-launch-headless
description: Documentation for launching a fresh agent session that drives the hwicortex research pipeline. Use when the user wants a batch run that doesn't fit in the current chat (e.g., overnight, scheduled). hwicortex itself NEVER auto-launches an agent.
user_invocable: true
---

# Research Launch Headless — 신규 세션을 띄우는 방법 (가이드)

이 스킬은 **자동화가 아니다.** 사용자가 자신의 환경에서 어떤 명령으로 새 에이전트 세션을 띄울지 직접 세팅하기 위한 가이드다. hwicortex는 키를 들고 있지 않으므로 LLM 호출은 누구든 사용자 환경에서 띄운 에이전트가 한다.

## 언제 쓰나

- 현재 세션에서 처리하기엔 토큰 예산이 큰 배치 (수십~수백 raw 레코드 카드화).
- 정기 스케줄 (오버나이트, 매주 월요일 등).
- 긴 합성 노트 K개 + 초안을 한 번에 끝내고 싶을 때.

## 기본 흐름

1. **사용자가 본인 환경에서 에이전트 CLI 설정**
   - Claude Code (`claude` CLI), Aider, Codex CLI, 자체 MCP 호스트 등.
   - 어느 도구든 "프롬프트로 작업 지시 + hwicortex CLI를 도구로 사용 가능"이면 OK.

2. **공통 prerequisite**
   - `hwicortex` PATH (검증: `which hwicortex`)
   - `QMD_VAULT_DIR` 또는 `--vault` 인자
   - 사용자 환경의 LLM 권한 (Claude Code 구독, OpenAI 키, Bedrock 등 — 어떤 거든 그 도구 자체가 이미 갖고 있어야 함)
   - **hwicortex 자체에 ANTHROPIC_API_KEY를 넘길 필요는 없다** (hwicortex는 더 이상 LLM 호출 안 함)

## 예시 (사용자가 자기 환경에 맞게 변경)

> 이 예시들은 그대로 실행하지 말고, 사용자가 자기 도구/모델에 맞게 수정해 둘 것.
> 어시스턴트는 사용자 명령 없이 자동으로 띄우면 안 된다.

### Claude Code (대화형)

```sh
# 새 Claude Code 세션을 사용자가 직접 띄움
claude
# 그 세션에서 자연어로 지시:
# "<vault>의 rag-eval 토픽에 대해 /research-build 후 /research-draft --prompt '...' 실행"
```

### Claude Code (one-shot, append-prompt 패턴)

```sh
# 사용자 환경에 따라 옵션명이 다를 수 있음 — 자기 버전의 claude --help 확인
claude -p "Run /research-build rag-eval, then /research-draft rag-eval --prompt 'Survey RAG eval'"
```

### Cron + 사용자 작성 wrapper

```sh
# ~/bin/research-nightly.sh (사용자가 직접 만듦)
#!/usr/bin/env bash
set -euo pipefail
hwicortex research fetch rag-eval --max-new 20 --vault "$QMD_VAULT_DIR"
# 카드/합성/초안 작성은 사용자 환경의 에이전트로 위임
my-agent --task "build cards + synthesis for rag-eval, write a weekly summary draft"
```

cron 등록은 사용자가 직접 (`crontab -e`).

### MCP 호스트

`docs/research/agent-guide.md`에 MCP 도구 정의 예시 있음. 호스트가 hwicortex CLI 자식 프로세스를 띄울 때 환경변수와 vault 경로만 명시하면 된다.

## hwicortex가 하지 말아야 할 것

- 사용자 명령 없이 새 세션을 자동으로 spawn하지 마라.
- 사용자 환경의 키를 hwicortex 프로세스로 옮기지 마라 (그럴 필요 자체가 없음).
- "내가 알아서 헤드리스로 돌릴게요"라는 식으로 진행하지 말 것.
- 이 스킬은 가이드 문서 — 어시스턴트가 사용자에게 "이런 식으로 자기 환경에 띄우세요"라고 안내하는 용도.

## 사용자에게 권장할 것

- 첫 실행 전: 작은 토픽 (`--max-new 5`)으로 dry-run.
- 비용/시간 사전 추정 후 사용자 확인.
- 오류 발생 시 `hwicortex research status <id> --json`으로 상태 확인 → 어디까지 진행됐는지 파악.
- raw.jsonl과 cards/notes/drafts 파일은 모두 사용자 자산. hwicortex가 자동 삭제하지 않는다.
