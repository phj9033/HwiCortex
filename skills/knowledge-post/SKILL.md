---
name: knowledge-post
description: Extract insights from the current conversation and save to wiki automatically after task completion. Also available as /knowledge-post.
user_invocable: true
---

# Knowledge Post — 작업 후 지식 저장

작업 완료 후 대화에서 인사이트를 추출하여 위키에 자동 저장한다.

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

2. **인사이트별 중복 체크**
   각 인사이트에 대해:
   ```bash
   hwicortex search -c wiki "<인사이트 핵심 키워드>" -n 3 --json
   ```

3. **저장 분기**

   **A) 유사 문서 발견 시** → 기존 문서에 append:
   ```bash
   hwicortex wiki update "<기존 문서 title>" --project <project> --append "<새 인사이트 내용>"
   ```

   **B) 유사 문서 없음** → 새 문서 생성:
   ```bash
   echo "<body 내용>" | hwicortex wiki create "<title>" --project <project> --tags <tag1,tag2> --auto-merge --stdin
   ```

   에러 발생 시 → 에러 메시지를 리포트에 포함하고 다음 인사이트 처리 계속.

4. **관련 문서 링크**
   검색 중 관련 문서를 발견했으면:
   ```bash
   hwicortex wiki link "<새/업데이트된 문서>" "<관련 문서>" --project <project>
   ```

5. **인덱스 갱신**
   모든 저장 완료 후 1회 실행:
   ```bash
   hwicortex update --embed
   ```

6. **리포트 출력**
   ```
   📝 지식 저장 완료:
     - 업데이트: "<title>" (+추가된 내용 요약)
     - 신규: "<title>" (tags: tag1, tag2)
     - 링크: "<A>" ↔ "<B>"
   ```

## Rules

- **승인 없이 자동 저장한다.** 이것은 CLAUDE.md의 "자동 실행 금지" 규칙의 명시적 예외이다.
- 저장할 인사이트가 없으면 조용히 종료. 불필요한 출력 금지.
- 프로젝트명은 현재 작업 디렉토리 이름 또는 CLAUDE.md에서 추론.
- body 내용은 간결한 참고 자료 형태로 작성. 대화 전문을 그대로 넣지 말 것.
- 하나의 인사이트 = 하나의 위키 페이지 원칙. 여러 주제를 한 페이지에 섞지 말 것.
- CLI 에러 시 해당 인사이트를 건너뛰고 다음으로 진행.
