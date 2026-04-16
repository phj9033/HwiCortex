# HwiCortex

로컬 퍼스트 하이브리드 검색 + AI 세션 지식 추출 엔진.

프로젝트 문서(마크다운, PDF, 코드)를 BM25 + 벡터 + LLM 리랭킹으로 검색하고, AI 에이전트 세션에서 지식을 자동 추출하여 Obsidian 볼트에 축적한다. 모든 LLM 추론은 로컬에서 실행된다.

## 설치

```sh
git clone <repo-url> && cd hwicortex
bun install
bun run build
bun link          # 'hwicortex' 글로벌 등록
```

Node.js >= 22 또는 Bun >= 1.0 필요.

## 빠른 시작

```sh
# 컬렉션 등록 → 인덱싱 → 검색
hwicortex collection add ~/my-project --name myproject
hwicortex update
hwicortex query "인증 로직 어디 있지?"
```

## 검색

```sh
hwicortex query "주문 취소 로직"          # 하이브리드 (추천)
hwicortex search "cancelOrder"            # BM25 키워드 (빠름, LLM 불필요)
hwicortex vsearch "에러 처리 패턴"        # 벡터 유사도
```

벡터 검색을 쓰려면 임베딩 생성이 필요하다:

```sh
hwicortex pull     # 모델 다운로드
hwicortex embed    # 임베딩 생성
```

### 검색 옵션

```sh
-c, --collection <name>    # 특정 컬렉션만
-n <num>                   # 결과 수
--full                     # 전체 내용 출력
--json | --csv | --md | --xml | --files
--no-rerank                # 리랭킹 스킵 (빠름)
--intent <text>            # 검색 의도 힌트
```

## 문서 조회

```sh
hwicortex get src/auth/login.ts         # 경로로 조회
hwicortex get "#abc123"                 # 문서 ID로 조회
hwicortex multi-get "src/orders/*.ts"   # glob 패턴
hwicortex ls myproject                  # 컬렉션 파일 목록
```

## 컨텍스트

컬렉션에 설명을 달아 검색 품질을 높인다.

```sh
hwicortex context add qmd://myproject/ "Spring Boot 주문 관리 API"
hwicortex context add / "전역 컨텍스트"
hwicortex context list
hwicortex context check    # 컨텍스트 누락 확인
```

## 위키

Obsidian 호환 마크다운으로 지식을 저장하고 관리한다.

```sh
hwicortex wiki create "인증 설계" --project myproject --tags auth,design --body "내용"
hwicortex wiki update "인증 설계" --project myproject --append "추가 내용"
hwicortex wiki list --project myproject
hwicortex wiki show "인증 설계" --project myproject
```

위키 사용 시 `QMD_VAULT_DIR` 환경변수 설정 필요:

```sh
export QMD_VAULT_DIR=~/my-obsidian-vault
```

## 지식 추출

AI 세션에서 인사이트를 추출하여 볼트에 저장한다. 프로젝트 루트에 `hwicortex.yaml` 필요.

```sh
hwicortex ingest ./docs --name "기술문서" --pattern "*.md,*.pdf"
hwicortex extract --dry-run    # 예상 토큰/세션 수 확인
hwicortex extract              # 미처리 세션 일괄 추출
hwicortex watch                # 세션 종료 시 자동 추출
```

## 지식 루프 (Claude Code 스킬)

AI 대화에서 지식을 자동 추출하여 위키에 축적하고, 작업 전 관련 지식을 검색하여 참고하는 순환 루프. Claude Code 환경에서 스킬로 동작한다.

```sh
# 초기 설정: wiki vault를 컬렉션으로 등록
hwicortex collection add <vault>/wiki --name wiki --mask "**/*.md"
hwicortex update --embed
```

| 스킬 | 설명 |
|------|------|
| `/knowledge-pre` | 작업 시작 전 관련 위키 지식 검색 |
| `/knowledge-post` | 작업 완료 후 인사이트 자동 추출·저장 |
| `/knowledge-ingest` | 미처리 AI 세션 배치 처리 (사용자 문답) |
| `/knowledge-tidy` | 위키 정리 — 중복 병합, 링크 보강, 태그 통일 |

## SDK

라이브러리로 import하여 사용할 수 있다.

```typescript
import { createStore } from "hwicortex";

const store = await createStore({
  dbPath: "./index.sqlite",
  config: { collections: { docs: { path: "./docs", pattern: "**/*.md" } } },
});

const results = await store.search({ query: "auth flow" });
await store.close();
```

## 개발

```sh
bun src/cli/qmd.ts <command>               # 소스에서 직접 실행
bun run build                               # TypeScript → dist/
npx vitest run --reporter=verbose test/     # 테스트
```

## 주요 파일 위치

| 파일 | 경로 |
|------|------|
| SQLite 인덱스 | `~/.cache/qmd/index.sqlite` |
| LLM 모델 캐시 | `~/.cache/qmd/models/` |
| 프로젝트 설정 | `./hwicortex.yaml` |
| 위키 저장소 | `vault/wiki/{project}/` |

## 라이선스

MIT
