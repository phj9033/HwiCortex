# HwiCortex

Bun 사용 (`bun`, `bun install`, `bun run build`). Node.js/npm 사용 금지.

## 절대 하지 말 것

- SQLite DB 직접 수정 금지 (인덱스: `~/.cache/qmd/index.sqlite`)
- `bun build --compile` 금지 — sqlite-vec 깨짐. `bin/hwicortex`는 셸 래퍼이므로 교체 금지

## 빌드 & 테스트

```sh
bun install && bun run build    # TypeScript → dist/
bun link                        # 글로벌 CLI 등록
bun src/cli/qmd.ts <command>    # 소스에서 직접 실행 (빌드 불필요)
npx vitest run --reporter=verbose test/
```

## CLI

전체 명령/옵션은 `hwicortex --help` 또는 `hwicortex <command> --help` 참조. 진입점은 `src/cli/qmd.ts`.

## 아키텍처 요약

- **검색**: SQLite FTS5 (BM25) + sqlite-vec (벡터) + RRF + LLM 리랭킹
- **LLM**: node-llama-cpp 로컬 추론 (임베딩, 리랭킹, 쿼리확장)
- **청킹**: 900토큰/15% 오버랩, 마크다운 헤딩 경계 우선. `--chunk-strategy auto`로 tree-sitter AST 청킹
- **한국어**: mecab-ko 형태소 분석 (설치 시 자동 활성화)
- **위키**: Obsidian 호환 마크다운, importance/hit_count 자동 추적
- **지식 추출**: AI 세션 파싱 → LLM 기반 인사이트 추출 → 볼트 저장

SDK 진입점: `src/index.ts` → `dist/index.js` (사용 예시는 README 참조)

## 릴리스

`/release <version>` 사용. CHANGELOG은 `## [Unreleased]` 아래에 작업 중 기록.
상세: [skills/release/SKILL.md](skills/release/SKILL.md)

## 위키 제안 규칙

버그 원인/해법 확정, 아키텍처 결정, 재사용 가능한 절차 문서화 시 위키 저장 제안.
"정리해줘", "기록해줘" 등의 요청 시에도 제안. 자동 실행 금지 — 항상 승인 대기.
knowledge-post 스킬도 인사이트 목록을 보여준 후 사용자 승인을 받아 저장한다.

지식 루프 스킬: `/knowledge-pre`, `/knowledge-post`, `/knowledge-ingest`, `/knowledge-tidy` (vault 등록은 README 참조)
