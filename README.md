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

### 한국어 검색 (선택)

한국어 형태소 분석을 통한 BM25 품질 향상을 위해 `mecab-ko`를 설치한다. 미설치 시에도 동작하지만 한국어 검색 품질이 제한된다.

```sh
# macOS
brew install mecab mecab-ko-dic

# Ubuntu / Debian
sudo apt install mecab libmecab-dev
install-mecab-ko-dic
```

설치 후 기존 인덱스를 재구축해야 한국어 토큰화가 적용된다:

```sh
hwicortex rebuild
```

설치 여부는 `which mecab`으로 확인할 수 있다. 첫 실행 시 미설치 상태면 안내 메시지가 한 번 출력된다.

## 환경 설정

설치 직후 한 번만 잡아두면 되는 항목들. 셸 rc 파일(`~/.zshrc`, `~/.bashrc` 등)에 넣어 영구화하는 것을 권장한다.

### `QMD_VAULT_DIR` (위키·대시보드·지식 추출에 필수)

위키 페이지 저장 위치, 대시보드의 위키 패널, 지식 추출 결과 출력 경로의 기준이 된다. 위키나 대시보드를 쓸 계획이면 **반드시 먼저** 지정해야 한다. 위키 마크다운은 자동으로 `$QMD_VAULT_DIR/wiki/{project}/*.md` 레이아웃을 따른다.

```sh
export QMD_VAULT_DIR=~/my-obsidian-vault
```

설정 후 `hwicortex update`를 한 번 돌리면 vault에 이미 들어있는 위키 페이지가 자동으로 인덱싱된다 (별도 `collection add` 불필요).

### LLM 모델 다운로드

벡터 검색·리랭킹·쿼리 확장에 필요한 로컬 모델을 받는다. 한 번만 실행하면 `~/.cache/qmd/models/`에 캐시된다.

```sh
hwicortex pull
```

BM25 키워드 검색만 쓸 거면 모델 없이도 동작하지만, `query`/`vsearch`/`embed` 등은 모델이 필요하다.

### (선택) 설정 파일 위치 변경

| 환경변수 | 기본값 | 용도 |
|----------|--------|------|
| `XDG_CONFIG_HOME` | `~/.config` | 컬렉션 등록 YAML 디렉터리 (`$XDG_CONFIG_HOME/qmd/index.yml`) |
| `INDEX_PATH` | `~/.cache/qmd/index.sqlite` | SQLite 인덱스 위치 (테스트·다중 인덱스용) |
| `QMD_CONFIG_DIR` | `~/.config/qmd` | YAML 디렉터리 직접 지정 (테스트용 오버라이드) |

대부분 기본값으로 충분하다.

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

벡터 검색을 쓰려면 모델 다운로드(`pull` — [환경 설정 참조](#llm-모델-다운로드)) 후 임베딩 생성:

```sh
hwicortex embed
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
hwicortex context rm qmd://myproject/
```

## 위키

Obsidian 호환 마크다운으로 지식을 저장하고 관리한다. (사전 설정: [환경 설정 → `QMD_VAULT_DIR`](#qmd_vault_dir-위키대시보드지식-추출에-필수))

```sh
hwicortex wiki create "인증 설계" --project myproject --tags auth,design --body "내용"
hwicortex wiki update "인증 설계" --project myproject --append "추가 내용"
hwicortex wiki list --project myproject
hwicortex wiki show "인증 설계" --project myproject
```

`hwicortex update`는 `$QMD_VAULT_DIR/wiki/`가 있으면 위키 vault를 자동으로 컬렉션(`name=wiki`)으로 등록·인덱싱한다. 별도의 `collection add`는 불필요하며, `wiki create/update/rm`은 작성 즉시 FTS 인덱스를 갱신한다. 벡터 검색에 포함시키려면 `update --embed` 또는 별도 `embed`를 실행한다.

## 대시보드

브라우저에서 컬렉션·위키·검색을 한눈에 본다. 로컬 전용, 외부 통신 없음. (사전 설정: [환경 설정 → `QMD_VAULT_DIR`](#qmd_vault_dir-위키대시보드지식-추출에-필수))

```sh
hwicortex dashboard                  # 기본 포트 7777, 브라우저 자동 오픈
hwicortex dashboard --port 8080      # 포트 변경
hwicortex dashboard --no-open        # 브라우저 자동 오픈 비활성화
```

| 탭 | 내용 |
|----|------|
| **Overview** | 볼트 메타(컬렉션·위키 프로젝트·문서 수), 헬스 알림(겹침/컨텍스트 누락/임베딩 누락 등), 컬렉션 카드와 위키 요약(Recent / Top Hits / High Importance)을 좌우 패널로 |
| **Tags** | 위키 페이지 태그 빈도. 클릭하면 해당 태그로 검색 |
| **Help** | Collection vs Wiki 구분, 5가지 헬스 알림 코드, 자주 쓰는 CLI, 단축키 등 한국어 레퍼런스 |

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

`QMD_VAULT_DIR`을 [환경 설정](#qmd_vault_dir-위키대시보드지식-추출에-필수)에서 잡아둔 뒤:

```sh
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

## Research-to-Draft 파이프라인

웹/arXiv/RSS/문서에서 출처를 수집하고, Haiku로 카드를 만들고, Sonnet으로 합성 노트와 인용을 갖춘 초안까지 자동 생성한다. 모든 산출물은 vault에 마크다운으로 저장되며, hwicortex 검색 인덱스로 다시 검색·인용할 수 있다.

```sh
# 1. 토픽 신규 생성 (또는 기존 토픽 사용)
hwicortex research topic new rag-eval --from-prompt "Evaluating RAG systems"

# 2. 자료 수집 + 카드 생성 (Haiku)
hwicortex research fetch rag-eval --max-new 20

# 3. subtopic 클러스터링 + 합성 노트 (Sonnet)
hwicortex research synthesize rag-eval

# 4. RAG 컨텍스트 기반 초안 작성 (Sonnet)
hwicortex research draft rag-eval --prompt "Survey current RAG evaluation methods" --style report

# 결과: <vault>/research/drafts/rag-eval/<YYYY-MM-DD>-survey-current-rag-evaluation.md
```

상태 확인은 `hwicortex research status <topic-id>`. 에이전트 통합용 도구 정의는 `import { research } from "hwicortex"`로 노출된다 (`research.researchTools`, `research.executeResearchTool`). 슬래시 스킬: `/research-pre`, `/research-build`, `/research-draft`, `/research-tidy`.

외부 AI 에이전트 / MCP 호스트가 이 CLI를 자식 프로세스로 호출하는 경우 가이드: [`docs/research/agent-guide.md`](docs/research/agent-guide.md).

설계 문서: `docs/superpowers/plans/2026-04-30-research-to-draft.md`.

## 개발

```sh
bun src/cli/qmd.ts <command>               # 소스에서 직접 실행
bun run build                               # TypeScript → dist/
npx vitest run --reporter=verbose test/     # 테스트
```

## 주요 파일 위치

| 파일 | 경로 | 용도 |
|------|------|------|
| SQLite 인덱스 | `~/.cache/qmd/index.sqlite` | FTS5 + 벡터 인덱스. `cleanup --reset`으로 삭제 가능 |
| LLM 모델 캐시 | `~/.cache/qmd/models/` | `pull`로 다운로드한 임베딩·리랭킹·생성 모델 |
| 컬렉션 등록 | `~/.config/qmd/index.yml` | `collection add`로 등록한 글로벌 설정. `cleanup --reset`이 함께 삭제 |
| 지식 추출 설정 | `./hwicortex.yaml` | `extract`/`ingest`/`watch`/`rebuild`용 프로젝트 로컬 설정 (vault 경로, watch_dirs 등) |
| 위키 저장소 | `$QMD_VAULT_DIR/wiki/{project}/` | 위키 마크다운 본체 (사용자 데이터). 시스템이 자동 삭제하지 않음 |

`cleanup --reset --yes`는 SQLite 인덱스와 컬렉션 등록 YAML만 함께 삭제한다. 위키 마크다운, 모델 캐시, `./hwicortex.yaml`은 보존된다.

## 라이선스

MIT
