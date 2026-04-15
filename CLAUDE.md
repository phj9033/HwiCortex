# HwiCortex

Bun 사용 (`bun`, `bun install`, `bun run build`). Node.js/npm 사용 금지.

## 절대 하지 말 것

- `hwicortex collection add`, `hwicortex embed`, `hwicortex update`, `hwicortex extract` 자동 실행 금지 — 예시 명령어만 제시
- SQLite DB 직접 수정 금지 (인덱스: `~/.cache/qmd/index.sqlite`)
- `bun build --compile` 금지 — sqlite-vec 깨짐. `bin/hwicortex`는 셸 래퍼이므로 교체 금지

## 빌드 & 테스트

```sh
bun install && bun run build    # TypeScript → dist/
bun link                        # 글로벌 CLI 등록
bun src/cli/qmd.ts <command>    # 소스에서 직접 실행 (빌드 불필요)
npx vitest run --reporter=verbose test/
```

## CLI 레퍼런스

```sh
# 컬렉션
collection add <path> --name <n> [--mask <glob>]
collection list | remove <name> | rename <old> <new>
ls [collection[/path]]

# 검색
query <query>           # 하이브리드 (확장 + BM25 + 벡터 + 리랭킹)
search <query>          # BM25 키워드 (LLM 불필요)
vsearch <query>         # 벡터 유사도

# 조회
get <file|#docid>       # 단일 문서
multi-get <pattern>     # 복수 문서 (glob 또는 쉼표 구분)

# 인덱스
status | update [--pull] | embed | pull | cleanup

# 컨텍스트
context add [path] "text" | context list | context check | context rm <path>

# 코드 그래프
graph <file> | path <A> <B> | related <file> | symbol <name>
graph clusters [--collection <n>] [--kind code|doc]
graph --obsidian

# 위키
wiki create "제목" --project <n> [--tags t1,t2] [--body "..."]
wiki update | show | rm | list | link | unlink | links | index | reset-importance

# 지식 추출
ingest <path> [--name <n>] [--pattern <p>]
extract [--session <id>] [--dry-run]
watch
rebuild
```

### 자주 쓰는 옵션

```sh
-c, --collection <name>   # 특정 컬렉션만
-n <num>                  # 결과 수
--full                    # 전체 내용
--json | --csv | --md | --xml | --files
--no-graph                # 그래프 컨텍스트 제외
--line-numbers            # 줄번호
--intent <text>           # 검색 의도 힌트
```

## 아키텍처 요약

- **검색**: SQLite FTS5 (BM25) + sqlite-vec (벡터) + RRF + LLM 리랭킹
- **LLM**: node-llama-cpp 로컬 추론 (임베딩, 리랭킹, 쿼리확장)
- **청킹**: 900토큰/15% 오버랩, 마크다운 헤딩 경계 우선. `--chunk-strategy auto`로 tree-sitter AST 청킹
- **한국어**: mecab-ko 형태소 분석 (설치 시 자동 활성화)
- **그래프**: tree-sitter AST 기반 심볼/관계 추출 → label propagation 클러스터링
- **위키**: Obsidian 호환 마크다운, importance/hit_count 자동 추적
- **지식 추출**: AI 세션 파싱 → LLM 기반 인사이트 추출 → 볼트 저장

## SDK

```typescript
import { createStore } from "hwicortex";
const store = await createStore({ dbPath: "./index.sqlite", config: { collections: { docs: { path: "./docs", pattern: "**/*.md" } } } });
const results = await store.search({ query: "auth flow" });
await store.close();
```

진입점: `src/index.ts` → `dist/index.js`

## 릴리스

`/release <version>` 사용. CHANGELOG은 `## [Unreleased]` 아래에 작업 중 기록.
상세: [skills/release/SKILL.md](skills/release/SKILL.md)

## 위키 제안 규칙

버그 원인/해법 확정, 아키텍처 결정, 재사용 가능한 절차 문서화 시 위키 저장 제안.
"정리해줘", "기록해줘" 등의 요청 시에도 제안. 자동 실행 금지 — 항상 승인 대기.
