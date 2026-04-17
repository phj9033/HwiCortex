# 유즈케이스: 게임기획 방법론 RAG

게임기획 방법론 문서를 HwiCortex 컬렉션에 등록하고, AI 에이전트가 해당 문서를 참조하여 기획서를 작성하거나 평가하는 워크플로우.

## 개요

```
┌──────────────────┐     검색      ┌──────────────────┐
│ 방법론 문서 모음   │ ◄──────────── │  AI 에이전트      │
│ (컬렉션: game)   │ ──────────► │  (Claude Code)   │
│                  │   컨텍스트    │                  │
│ - 레벨디자인론    │              │  기획서 작성      │
│ - 밸런싱 원칙    │              │  기획서 평가      │
│ - UX 가이드라인  │              │  개선안 제시      │
│ - 전투 루프 설계  │              │                  │
└──────────────────┘              └──────────────────┘
```

**핵심 원리**: 방법론 문서가 RAG의 지식 베이스 역할을 한다. 에이전트가 기획서를 만들거나 평가할 때, 관련 방법론을 자동으로 검색하여 근거 있는 결과물을 생성한다.

## 1단계: 방법론 문서 준비

마크다운 파일로 방법론 문서를 정리한다. 폴더 구조 예시:

```
~/docs/game-methodology/
├── 밸런싱/
│   ├── dps-곡선-설계.md
│   ├── 난이도-스케일링.md
│   └── 경제-밸런싱.md
├── 레벨디자인/
│   ├── 공간-구성-원칙.md
│   ├── 동선-설계.md
│   └── 난이도-곡선.md
├── 전투시스템/
│   ├── 전투-루프-설계.md
│   ├── 스킬-시스템-패턴.md
│   └── 보스전-설계.md
├── UX/
│   ├── 온보딩-설계.md
│   ├── UI-레이아웃-원칙.md
│   └── 피드백-시스템.md
└── 시스템기획/
    ├── 성장-시스템-유형.md
    ├── 보상-루프.md
    └── 소셜-시스템.md
```

각 문서는 제목(`#`)과 구조화된 섹션을 갖추면 검색 품질이 높아진다:

```markdown
# DPS 곡선 설계

## 목적
레벨별 DPS 증가율을 제어하여 전투 체감 밸런스를 유지한다.

## 핵심 원칙
- 선형이 아닌 로그 곡선을 기본으로 사용
- 레벨 구간별 체감 성장률을 다르게 설정
- ...

## 적용 사례
- RPG: 레벨 1-10 급성장, 10-30 완만, 30+ 미세 성장
- 로그라이크: 런 내 급성장, 메타 진행은 완만
```

## 2단계: 컬렉션 등록 및 인덱싱

```bash
# 컬렉션 등록
hwicortex collection add ~/docs/game-methodology --name game-method --mask "**/*.md"

# 인덱싱 (BM25 전문검색 + 벡터 임베딩)
hwicortex update --embed

# 등록 확인
hwicortex collection list
hwicortex status
```

문서를 추가/수정한 후에는 다시 인덱싱한다:

```bash
hwicortex update --embed
```

## 3단계: 검색 확인

인덱싱이 잘 되었는지 검색으로 확인한다:

```bash
# 키워드 검색 (BM25, LLM 불필요)
hwicortex search "밸런싱 DPS 곡선" -c game-method

# 하이브리드 검색 (쿼리확장 + BM25 + 벡터 + 리랭킹)
hwicortex query "전투 밸런싱에서 난이도 곡선을 어떻게 설계하나" -c game-method

# 전체 내용 포함해서 검색
hwicortex query "보스전 설계 원칙" -c game-method --full

# JSON으로 프로그래밍 연동
hwicortex query "보상 루프 설계" -c game-method --json -n 5
```

## 4단계: 기획서 작성 (AI 에이전트 활용)

### Claude Code에서 직접 사용

Claude Code 대화에서 다음과 같이 요청한다:

```
사용자: 로그라이크 전투 시스템 기획서를 만들어줘.
        방법론 문서는 game-method 컬렉션에 있어.
```

에이전트의 동작 흐름:

1. 요청에서 핵심 주제를 추출한다 (로그라이크, 전투 시스템)
2. `hwicortex query "로그라이크 전투 시스템 전투루프 밸런싱 스킬시스템" -c game-method --full --json -n 5`로 관련 방법론을 검색한다
3. 검색된 방법론 문서(DPS 곡선 설계, 전투 루프 설계, 스킬 시스템 패턴 등)를 컨텍스트로 활용한다
4. 방법론에 근거한 기획서를 작성한다

### 기대 결과물 예시

```markdown
# 로그라이크 전투 시스템 기획서

## 1. 전투 루프
> 참조: 전투-루프-설계.md

### 기본 루프
탐색 → 조우 → 전투 → 보상 → 성장 (런 내)

### 전투 페이즈
...

## 2. DPS 밸런싱
> 참조: dps-곡선-설계.md

### 런 내 성장 곡선
로그 곡선 기반, 스테이지 1-3 급성장 / 4-7 완만 / 8+ 미세
...
```

에이전트가 어떤 방법론 문서를 참조했는지 명시하므로, 근거를 추적할 수 있다.

## 5단계: 기획서 평가 (AI 에이전트 활용)

### Claude Code에서 직접 사용

```
사용자: 이 기획서를 방법론 문서 기준으로 평가해줘.
        기획서: ~/projects/my-game/docs/combat-system.md
        방법론: game-method 컬렉션
```

에이전트의 동작 흐름:

1. 기획서 파일을 읽는다
2. 기획서 내용에서 핵심 주제를 추출한다 (전투, 밸런싱, 보상 등)
3. 주제별로 `hwicortex query`를 수행하여 관련 방법론을 검색한다
4. 기획서의 각 항목을 방법론 기준과 대조하여 평가한다

### 기대 결과물 예시

```markdown
# 기획서 평가 리포트

## 종합 점수: B+ (85/100)

## 항목별 평가

### 전투 루프 (90/100)
- 참조 방법론: 전투-루프-설계.md
- 기본 루프 구조가 방법론의 권장 패턴과 일치함
- 개선점: 전투 종료 후 보상 연출 단계가 빠져 있음 (방법론 3.2절 참조)

### DPS 밸런싱 (75/100)
- 참조 방법론: dps-곡선-설계.md
- 선형 성장 곡선을 사용 중 → 방법론에서는 로그 곡선을 권장
- 레벨 구간별 차별화 없음 → 체감 밸런스 저하 우려

### 보상 시스템 (90/100)
- 참조 방법론: 보상-루프.md
- 즉시/지연 보상 혼합 비율이 적절함
- 개선점: 희귀도별 드롭 확률 테이블 누락

## 개선 제안
1. DPS 곡선을 로그 기반으로 변경 (dps-곡선-설계.md 2.1절)
2. 전투 종료 연출 추가 (전투-루프-설계.md 3.2절)
3. 드롭 확률 테이블 추가 (보상-루프.md 4절)
```

## 6단계: 고급 활용

### 복수 쿼리로 정밀 검색

한 번의 검색으로 부족하면, 주제별로 나눠서 검색한다:

```bash
# 전투 관련 방법론
hwicortex query "전투 루프 설계 원칙" -c game-method --full --json -n 3

# 밸런싱 관련 방법론
hwicortex query "밸런싱 수치 곡선 공식" -c game-method --full --json -n 3

# UX 관련 방법론
hwicortex query "전투 UI 피드백 연출" -c game-method --full --json -n 3
```

### 의도(intent) 지정으로 검색 품질 향상

"밸런싱"처럼 모호한 키워드는 `--intent`로 맥락을 좁힌다:

```bash
hwicortex query "밸런싱" -c game-method --intent "전투 수치 DPS 밸런스" --full
hwicortex query "밸런싱" -c game-method --intent "게임 경제 인플레이션" --full
```

### 특정 문서 직접 조회

검색 결과에서 특정 문서를 전체 내용으로 보고 싶을 때:

```bash
hwicortex get "game-method/밸런싱/dps-곡선-설계.md" --full
hwicortex multi-get "game-method/전투시스템/*.md" --full
```

### SDK로 커스텀 에이전트 구축

웹앱, 디스코드 봇, Slack 봇 등에서 활용할 때:

```typescript
import { createStore } from "hwicortex";

const store = await createStore({
  dbPath: "~/.cache/qmd/index.sqlite",
});

// 기획서 작성 시 방법론 검색
async function searchMethodology(topic: string) {
  return store.search({
    query: topic,
    collection: "game-method",
    limit: 5,
  });
}

// 검색 결과를 LLM 프롬프트에 포함
const results = await searchMethodology("로그라이크 전투 밸런싱");
const context = results
  .map((r) => `### ${r.title}\n${r.content}`)
  .join("\n\n---\n\n");

const prompt = `
다음 게임기획 방법론 문서를 참조하여 기획서를 작성하세요.

${context}

요청: 로그라이크 전투 시스템 기획서
`;

// 이 prompt를 Claude API, OpenAI API 등에 전달
await store.close();
```

## 참고

- 문서가 많을수록 검색 품질이 높아진다. 최소 10개 이상의 방법론 문서를 권장한다.
- 마크다운 헤딩(`#`, `##`)을 잘 쓰면 청킹 품질이 올라간다. HwiCortex는 헤딩 경계를 우선적으로 청크 분할점으로 사용한다.
- 한국어 문서는 mecab-ko가 설치되어 있으면 형태소 분석이 적용되어 검색 정확도가 크게 향상된다.
- 문서 수정 후 `hwicortex update --embed`를 잊지 않는다.
