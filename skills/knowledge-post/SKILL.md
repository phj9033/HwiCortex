---
name: knowledge-post
description: Extract insights from the current conversation and save to wiki after task completion. Also available as /knowledge-post.
user_invocable: true
---

# Knowledge Post — 작업 후 지식 저장

작업 완료 후 대화에서 인사이트를 추출하여 hwicortex 위키에 저장한다.

## 설정

다른 프로젝트에 복사할 때 아래 값만 변경한다:

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `WIKI_PROJECT` | wiki --project 인자 | 현재 디렉토리명 |
| `WIKI_COLLECTION` | hwicortex -c 인자 | `wiki` |

> 프로젝트명이 지정되지 않으면 현재 작업 디렉토리 이름을 사용한다.

## 트리거

- 자동: 작업 완료 시점 (커밋 후, 또는 사용자가 완료를 확인했을 때)
- 수동: `/knowledge-post`

## Process

1. **대화 분석**
   현재 대화를 분석하여 저장할 만한 인사이트를 판단한다:
   - 버그 원인과 해법
   - 아키텍처 결정과 근거
   - 재사용 가능한 패턴/절차
   - 삽질 경험 (이렇게 하면 안 된다)
   - 설정/환경 관련 발견

   저장할 인사이트가 없으면 → **아무 출력 없이 조용히 종료**.

2. **인사이트 목록 제시 및 승인**
   추출한 인사이트를 사용자에게 보여주고 승인을 받는다:
   ```
   📋 저장할 인사이트:
     [1] <인사이트 제목> — <한 줄 요약>
     [2] <인사이트 제목> — <한 줄 요약>

   전체 승인(a) / 번호 선택(예: 1,3) / 스킵(s)?
   ```
   - 사용자가 `s` 또는 스킵 → 조용히 종료.
   - 사용자가 번호 선택 → 해당 항목만 저장 진행.
   - 사용자가 `a` 또는 전체 → 모든 항목 저장 진행.

3. **승인된 인사이트별 중복 체크**
   각 인사이트에 대해:
   ```bash
   hwicortex search -c $WIKI_COLLECTION "<인사이트 핵심 키워드>" -n 3 --json
   ```

4. **저장 분기**

   **A) 유사 문서 발견 시** → 기존 문서에 append:
   ```bash
   hwicortex wiki update "<기존 문서 title>" --project $WIKI_PROJECT --append "<새 인사이트 내용>"
   ```

   **B) 유사 문서 없음** → 새 문서 생성:
   ```bash
   echo "<body 내용>" | hwicortex wiki create "<title>" --project $WIKI_PROJECT --tags <tag1,tag2> --auto-merge --stdin
   ```

   에러 발생 시 → 에러 메시지를 리포트에 포함하고 다음 인사이트 처리 계속.

5. **관련 문서 링크**
   검색 중 관련 문서를 발견했으면:
   ```bash
   hwicortex wiki link "<새/업데이트된 문서>" "<관련 문서>" --project $WIKI_PROJECT
   ```

6. **인덱스 갱신**
   모든 저장 완료 후 1회 실행:
   ```bash
   hwicortex update --embed
   ```

7. **리포트 출력**
   ```
   📝 지식 저장 완료:
     - 업데이트: "<title>" (+추가된 내용 요약)
     - 신규: "<title>" (tags: tag1, tag2)
     - 링크: "<A>" ↔ "<B>"
   ```

## 태그 가이드 (커스터마이즈)

프로젝트에 맞게 아래를 수정한다:
- **유형**: `bug`, `pattern`, `architecture`, `config`, `performance`, `convention`
- **도메인**: 프로젝트에서 자주 다루는 시스템/모듈명을 태그로 추가

## Rules

- 인사이트 목록을 먼저 보여주고 **사용자 승인 후 저장**한다.
- 저장할 인사이트가 없으면 조용히 종료. 불필요한 출력 금지.
- body 내용은 간결한 참고 자료 형태로 작성. 대화 전문을 그대로 넣지 말 것.
- 하나의 인사이트 = 하나의 위키 페이지 원칙. 여러 주제를 한 페이지에 섞지 말 것.
- CLI 에러 시 해당 인사이트를 건너뛰고 다음으로 진행.
