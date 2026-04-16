---
name: knowledge-pre
description: Search relevant wiki knowledge before starting a task. Auto-triggers on implementation/debugging requests, also available as /knowledge-pre.
user_invocable: true
---

# Knowledge Pre — 작업 전 지식 검색

작업 시작 전 관련 위키 지식을 검색하여 컨텍스트에 로드한다.

## 트리거

- 자동: 사용자가 구현, 수정, 디버깅, 리팩토링 등 코드 작업을 지시할 때
- 수동: `/knowledge-pre` 또는 `/knowledge-pre "검색어"`

## Process

1. **작업 의도 파악**
   사용자 메시지에서 핵심 키워드/주제를 추출한다.
   수동 호출 시 인자가 있으면 그것을 검색어로 사용.

2. **지식 검색**
   ```bash
   hwicortex query "<작업 의도 키워드>" -c wiki --json -n 5
   ```
   - 검색 결과가 없으면 → `관련 지식 없음` 한 줄 출력 후 즉시 작업 진행.
   - 에러 발생 시 → 에러 메시지 출력 후 작업 진행 (블로킹하지 않음).

3. **결과 요약 표시**
   검색 결과가 있으면 타이틀 목록을 표시:
   ```
   📋 관련 지식 발견:
     1. <title> (importance: N) — <첫 줄 요약>
     2. <title> (importance: N) — <첫 줄 요약>
   ```

4. **원문 로드 (선택적)**
   - 관련도가 높다고 판단한 항목만 원문 로드 (최대 2건).
   - body가 2000토큰(약 8000자)을 초과하면 스킵.
   ```bash
   hwicortex wiki show "<title>" --project <project>
   ```
   - show 호출 시 hit_count가 자동 증가하여 importance가 올라감.

5. **작업 시작**
   ```
   참고한 지식: <로드한 타이틀 목록>
   ```
   한 줄 출력 후 원래 작업을 진행한다.

## Rules

- 검색 실패 또는 결과 없음 시 **절대 블로킹하지 않는다**. 즉시 작업 진행.
- 원문 로드는 최대 2건. 토큰 예산을 지켜라.
- wiki 컬렉션이 등록되지 않은 경우 `-c wiki` 검색이 빈 결과를 반환할 수 있다. 그래도 진행.
- 이 스킬의 목적은 참고 정보 제공이다. 작업 흐름을 지연시키지 말 것.
