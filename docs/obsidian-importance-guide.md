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

### Juggl — importance 기반 노드 크기/색상 설정

Juggl은 **Cytoscape.js CSS** 문법의 `graph.css` 파일로 노드 외형을 제어한다. frontmatter 값은 Cytoscape 노드의 data 속성으로 자동 바인딩되므로, `node[importance]` 선택자와 `data(importance)`, `mapData()` 함수로 접근할 수 있다.

> **주의**: Cytoscape.js CSS는 브라우저 CSS와 다르다. `var()`, `:not()` 등은 지원하지 않는다.

#### 1. graph.css 설정

`.obsidian/plugins/juggl/graph.css` 파일을 편집한다:

```css
/* ── importance 기반 노드 크기 (mapData로 선형 보간) ── */

/* importance가 있는 노드: 0→20px ~ 15→80px 선형 매핑 */
node[importance] {
  width: mapData(importance, 0, 15, 20, 80);
  height: mapData(importance, 0, 15, 20, 80);
  font-size: mapData(importance, 0, 15, 10, 22);
}

/* importance가 없는 노드: 기본 크기 */
node {
  width: 20;
  height: 20;
  background-color: #6b7280;
}

/* ── importance 구간별 색상 ── */

/* 낮음 (1~2): 회색 */
node[importance <= 2] {
  background-color: #6b7280;
}

/* 보통 (3~5): 파랑 */
node[importance >= 3][importance <= 5] {
  background-color: #3b82f6;
}

/* 높음 (6~10): 노랑 */
node[importance >= 6][importance <= 10] {
  background-color: #f59e0b;
}

/* 핵심 (11+): 빨강 */
node[importance >= 11] {
  background-color: #ef4444;
}
```

#### 핵심 문법

| 문법 | 설명 |
|------|------|
| `node[importance]` | importance 속성이 있는 노드 선택 |
| `node[importance >= 6]` | 비교 연산자로 범위 필터링 |
| `data(importance)` | 해당 노드의 importance 값 참조 |
| `mapData(importance, 0, 15, 20, 80)` | importance 0→20px, 15→80px로 선형 보간 |

#### 2. 적용 방법

1. `.obsidian/plugins/juggl/graph.css` 파일을 직접 편집 (없으면 생성)
2. Juggl 그래프 뷰를 열면 즉시 반영됨 (자동 리로드)
3. importance가 높은 노드가 크고 빨갛게 표시된다

#### 3. 노트별 개별 스타일 (선택)

frontmatter에 직접 스타일 키를 넣으면 개별 노드를 오버라이드할 수 있다:

```yaml
---
cssclass: hub-node
color: "#8b5cf6"
shape: diamond
---
```

## 인사이트 해석

| 패턴 | 의미 |
|------|------|
| importance 높고 hit_count 낮음 | 직접 자주 참조하지만 검색에 안 걸림 — 태그/제목 개선 필요 |
| importance 낮고 hit_count 높음 | 검색에 자주 걸리지만 안 읽음 — 정리 필요하거나 노이즈 |
| 둘 다 높음 | 핵심 지식 |
| count_merge 높음 | 여러 주제가 수렴하는 허브 페이지 |
