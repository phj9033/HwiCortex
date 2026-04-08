# Wiki CLI Design Spec

Karpathy의 LLM Wiki 패턴을 HwiCortex CLI 기반으로 구현한다.
AI 에이전트가 스킬을 통해 CLI를 호출하여 위키를 관리하는 구조.

## 배경

- Karpathy LLM Wiki: "지식을 한 번 컴파일하고 계속 업데이트하는 위키"
- HwiCortex: 하이브리드 검색 엔진 (BM25 + 벡터 + 리랭킹)
- 보완 관계: HwiCortex가 위키의 검색 엔진 + 자동 인제스트 파이프라인 역할

## 설계 원칙

- **CLI-First**: `qmd wiki` 서브커맨드가 진입점. 스킬은 Bash로 호출하는 thin wrapper.
- **사용자가 큐레이터**: AI가 자동 실행하지 않고 제안만. 사용자 승인 후 실행.
- **Obsidian 호환**: `[[위키링크]]` + YAML frontmatter. vault 내 어디서든 Obsidian이 인식.
- **기존 인프라 재사용**: VaultWriter, FTS 인덱싱, 태그 저장 등 기존 코드 활용.

## 컬렉션 등록

`vault/wiki/` 디렉토리는 `wiki`라는 이름의 컬렉션으로 자동 등록된다.
- `qmd wiki create` 첫 실행 시 `wiki` 컬렉션이 없으면 자동 생성 (`collection add`)
- 위키 페이지 생성/수정 시 `insertDocument()` + `upsertFTS()`를 호출하여 즉시 인덱싱
- `qmd search -c wiki "쿼리"` 또는 `qmd query -c wiki "쿼리"`로 위키 전용 검색 가능
- vault 디렉토리가 없으면 `mkdirSync(recursive: true)`로 자동 생성

## 파일 구조

```
src/
├── wiki.ts              # 위키 라이브러리 (핵심 로직)
├── cli/
│   └── wiki.ts          # CLI 핸들러 (인자 파싱 → wiki.ts 호출)
vault/
└── wiki/                # 위키 전용 디렉토리 (knowledge/와 분리)
    └── {project}/
        └── {slug}.md
skills/
└── wiki-save/
    └── SKILL.md         # /wiki-save 슬래시 커맨드
```

---

## M1: Wiki CLI CRUD

### 위키 페이지 포맷

```markdown
---
title: JWT 인증 흐름
project: myapp
tags: [auth, jwt]
sources: [session-abc123]
related: []
created: 2026-04-08
updated: 2026-04-08
---

리프레시 토큰은 7일 만료로 설정한다.
액세스 토큰은 15분.
```

### CLI 커맨드

```bash
# 생성
qmd wiki create "JWT 인증 흐름" \
  --project myapp \
  --tags auth,jwt \
  --source session-abc123 \
  --body "리프레시 토큰은 7일 만료"

# 수정
qmd wiki update "JWT 인증 흐름" --append "액세스 토큰은 15분"
qmd wiki update "JWT 인증 흐름" --body "전체 내용 교체"
qmd wiki update "JWT 인증 흐름" --tags auth,jwt,token
qmd wiki update "JWT 인증 흐름" --add-source session-def456

# 삭제
qmd wiki rm "JWT 인증 흐름"

# 조회
qmd wiki list [--project myapp] [--tag auth]
qmd wiki show "JWT 인증 흐름"
qmd wiki show "JWT 인증 흐름" --json
```

### 핵심 동작

- **제목 → 파일명**: 기존 `classifier.ts`의 `toFileName()` 재사용. Unicode 문자(`\p{L}`) 보존, 한글 유지. (`JWT 인증 흐름` → `jwt-인증-흐름.md`)
- **slug 충돌**: 동일 제목(= 동일 slug)이 존재하면 `create`는 에러 반환 + `update` 사용 안내.
- **생성 시**: atomic write (공유 유틸리티로 추출). `insertDocument()` + `upsertFTS()` 호출. 태그는 `JSON.stringify(tags)`로 변환하여 DB 저장.
- **수정 시**: frontmatter 파싱 → 필드 업데이트 → `updated:` 갱신 → atomic write → FTS 재인덱싱.
- **삭제 시**: 파일 삭제 + DB에서 `active=0` 처리.
- **`--project` 미지정 시**: vault config에서 default project 설정값 사용. 없으면 필수 인자로 에러.
- **`--stdin` 지원**: `echo "내용" | qmd wiki create "제목" --stdin` 으로 파이프 입력. 스킬에서 긴 본문 전달 시 사용.

### `src/wiki.ts` 주요 함수

```typescript
createWikiPage(opts: { title, project, tags?, sources?, body? }): string
updateWikiPage(title: string, opts: { append?, body?, tags?, addSource? }): void
removeWikiPage(title: string): void
listWikiPages(filter?: { project?, tag? }): WikiPageMeta[]
getWikiPage(title: string): WikiPage
resolveWikiPath(title: string, project?: string): string
```

### 재사용 코드

- `atomicWrite()` — VaultWriter에서 공유 유틸리티(`src/utils/fs.ts`)로 추출하여 재사용
- `classifier.toFileName()` — slug 생성
- `store.insertDocument()` + `store.upsertFTS()` — FTS 인덱싱 (태그는 JSON.stringify)
- CLI switch-case 패턴 (`src/cli/qmd.ts`)

---

## M2: 교차 참조 + 인덱스

### CLI 커맨드

```bash
# 링크 (양방향)
qmd wiki link "JWT 인증" "세션 관리"
qmd wiki unlink "JWT 인증" "세션 관리"

# 연결 조회
qmd wiki links "JWT 인증"

# 인덱스 생성
qmd wiki index [--project myapp]
qmd wiki index --all
```

### 위키링크 동작

`qmd wiki link "JWT 인증" "세션 관리"` 실행 시:

1. 대상 파일의 frontmatter `related:[]`에 상대방 추가 (양쪽 모두)
2. 본문 끝의 `## 관련 문서` 섹션 재생성 (양쪽 모두)

```markdown
---
related: [세션 관리, OAuth 2.0]
---

(본문 내용)

## 관련 문서
- [[세션 관리]]
- [[OAuth 2.0]]
```

### 규칙

- `related:` frontmatter가 source of truth
- `## 관련 문서` 섹션은 `related:`에서 매번 재생성 (자동 관리 영역)
- 섹션 감지: 파일 끝의 마지막 `## 관련 문서` 헤딩부터 EOF까지를 교체 범위로 한정
- 사용자가 본문 중간에 `[[링크]]`를 직접 쓰는 것은 허용 (건드리지 않음)
- `--append` 시 삽입 위치: `## 관련 문서` 섹션 직전. 해당 섹션이 없으면 파일 끝.

### 백링크 탐색

`qmd wiki links`는 두 가지를 표시:

1. **related** (명시적): frontmatter `related:[]`에 있는 것
2. **backlinks** (compute-on-read): FTS 인덱스에서 `[[페이지 제목]]` 검색 (`searchLex`). 파일 시스템 스캔이 아닌 FTS 기반으로 성능 확보.

### 인덱스 생성

`qmd wiki index --project myapp` → `vault/wiki/myapp/_index.md`:

```markdown
---
title: myapp 위키 인덱스
generated: 2026-04-08
---

# myapp

## auth
- [[JWT 인증 흐름]] — 리프레시 토큰 7일, 액세스 15분
- [[OAuth 2.0 설정]] — Google, GitHub 프로바이더

## infra
- [[배포 파이프라인]] — GitHub Actions + Docker
```

- 태그별 그룹핑 (태그가 섹션 헤더)
- 각 페이지: `[[제목]]` + 본문 첫 줄 요약
- `generated:` 타임스탬프, 재생성 시 덮어쓰기

### `src/wiki.ts` 추가 함수

```typescript
linkPages(titleA: string, titleB: string): void
unlinkPages(titleA: string, titleB: string): void
getLinks(title: string): { related: string[], backlinks: string[] }
generateIndex(project?: string): string
scanBacklinks(title: string): string[]
syncRelatedSection(filePath: string): void
```

---

## M3: 스킬 통합 + AI 제안

### `/wiki-save` 스킬

사용자가 `/wiki-save` 호출 시:

1. 대화 컨텍스트에서 핵심 지식 식별
2. 기존 위키 중복 확인: `qmd wiki list` + `qmd search "제목"`
3. 중복이면 `qmd wiki update`, 신규면 `qmd wiki create` 제안
4. 사용자 승인 후 Bash로 실행
5. 관련 페이지가 있으면 `qmd wiki link` 제안

```
사용자: /wiki-save
AI: 이 대화에서 다음 내용을 위키에 저장하겠습니다:

  제목: JWT 리프레시 토큰 갱신 로직
  프로젝트: myapp
  태그: auth, jwt, token-refresh
  본문:
    리프레시 토큰은 7일 만료...

  저장할까요?

사용자: ㅇㅇ
AI: → qmd wiki create "JWT 리프레시 토큰 갱신 로직" --project myapp ...
```

### AI 제안 가이드라인

CLAUDE.md에 추가. 스킬이 아닌 가이드라인으로 구현:

```markdown
## Wiki 제안 가이드라인

대화 중 다음 상황이 감지되면 위키 저장을 제안하세요:
- 버그 원인과 해결책이 확정되었을 때
- 아키텍처 결정이 내려졌을 때
- 반복적으로 참조될 설정/절차가 정리되었을 때
- 사용자가 "정리해줘", "기록해줘" 등 표현을 쓸 때

제안 형식:
> 이 내용을 위키에 기록해두면 좋을 것 같습니다. `/wiki-save`로 저장할까요?

자동 실행하지 말 것. 항상 사용자 승인 후 실행.
```

### 기존 스킬 업데이트

`skills/qmd/SKILL.md`에 wiki 커맨드 레퍼런스 추가.

---

## 기존 코드 재사용 맵

| 신규 기능 | 재사용 대상 | 방식 |
|----------|------------|------|
| 파일 생성/수정 | `VaultWriter` | `writeWikiPage()` 메서드 추가 |
| FTS 인덱싱 | `store.insertDocument()` + `upsertFTS()` | 그대로 호출 |
| 태그 저장 | `documents.tags` 컬럼 | 기존 스키마 사용 |
| 출처 기록 | frontmatter `sources:[]` | VaultWriter 패턴 |
| CLI 패턴 | `src/cli/qmd.ts` switch-case | 동일 패턴 |
| 백링크 스캔 | `store.searchLex()` | FTS로 `[[제목]]` 패턴 검색 |
| slug 생성 | `classifier.toFileName()` | Unicode 보존 kebab-case |

## 신규 구현 필요

| 기능 | 파일 | 설명 |
|------|------|------|
| 위키 핵심 로직 | `src/wiki.ts` | CRUD + 링크 + 인덱스 |
| CLI 핸들러 | `src/cli/wiki.ts` | 인자 파싱, wiki.ts 호출 |
| 위키링크 파싱 | `src/wiki.ts` | `[[링크]]` 생성/스캔 |
| 인덱스 생성 | `src/wiki.ts` | 태그별 그룹핑, _index.md |
| /wiki-save 스킬 | `skills/wiki-save/SKILL.md` | 슬래시 커맨드 정의 |
| CLAUDE.md 가이드라인 | `CLAUDE.md` | 제안 트리거 조건 |

## DB 스키마 변경

없음. `related:`는 frontmatter에만 저장. 기존 `documents` 테이블로 충분.

## 리팩터 필요 사항

- `VaultWriter.atomicWrite()`를 `src/utils/fs.ts`로 추출 (현재 private). VaultWriter와 wiki.ts 양쪽에서 사용.
- `classifier.toFileName()`을 wiki.ts에서도 import하여 slug 생성에 재사용.
