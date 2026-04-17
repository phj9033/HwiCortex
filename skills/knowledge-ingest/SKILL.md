---
name: knowledge-ingest
description: Batch process local AI session files (Claude Code + Codex CLI), review extracted insights with user, and save selected ones to wiki. Use /knowledge-ingest to start. Triggers on "세션 수확", "세션 지식 추출", "히스토리 분석".
user_invocable: true
---

# Knowledge Ingest — 세션 배치 처리

Claude Code / Codex CLI 세션 로그(.jsonl)를 읽어 인사이트를 추출하고, 사용자와 문답하며 선별하여 hwicortex 위키에 저장한다.

## 설정

다른 프로젝트에 복사할 때 아래 값만 변경한다:

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `WIKI_PROJECT` | wiki --project 인자 | 현재 디렉토리명 |
| `WIKI_COLLECTION` | hwicortex -c 인자 | `wiki` |

> 프로젝트명이 지정되지 않으면 현재 작업 디렉토리 이름을 사용한다.

## 트리거

- 수동 전용: `/knowledge-ingest` 또는 `/knowledge-ingest --project <name>`

## 경로 계산 (런타임)

스킬 실행 시 아래 변수를 **먼저 계산**한 후 이후 단계에서 사용한다:

```bash
# 현재 프로젝트 절대 경로 → Claude Code 세션 디렉토리명으로 변환
PROJECT_DIR="$(pwd)"
CC_SESSION_DIR="$HOME/.claude/projects/$(echo "$PROJECT_DIR" | sed 's|/|-|g')"

# Codex CLI 세션 디렉토리 (고정)
CODEX_SESSION_DIR="$HOME/.codex/sessions"
```

## 세션 파일 위치

| 소스 | 경로 | 포맷 |
|------|------|------|
| Claude Code | `$CC_SESSION_DIR/*.jsonl` | `type: "user"/"assistant"`, `message.role`, `message.content` |
| Codex CLI | `$CODEX_SESSION_DIR/YYYY/MM/DD/*.jsonl` | `type: "session_meta"`, `payload.cwd`로 프로젝트 필터 |

## 세션 파일 읽기 방법

### Claude Code (.jsonl)
- 각 줄이 JSON 객체. `type: "user"` 줄의 `message.content`가 사용자 메시지.
- `type: "assistant"` 줄의 `message.content[].text`가 응답 텍스트.
- `timestamp` 필드로 날짜 확인.

### Codex CLI (.jsonl)
- 첫 줄 `type: "session_meta"` → `payload.cwd`로 현재 프로젝트 세션인지 필터.
- `payload.cwd`에 `$PROJECT_DIR` 경로가 포함된 세션만 대상으로 한다.
- 이후 줄은 대화 턴 (user/assistant 메시지).

## Process

1. **미처리 세션 스캔**

   Claude Code 세션:
   ```bash
   ls -lt "$CC_SESSION_DIR"/*.jsonl | head -20
   ```

   Codex CLI 세션 (프로젝트 cwd 필터):
   ```bash
   grep -rl "$PROJECT_DIR" "$CODEX_SESSION_DIR"/ --include="*.jsonl" | head -20
   ```

   각 세션 파일의 첫 번째 사용자 메시지를 읽어 요약 목록을 만든다.
   미처리 세션이 없으면 → `처리할 세션이 없습니다.` 출력 후 종료.

2. **세션 선택 (사용자 문답)**
   ```
   최근 세션 N개 발견:

   [Claude Code]
     1. 2026-04-15 (abc123.jsonl) — <첫 번째 사용자 메시지 요약>
     2. 2026-04-14 (def456.jsonl) — <첫 번째 사용자 메시지 요약>

   [Codex CLI]
     3. 2026-04-13 (session-xxx.jsonl) — <첫 번째 사용자 메시지 요약>

   전체 처리? 또는 번호 선택? (예: 1,3)
   ```
   사용자 응답을 기다린다.

3. **선택된 세션 분석**
   각 세션 `.jsonl` 파일을 읽어 대화 내용을 분석한다.
   추출 대상:
   - **버그 원인과 해법**
   - **아키텍처 결정과 근거**
   - **재사용 가능한 패턴/절차**
   - **삽질 경험** (이렇게 하면 안 된다)
   - **설정/환경 발견**

   추출한 인사이트 목록을 제시:
   ```
   세션 "<요약>"에서 추출:
     [1] <인사이트 제목> → 저장?
     [2] <인사이트 제목> → 저장?
     [3] <인사이트 제목> → 저장?

   전체 승인(a) / 번호 선택 / 스킵(s)?
   ```
   사용자 응답을 기다린다.

4. **승인된 인사이트를 wiki로 저장**
   각 승인된 인사이트에 대해:

   중복 체크:
   ```bash
   hwicortex search -c $WIKI_COLLECTION "<인사이트 키워드>" -n 3 --json
   ```

   유사 문서 있음 → 기존 문서에 append:
   ```bash
   hwicortex wiki update "<title>" --project $WIKI_PROJECT --append "<인사이트>"
   ```

   유사 문서 없음 → 새 문서 생성:
   ```bash
   echo "<body>" | hwicortex wiki create "<title>" --project $WIKI_PROJECT --tags <tags> --auto-merge --stdin
   ```

   관련 문서 링크:
   ```bash
   hwicortex wiki link "<문서A>" "<문서B>" --project $WIKI_PROJECT
   ```

5. **인덱스 갱신**
   모든 저장 완료 후 1회:
   ```bash
   hwicortex update --embed
   ```

6. **리포트 출력**
   ```
   📥 인제스트 완료 (N개 세션 처리):
     - 소스: Claude Code M개 / Codex CLI K개
     - 신규: N건
     - 업데이트: N건
     - 스킵: N건
   ```

## 태그 가이드 (커스터마이즈)

프로젝트에 맞게 아래를 수정한다:
- **유형**: `bug`, `pattern`, `architecture`, `config`, `performance`, `convention`
- **도메인**: 프로젝트에서 자주 다루는 시스템/모듈명을 태그로 추가

## Rules

- 항상 사용자와 문답하며 진행. **자동 저장 없음**.
- 세션 선택, 인사이트 선택 모두 사용자 승인 필요.
- 세션 파일이 너무 크면(50000자 초과) 앞뒤 각 20000자만 읽어 분석한다.
- body 내용은 간결한 참고 자료 형태로 작성. 세션 전문을 넣지 말 것.
- 하나의 인사이트 = 하나의 위키 페이지 원칙. 여러 주제를 한 페이지에 섞지 말 것.
- 에러 발생 시 해당 인사이트를 건너뛰고 다음으로 진행.
- Codex CLI 세션은 `payload.cwd`가 `$PROJECT_DIR`과 일치하는 것만 처리한다.
- `$CC_SESSION_DIR`이 존재하지 않으면 Claude Code 세션 스캔을 건너뛴다.
- `$CODEX_SESSION_DIR`이 존재하지 않으면 Codex CLI 세션 스캔을 건너뛴다.
