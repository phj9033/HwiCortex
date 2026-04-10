# Obsidian에서 Wiki Importance 활용하기

hwicortex wiki의 importance/hit_count 값을 Obsidian에서 시각화하는 방법.

## Dataview 테이블

Dataview 플러그인 설치 후 노트에 아래 쿼리를 삽입하면 중요도 대시보드를 만들 수 있습니다.

````markdown
```dataview
TABLE count_show as "조회", count_append as "보강",
      count_merge as "병합", importance as "관심도",
      count_search_hit as "검색", count_query_hit as "쿼리",
      hit_count as "노출"
FROM "wiki/{project}"
SORT importance DESC
```
````

## Dataview JS 바 차트

````markdown
```dataviewjs
dv.pages('"wiki/demo"')
  .sort(p => p.importance, 'desc')
  .limit(10)
  .forEach(p => {
    const bar = "\u2588".repeat(Math.min(p.importance || 0, 30))
    dv.paragraph(`${p.file.name}: ${bar} (${p.importance || 0})`)
  })
```
````

## Graph View

- importance가 높은 페이지는 merge/link가 많아 자연스럽게 큰 노드로 표현됨
- **Juggl 플러그인** 사용 시 frontmatter 값으로 노드 크기/색상 직접 제어 가능

## 인사이트 해석

| 패턴 | 의미 |
|------|------|
| importance 높고 hit_count 낮음 | 직접 자주 참조하지만 검색에 안 걸림 — 태그/제목 개선 필요 |
| importance 낮고 hit_count 높음 | 검색에 자주 걸리지만 안 읽음 — 정리 필요하거나 노이즈 |
| 둘 다 높음 | 핵심 지식 |
| count_merge 높음 | 여러 주제가 수렴하는 허브 페이지 |
