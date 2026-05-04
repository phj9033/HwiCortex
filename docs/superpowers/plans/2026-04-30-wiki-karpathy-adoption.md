# Wiki: Karpathy LLM-Wiki 아이디어 흡수 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Karpathy의 LLM-Wiki gist (https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) 에서 HwiCortex 철학(승인 게이트, CLI 프리미티브, 한국어 지원)과 정합하는 5개 아이디어를 흡수한다 — `description` 필드 + `_index.md` 개선, `kind:` 옵셔널 분류, `_log.md` 활동 로그, knowledge-tidy의 노후·모순 검사, knowledge-post/ingest의 멀티페이지 갱신 제안.

**Architecture:**
- **Phase A–C는 코드 변경** (`src/wiki.ts`, `src/cli/wiki.ts`, 새 파일 `src/wiki-log.ts`). frontmatter는 옵셔널 필드로 추가하여 기존 페이지와 100% 하위 호환. `_log.md`는 append-only, atomicWrite 대신 OS-level append 사용 (한 줄 단위 entry).
- **Phase D–E는 스킬 문서 변경**(`skills/knowledge-tidy/SKILL.md`, `skills/knowledge-post/SKILL.md`, `skills/knowledge-ingest/SKILL.md`)에 새 단계 추가. 코드 변경은 D의 `wiki list --stale-days N` CLI 플래그 1건 뿐.
- **승인 게이트 보존**: 모든 신규 동작은 사용자 승인 후 실행. 자동 실행 금지 (CLAUDE.md 정책 유지).

**Tech Stack:** Bun, TypeScript, vitest, SQLite (FTS5 + sqlite-vec), 마크다운 + YAML frontmatter, Obsidian 호환

**Build/Test 명령:**
```sh
bun install && bun run build                                       # TS → dist/
bun src/cli/qmd.ts <command>                                       # 소스 직접 실행 (build 없이)
npx vitest run --reporter=verbose test/                            # 전체 테스트
npx vitest run --reporter=verbose test/wiki.test.ts                # 단위 테스트
npx vitest run --reporter=verbose test/wiki-cli.test.ts            # CLI 통합
```

**중요 제약 (CLAUDE.md 발췌):**
- `bun build --compile` 금지 (sqlite-vec 깨짐)
- `bin/hwicortex`는 셸 래퍼이므로 교체 금지
- `hwicortex collection add/embed/update/extract` 자동 실행 금지 — plan 안에서도 예시만 제시
- SQLite DB(`~/.cache/qmd/index.sqlite`) 직접 수정 금지
- 모든 인자 누락 시 즉시 종료 (exit 2)
- 자동 저장/실행 금지 — 사용자 승인 게이트 유지

---

## File Structure

### 새로 생성
- `src/wiki-log.ts` — `_log.md` append helper (Phase C)
- `test/wiki-log.test.ts` — wiki-log 단위 테스트 (Phase C)

### 수정
- `src/wiki.ts`
  - `WikiMeta` 타입: `description?: string`, `kind?: string` 추가 (Phase A)
  - `buildFrontmatter`, `parseFrontmatter` 확장 (Phase A)
  - `createWikiPage`, `updateWikiPage`: `description`/`kind` 옵션 + `appendWikiLog` 호출 (Phase A, C)
  - `mergeIntoPage`, `removeWikiPage`, `linkPages`: `appendWikiLog` 호출 (Phase C)
  - `generateIndex`: description 우선 사용 (Phase B)
  - `listWikiPages`: `staleDays` 필터 추가 (Phase D)
- `src/cli/wiki.ts`
  - `wiki create`/`update`: `--description`, `--kind` 플래그 (Phase A)
  - `wiki list`: `--stale-days N` 플래그 (Phase D)
  - usage 메시지 갱신 (Phase A, D)
- `test/wiki.test.ts` — frontmatter, generateIndex, listWikiPages 추가 테스트
- `test/wiki-cli.test.ts` — 새 CLI 플래그 통합 테스트
- `skills/knowledge-tidy/SKILL.md` — (E) 노후 검사, (F) 모순 후보 섹션 추가 (Phase D)
- `skills/knowledge-post/SKILL.md` — 멀티페이지 갱신 제안 단계 추가 (Phase E)
- `skills/knowledge-ingest/SKILL.md` — 멀티페이지 갱신 제안 단계 추가 (Phase E)
- `CLAUDE.md` — `_log.md` 재생성 금지 1줄 추가 (Phase C)
- `CHANGELOG.md` — `## [Unreleased]` 항목 추가 (Phase F)

### 손대지 않는 것
- `bin/hwicortex` (셸 래퍼)
- `src/store.ts` (FTS/벡터/RRF 로직)
- `src/knowledge/extractor.ts` (별개 코드 경로 — 스킬은 LLM 추출이라 코드 변경 불필요)
- 마이그레이션 (옵셔널 필드라 기존 파일 그대로 동작)

---

## Phase 0: Baseline 확인

### Task 0: 베이스라인 테스트와 작업 브랜치 확인

**Files:** 없음 (확인만)

- [ ] **Step 1: 현재 브랜치/상태 확인**

```sh
git status
git log -3 --oneline
```

Expected: `main` 브랜치, untracked `docs/` 외에 변경 없음. (이 plan 파일이 untracked로 보일 수 있음 — OK)

- [ ] **Step 2: 빌드 + 테스트 통과 확인 (베이스라인)**

```sh
bun install && bun run build
npx vitest run --reporter=verbose test/wiki.test.ts test/wiki-cli.test.ts
```

Expected: 모든 wiki 관련 테스트 PASS. 실패가 있으면 plan 진행 전에 보고하고 멈출 것.

- [ ] **Step 3: 현재 _index.md 동작 샘플 확인**

```sh
QMD_VAULT_DIR=$(mktemp -d) bun src/cli/qmd.ts wiki create "Sample" --project demo --body "# 헤딩 줄\n실제 내용"
QMD_VAULT_DIR=<위 경로> bun src/cli/qmd.ts wiki index --project demo
cat <위 경로>/wiki/demo/_index.md
```

Expected: `- [[Sample]] — # 헤딩 줄` 같이 헤딩 첫 줄이 요약으로 들어가는 현재 한계 확인 (Phase B에서 고침). **임시 디렉토리 삭제 잊지 말 것.**

---

## Phase A: Frontmatter 확장 (`description`, `kind`)

**Goal:** 옵셔널 frontmatter 필드 2개 추가. 기존 페이지와 100% 하위 호환.

**Why both at once:** 둘 다 동일 위치(WikiMeta, build/parse, CLI flags)를 만지므로 묶어서 처리. 분리하면 같은 파일을 두 번 건드림.

**Files:**
- Modify: `src/wiki.ts:31-49` (WikiMeta 타입)
- Modify: `src/wiki.ts:58-99` (buildFrontmatter)
- Modify: `src/wiki.ts:179-229` (parseFrontmatter)
- Modify: `src/wiki.ts:343-389` (createWikiPage + CreateOpts)
- Modify: `src/wiki.ts:438-477` (updateWikiPage + UpdateOpts)
- Modify: `src/cli/wiki.ts:60-136` (create/update 핸들러)
- Test: `test/wiki.test.ts` (build/parse 라운드트립)
- Test: `test/wiki-cli.test.ts` (CLI 플래그 통합)

### Task A1: WikiMeta 타입 확장 + 라운드트립 테스트 (실패) 작성

- [ ] **Step 1: 실패하는 테스트 작성 (`test/wiki.test.ts`)**

`describe("buildFrontmatter")` 블록 끝(현재 wiki.test.ts:115 근처)에 추가:

```ts
test("emits description and kind when set", () => {
  const fm = buildFrontmatter({
    title: "T",
    project: "p",
    tags: [],
    sources: [],
    related: [],
    description: "한 줄 요약",
    kind: "decision",
  });
  expect(fm).toContain("description: 한 줄 요약");
  expect(fm).toContain("kind: decision");
});

test("omits description and kind when not set", () => {
  const fm = buildFrontmatter({
    title: "T",
    project: "p",
    tags: [],
    sources: [],
    related: [],
  });
  expect(fm).not.toContain("description:");
  expect(fm).not.toContain("kind:");
});
```

`describe("parseFrontmatter")` 블록에도 추가:

```ts
test("parses description and kind", () => {
  const md = `---
title: T
project: p
tags: []
sources: []
related: []
description: 한 줄 요약
kind: howto
created: 2026-04-01
updated: 2026-04-01
---
body`;
  const { meta } = parseFrontmatter(md);
  expect(meta.description).toBe("한 줄 요약");
  expect(meta.kind).toBe("howto");
});

test("description and kind default to undefined when absent", () => {
  const md = `---
title: T
project: p
tags: []
sources: []
related: []
created: 2026-04-01
updated: 2026-04-01
---
body`;
  const { meta } = parseFrontmatter(md);
  expect(meta.description).toBeUndefined();
  expect(meta.kind).toBeUndefined();
});
```

- [ ] **Step 2: 테스트 실패 확인**

```sh
npx vitest run --reporter=verbose test/wiki.test.ts -t "description"
```

Expected: TS 컴파일 에러 또는 `description`/`kind` 미존재로 FAIL.

- [ ] **Step 3: WikiMeta 타입 확장 (`src/wiki.ts:31`)**

```ts
export type WikiMeta = {
  title: string;
  project: string;
  tags: string[];
  sources: string[];
  related: string[];
  count_show: number;
  count_append: number;
  count_update: number;
  count_link: number;
  count_merge: number;
  count_search_hit: number;
  count_query_hit: number;
  importance: number;
  hit_count: number;
  last_accessed: string;
  description?: string;   // ← 추가: 한 줄 요약 (_index.md 에서 사용)
  kind?: string;          // ← 추가: 옵셔널 페이지 분류 (decision/howto/incident/concept/reference 등)
  created?: string;
  updated?: string;
};
```

- [ ] **Step 4: `buildFrontmatter` 확장 (src/wiki.ts:58)**

`last_accessed` 출력 직후, `created` 직전에 삽입:

```ts
  if (meta.last_accessed) {
    lines.push(`last_accessed: ${meta.last_accessed}`);
  }

  // ← 추가
  if (meta.description) {
    lines.push(`description: ${meta.description}`);
  }
  if (meta.kind) {
    lines.push(`kind: ${meta.kind}`);
  }
  // 추가 끝 →

  lines.push(`created: ${created}`);
```

- [ ] **Step 5: `parseFrontmatter` 확장 (src/wiki.ts:207-228)**

리턴 객체의 `meta` 안에 두 줄 추가:

```ts
  return {
    meta: {
      // ... 기존 필드들
      last_accessed: get("last_accessed"),
      description: get("description") || undefined,   // ← 추가
      kind: get("kind") || undefined,                  // ← 추가
      created: get("created"),
      updated: get("updated"),
    },
    body,
  };
```

> 이유: `get()`는 필드 없으면 빈 문자열 반환. 옵셔널 의미를 살리려면 빈 문자열 → undefined.

- [ ] **Step 6: 테스트 통과 확인**

```sh
npx vitest run --reporter=verbose test/wiki.test.ts -t "description"
```

Expected: 4 tests PASS.

- [ ] **Step 7: 커밋**

```sh
git add src/wiki.ts test/wiki.test.ts
git commit -m "feat(wiki): add optional description and kind frontmatter fields"
```

### Task A2: createWikiPage / updateWikiPage 옵션 확장

- [ ] **Step 1: 실패 테스트 작성 (`test/wiki.test.ts`, `describe("createWikiPage")` 블록 안)**

```ts
test("createWikiPage stores description and kind in frontmatter", async () => {
  const vault = mkdtempSync(join(tmpdir(), "wiki-create-meta-"));
  try {
    await createWikiPage(vault, {
      title: "API 설계",
      project: "p",
      description: "리트라이 정책 결정 기록",
      kind: "decision",
    });
    const page = getWikiPage(vault, "API 설계", "p");
    expect(page.meta.description).toBe("리트라이 정책 결정 기록");
    expect(page.meta.kind).toBe("decision");
  } finally {
    rmSync(vault, { recursive: true });
  }
});

test("updateWikiPage can change description and kind", async () => {
  const vault = mkdtempSync(join(tmpdir(), "wiki-update-meta-"));
  try {
    await createWikiPage(vault, { title: "T", project: "p" });
    await updateWikiPage(vault, "T", "p", {
      description: "갱신된 요약",
      kind: "howto",
    });
    const page = getWikiPage(vault, "T", "p");
    expect(page.meta.description).toBe("갱신된 요약");
    expect(page.meta.kind).toBe("howto");
  } finally {
    rmSync(vault, { recursive: true });
  }
});
```

- [ ] **Step 2: 테스트 실패 확인**

```sh
npx vitest run --reporter=verbose test/wiki.test.ts -t "createWikiPage stores description"
```

Expected: TS 컴파일 에러 (옵션 타입에 description/kind 없음).

- [ ] **Step 3: `CreateOpts` 확장 (src/wiki.ts:343)**

```ts
export type CreateOpts = {
  title: string;
  project: string;
  tags?: string[];
  sources?: string[];
  body?: string;
  description?: string;   // ← 추가
  kind?: string;           // ← 추가
  store?: Store;
};
```

- [ ] **Step 4: `createWikiPage` 본문에 description/kind 전달 (src/wiki.ts:361-377)**

`buildFrontmatter` 호출 안에 두 필드 추가. **기존 7개 count 필드를 절대 줄이지 말 것** — 모두 그대로 유지하고 description/kind만 끝에 추가:

```ts
  const fm = buildFrontmatter({
    title: opts.title,
    project: opts.project,
    tags: opts.tags ?? [],
    sources: opts.sources ?? [],
    related: [],
    count_show: 0,
    count_append: 0,
    count_update: 0,
    count_link: 0,
    count_merge: 0,
    count_search_hit: 0,
    count_query_hit: 0,
    importance: 0,
    hit_count: 0,
    last_accessed: "",
    description: opts.description,   // ← 추가
    kind: opts.kind,                  // ← 추가
  });
```

- [ ] **Step 5: `UpdateOpts` 확장 (src/wiki.ts:438)**

```ts
export type UpdateOpts = {
  append?: string;
  body?: string;
  tags?: string[];
  addSource?: string;
  description?: string;   // ← 추가 (undefined = 변경 없음, "" = 빈 문자열로 설정 — 빈문자열은 frontmatter에서 omit)
  kind?: string;           // ← 추가
  store?: Store;
};
```

- [ ] **Step 6: `updateWikiPage` 본문에 처리 추가 (src/wiki.ts:451 근처)**

기존 tags 처리 직후에 추가:

```ts
  if (opts.tags) meta.tags = opts.tags;
  if (opts.addSource && !meta.sources.includes(opts.addSource)) {
    meta.sources = [...meta.sources, opts.addSource];
  }
  // ← 추가
  if (opts.description !== undefined) {
    meta.description = opts.description || undefined;
  }
  if (opts.kind !== undefined) {
    meta.kind = opts.kind || undefined;
  }
  // 추가 끝 →
  meta.updated = new Date().toISOString().slice(0, 10);
```

> 의미: 빈 문자열을 명시적으로 넘기면 필드 제거(undefined). 미지정(undefined)은 변경 없음.

- [ ] **Step 7: 테스트 통과 확인**

```sh
npx vitest run --reporter=verbose test/wiki.test.ts -t "Wiki|createWikiPage|updateWikiPage"
```

Expected: 모든 wiki.ts 단위 테스트 PASS.

- [ ] **Step 8: 커밋**

```sh
git add src/wiki.ts test/wiki.test.ts
git commit -m "feat(wiki): support description/kind in createWikiPage and updateWikiPage"
```

### Task A3: CLI 플래그 추가 (`--description`, `--kind`)

- [ ] **Step 1: 실패 테스트 작성 (`test/wiki-cli.test.ts`, `describe("qmd wiki CLI")` 블록 끝)**

```ts
test("create accepts --description and --kind flags", () => {
  qmd('wiki create "T" --project p --description "한 줄 요약" --kind decision', vaultDir);
  const json = qmd('wiki show "T" --project p --json', vaultDir);
  const meta = JSON.parse(json);
  expect(meta.description).toBe("한 줄 요약");
  expect(meta.kind).toBe("decision");
});

test("update can change description and kind", () => {
  qmd('wiki create "T" --project p --description "old" --kind concept', vaultDir);
  qmd('wiki update "T" --project p --description "new" --kind decision --no-count', vaultDir);
  const json = qmd('wiki show "T" --project p --json --no-count', vaultDir);
  const meta = JSON.parse(json);
  expect(meta.description).toBe("new");
  expect(meta.kind).toBe("decision");
});
```

- [ ] **Step 2: 테스트 실패 확인**

```sh
npx vitest run --reporter=verbose test/wiki-cli.test.ts -t "description"
```

Expected: 플래그 무시되어 description이 undefined → FAIL.

- [ ] **Step 3: `wiki create` 핸들러에 플래그 처리 (src/cli/wiki.ts:67 근처)**

```ts
        const tags = flags.tags ? (flags.tags as string).split(",").map(t => t.trim()) : [];
        const sources = flags.source ? [flags.source as string] : [];
        const description = flags.description as string | undefined;   // ← 추가
        const kind = flags.kind as string | undefined;                  // ← 추가
        let body = flags.body as string | undefined;
        if (flags.stdin) body = readStdin();
```

그리고 `createWikiPage(...)` 호출 부분 (현재 두 군데: 머지 거절 후 fall-through, 기본 새 페이지 생성)에서 옵션 객체에 추가:

```ts
        // 두 곳 모두 동일하게 수정:
        const filePath = await createWikiPage(vaultDir, { title, project, tags, sources, body, description, kind, store });
```

- [ ] **Step 4: `wiki update` 핸들러에 플래그 처리 (src/cli/wiki.ts:121-127)**

```ts
        await updateWikiPage(vaultDir, title, project, {
          append: flags.append as string | undefined,
          body: flags.body as string | undefined,
          tags: flags.tags ? (flags.tags as string).split(",").map(t => t.trim()) : undefined,
          addSource: flags["add-source"] as string | undefined,
          description: flags.description as string | undefined,   // ← 추가
          kind: flags.kind as string | undefined,                   // ← 추가
          store,
        });
```

- [ ] **Step 5: usage 메시지 갱신 (src/cli/wiki.ts:42-55)**

```ts
    console.error("  hwicortex wiki create <title> --project <name> [--tags t1,t2] [--body text] [--description text] [--kind decision|howto|...]");
    console.error("  hwicortex wiki update <title> --project <name> [--append text] [--body text] [--description text] [--kind ...]");
```

- [ ] **Step 6: 테스트 통과 확인**

```sh
npx vitest run --reporter=verbose test/wiki-cli.test.ts -t "description|kind"
```

Expected: 2 tests PASS.

- [ ] **Step 7: 빌드 확인**

```sh
bun run build
```

Expected: 컴파일 성공, dist/ 갱신.

- [ ] **Step 8: 커밋**

```sh
git add src/cli/wiki.ts test/wiki-cli.test.ts
git commit -m "feat(cli): add --description and --kind flags to wiki create/update"
```

---

## Phase B: `_index.md` 가 description 우선 사용

**Goal:** `generateIndex` 가 frontmatter `description` 필드를 우선 사용. 없으면 기존 fallback (body 첫 줄 60자 자른 값) 유지.

**Files:**
- Modify: `src/wiki.ts:695-737` (`generateIndex`)
- Test: `test/wiki.test.ts` (generateIndex 테스트)

### Task B1: generateIndex가 description을 사용하도록 수정

- [ ] **Step 1: 실패 테스트 작성 (`test/wiki.test.ts`, `describe("generateIndex")` 블록)**

> 기존 generateIndex 테스트 위치 확인 후, 같은 describe 블록 끝에 추가. 없으면 새 describe 블록 만든 뒤 추가.

```ts
test("generateIndex prefers description over body first line", async () => {
  const vault = mkdtempSync(join(tmpdir(), "wiki-idx-desc-"));
  try {
    await createWikiPage(vault, {
      title: "Page A",
      project: "p",
      tags: ["t"],
      description: "사람이 쓴 한 줄 요약",
      body: "# 큰 헤딩\n실제 내용",
    });
    await createWikiPage(vault, {
      title: "Page B",
      project: "p",
      tags: ["t"],
      body: "본문 첫 줄",  // description 없음 → 기존 fallback
    });
    const path = generateIndex(vault, "p");
    const content = readFileSync(path, "utf-8");
    expect(content).toContain("[[Page A]] — 사람이 쓴 한 줄 요약");
    expect(content).toContain("[[Page B]] — 본문 첫 줄");
    // 헤딩이 description fallback으로 새지 않음
    expect(content).not.toContain("[[Page A]] — # 큰 헤딩");
  } finally {
    rmSync(vault, { recursive: true });
  }
});
```

- [ ] **Step 2: 테스트 실패 확인**

```sh
npx vitest run --reporter=verbose test/wiki.test.ts -t "description over body"
```

Expected: `Page A` 가 헤딩 첫 줄로 표시되어 FAIL.

- [ ] **Step 3: `generateIndex` 수정 (src/wiki.ts:721-731)**

`for (const tag of sortedTags)` 루프 안의 페이지 처리 부분을 수정:

```ts
  for (const tag of sortedTags) {
    lines.push("", `## ${tag}`);
    const tagPages = tagGroups.get(tag)!.sort((a, b) => a.title.localeCompare(b.title));
    for (const page of tagPages) {
      // ← 수정: description 우선
      let summary = page.description?.trim() || "";
      if (!summary) {
        const content = readFileSync(page.filePath, "utf-8");
        const { body } = parseFrontmatter(content);
        const firstLine = body.trim().split("\n")[0]?.trim() || "";
        summary = firstLine.length > 60 ? firstLine.slice(0, 60) + "..." : firstLine;
      }
      // 수정 끝 →
      const suffix = summary ? ` — ${summary}` : "";
      lines.push(`- [[${page.title}]]${suffix}`);
    }
  }
```

> 주의: `page` 는 `WikiPageMeta` 타입이고 이미 `description` 필드를 포함 (Phase A에서 추가). `listWikiPages`가 parseFrontmatter를 거치므로 자동으로 description이 들어옴.

- [ ] **Step 4: 테스트 통과 확인**

```sh
npx vitest run --reporter=verbose test/wiki.test.ts -t "description over body"
```

Expected: PASS.

- [ ] **Step 5: 전체 wiki 테스트 회귀 확인**

```sh
npx vitest run --reporter=verbose test/wiki.test.ts
```

Expected: 전체 PASS (기존 테스트 깨지지 않음).

- [ ] **Step 6: 커밋**

```sh
git add src/wiki.ts test/wiki.test.ts
git commit -m "feat(wiki): generateIndex prefers description over body first line"
```

---

## Phase C: `_log.md` 활동 로그

**Goal:** 프로젝트별 `wiki/{project}/_log.md` 에 wiki 변경 이벤트를 한 줄씩 append. 시계열 활동 뷰 + Obsidian timeline 활용 + knowledge-tidy 가 활용 가능.

**Design:**
- 파일 위치: `{vault_dir}/wiki/{project}/_log.md`
- 라인 형식: `- [YYYY-MM-DD HH:mm] <action> | "<title>" — <note>`
  - action: `create | update | append | merge | rm | link | unlink`
  - note는 옵셔널 (예: append는 truncated diff, merge는 source title)
- 첫 호출 시 frontmatter + `# 활동 로그` 헤더로 파일 초기화
- 이후는 OS-level append (`fs.appendFileSync` — POSIX 단일 write 원자성)
- `_log.md` 자체는 `listWikiPages` 에서 자동 제외 (이미 `_*` prefix 필터)
- FTS 인덱싱 안 함 (검색 결과 오염 방지)
- `_log.md` 재생성/덮어쓰기 금지 — append-only

**Files:**
- Create: `src/wiki-log.ts` (helper 모듈)
- Create: `test/wiki-log.test.ts` (단위 테스트)
- Modify: `src/wiki.ts` (CRUD 함수 5개에서 hook 호출)
- Modify: `CLAUDE.md` ("절대 하지 말 것"에 1줄)

### Task C1: appendWikiLog 헬퍼 + 단위 테스트

- [ ] **Step 1: 실패 테스트 작성 (`test/wiki-log.test.ts`, 신규)**

```ts
import { describe, test, expect, afterEach } from "vitest";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { appendWikiLog, getWikiLogPath } from "../src/wiki-log.js";

let vault = "";

afterEach(() => {
  if (vault && existsSync(vault)) rmSync(vault, { recursive: true });
});

describe("wiki-log", () => {
  test("creates _log.md with frontmatter on first call", () => {
    vault = mkdtempSync(join(tmpdir(), "wiki-log-"));
    appendWikiLog(vault, "p", "create", "First Page");
    const logPath = getWikiLogPath(vault, "p");
    expect(existsSync(logPath)).toBe(true);
    const content = readFileSync(logPath, "utf-8");
    expect(content).toMatch(/^---\n/);
    expect(content).toContain("project: p");
    expect(content).toContain("kind: log");
    expect(content).toContain("# p — 활동 로그");
    expect(content).toMatch(/- \[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\] create \| "First Page"/);
  });

  test("appends new line on subsequent calls without rewriting", () => {
    vault = mkdtempSync(join(tmpdir(), "wiki-log-"));
    appendWikiLog(vault, "p", "create", "A");
    appendWikiLog(vault, "p", "update", "A", "appended 100 chars");
    const content = readFileSync(getWikiLogPath(vault, "p"), "utf-8");
    expect(content).toMatch(/- \[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\] create \| "A"\n/);
    expect(content).toMatch(/- \[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\] update \| "A" — appended 100 chars\n/);
    // 헤더가 두 번 들어가지 않음
    const headerMatches = content.match(/# p — 활동 로그/g);
    expect(headerMatches?.length).toBe(1);
  });

  test("isolates log per project", () => {
    vault = mkdtempSync(join(tmpdir(), "wiki-log-"));
    appendWikiLog(vault, "alpha", "create", "X");
    appendWikiLog(vault, "beta", "create", "Y");
    const a = readFileSync(getWikiLogPath(vault, "alpha"), "utf-8");
    const b = readFileSync(getWikiLogPath(vault, "beta"), "utf-8");
    expect(a).toContain('"X"');
    expect(a).not.toContain('"Y"');
    expect(b).toContain('"Y"');
    expect(b).not.toContain('"X"');
  });

  test("escapes double quotes in title and note", () => {
    vault = mkdtempSync(join(tmpdir(), "wiki-log-"));
    appendWikiLog(vault, "p", "create", 'Title with "quotes"', 'note "x"');
    const content = readFileSync(getWikiLogPath(vault, "p"), "utf-8");
    expect(content).toContain('"Title with \\"quotes\\""');
    expect(content).toContain("note \\\"x\\\"");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```sh
npx vitest run --reporter=verbose test/wiki-log.test.ts
```

Expected: 모듈 미존재로 import 에러 → FAIL.

- [ ] **Step 3: `src/wiki-log.ts` 작성 (신규)**

```ts
/**
 * wiki-log.ts — Append-only activity log per wiki project.
 *
 * Writes one line per wiki mutation to `{vault}/wiki/{project}/_log.md`.
 * The file is initialized with frontmatter + heading on first call.
 * Subsequent calls use POSIX append (atomic for small writes), so this
 * is safe for concurrent CLI invocations within a single host.
 *
 * The log is intentionally NOT FTS-indexed (would pollute search) and
 * NEVER regenerated (append-only).
 */

import { appendFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { atomicWrite } from "./knowledge/vault-writer.js";

export type LogAction = "create" | "update" | "append" | "merge" | "rm" | "link" | "unlink";

export function getWikiLogPath(vaultDir: string, project: string): string {
  return join(vaultDir, "wiki", project, "_log.md");
}

function timestamp(): string {
  // YYYY-MM-DD HH:mm (local time)
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function escape(s: string): string {
  return s.replace(/"/g, '\\"');
}

function initLog(logPath: string, project: string): void {
  const header = [
    "---",
    `title: ${project} 위키 활동 로그`,
    `project: ${project}`,
    `kind: log`,
    "---",
    "",
    `# ${project} — 활동 로그`,
    "",
    "",
  ].join("\n");
  // atomicWrite handles parent dir creation
  atomicWrite(logPath, header);
}

export function appendWikiLog(
  vaultDir: string,
  project: string,
  action: LogAction,
  title: string,
  note?: string,
): void {
  const logPath = getWikiLogPath(vaultDir, project);

  if (!existsSync(logPath)) {
    initLog(logPath, project);
  }

  const noteSuffix = note ? ` — ${escape(note)}` : "";
  const line = `- [${timestamp()}] ${action} | "${escape(title)}"${noteSuffix}\n`;
  appendFileSync(logPath, line);
}
```

- [ ] **Step 4: 테스트 통과 확인**

```sh
npx vitest run --reporter=verbose test/wiki-log.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 5: 커밋**

```sh
git add src/wiki-log.ts test/wiki-log.test.ts
git commit -m "feat(wiki): add appendWikiLog helper for per-project activity log"
```

### Task C2: createWikiPage 후크

- [ ] **Step 1: 통합 테스트 작성 (`test/wiki.test.ts`, 새 describe 블록)**

```ts
import { appendWikiLog, getWikiLogPath } from "../src/wiki-log.js";

describe("wiki CRUD logs activity", () => {
  test("createWikiPage logs create event", async () => {
    const vault = mkdtempSync(join(tmpdir(), "wiki-log-create-"));
    try {
      await createWikiPage(vault, { title: "Logged", project: "p", body: "x" });
      const log = readFileSync(getWikiLogPath(vault, "p"), "utf-8");
      expect(log).toContain('create | "Logged"');
    } finally {
      rmSync(vault, { recursive: true });
    }
  });
});
```

- [ ] **Step 2: 실패 확인**

```sh
npx vitest run --reporter=verbose test/wiki.test.ts -t "logs create event"
```

Expected: `_log.md` 미존재 → readFileSync ENOENT → FAIL.

- [ ] **Step 3: `createWikiPage` 에 호출 추가 (src/wiki.ts:380 근처)**

```ts
import { appendWikiLog } from "./wiki-log.js";   // ← 파일 상단 import 블록에 추가

// createWikiPage 본문, atomicWrite 직후:
  const content = opts.body ? `${fm}\n\n${opts.body}\n` : `${fm}\n`;
  atomicWrite(filePath, content);

  appendWikiLog(vaultDir, opts.project, "create", opts.title,    // ← 추가
    opts.description ? opts.description.slice(0, 80) : undefined);

  if (opts.store) { /* ... 기존 ... */ }
```

- [ ] **Step 4: 테스트 통과 확인**

```sh
npx vitest run --reporter=verbose test/wiki.test.ts -t "logs create event"
```

Expected: PASS.

- [ ] **Step 5: 커밋**

```sh
git add src/wiki.ts test/wiki.test.ts
git commit -m "feat(wiki): log create events to _log.md"
```

### Task C3: updateWikiPage 후크 (update / append 구분)

- [ ] **Step 1: 실패 테스트 추가 (`test/wiki.test.ts`)**

```ts
test("updateWikiPage logs update event with body change", async () => {
  const vault = mkdtempSync(join(tmpdir(), "wiki-log-upd-"));
  try {
    await createWikiPage(vault, { title: "T", project: "p", body: "v1" });
    await updateWikiPage(vault, "T", "p", { body: "v2" });
    const log = readFileSync(getWikiLogPath(vault, "p"), "utf-8");
    expect(log).toMatch(/update \| "T"/);
  } finally {
    rmSync(vault, { recursive: true });
  }
});

test("updateWikiPage with append logs append event", async () => {
  const vault = mkdtempSync(join(tmpdir(), "wiki-log-app-"));
  try {
    await createWikiPage(vault, { title: "T", project: "p", body: "v1" });
    await updateWikiPage(vault, "T", "p", { append: "added" });
    const log = readFileSync(getWikiLogPath(vault, "p"), "utf-8");
    expect(log).toMatch(/append \| "T"/);
  } finally {
    rmSync(vault, { recursive: true });
  }
});
```

- [ ] **Step 2: 실패 확인**

```sh
npx vitest run --reporter=verbose test/wiki.test.ts -t "logs update event|logs append event"
```

Expected: `update`/`append` 라인 미존재 → FAIL.

- [ ] **Step 3: `updateWikiPage` 에 hook 추가 (src/wiki.ts:470 근처)**

```ts
  const fm = buildFrontmatter(meta);
  const content = `${fm}\n${body}`;
  atomicWrite(page.filePath, content);

  // ← 추가
  const action = opts.append ? "append" : "update";
  const note = opts.append
    ? `${opts.append.length} chars appended`
    : (opts.body !== undefined ? "body replaced" : (opts.tags ? "tags changed" : undefined));
  appendWikiLog(vaultDir, project, action, title, note);
  // 추가 끝 →

  if (opts.store) { /* ... */ }
```

- [ ] **Step 4: 테스트 통과 확인**

```sh
npx vitest run --reporter=verbose test/wiki.test.ts -t "logs update event|logs append event"
```

Expected: 2 PASS.

- [ ] **Step 5: 커밋**

```sh
git add src/wiki.ts test/wiki.test.ts
git commit -m "feat(wiki): log update/append events with concise notes"
```

### Task C4: mergeIntoPage 후크

- [ ] **Step 1: 실패 테스트 추가**

```ts
test("mergeIntoPage logs merge event with source title", async () => {
  const vault = mkdtempSync(join(tmpdir(), "wiki-log-merge-"));
  try {
    await createWikiPage(vault, { title: "Target", project: "p", body: "main" });
    await mergeIntoPage(vault, "Target", "p", { sourceTitle: "Source", body: "merged content" });
    const log = readFileSync(getWikiLogPath(vault, "p"), "utf-8");
    expect(log).toMatch(/merge \| "Target" — from "Source"/);
  } finally {
    rmSync(vault, { recursive: true });
  }
});
```

- [ ] **Step 2: 실패 확인**

```sh
npx vitest run --reporter=verbose test/wiki.test.ts -t "merge event"
```

Expected: FAIL.

- [ ] **Step 3: `mergeIntoPage` 에 hook 추가 (src/wiki.ts:677 근처)**

```ts
  const content = `${fm}\n${body}`;
  atomicWrite(page.filePath, content);

  appendWikiLog(vaultDir, project, "merge", targetTitle, `from "${opts.sourceTitle}"`);   // ← 추가

  if (opts.store) { /* ... */ }
```

- [ ] **Step 4: 통과 확인**

```sh
npx vitest run --reporter=verbose test/wiki.test.ts -t "merge event"
```

Expected: PASS.

- [ ] **Step 5: 커밋**

```sh
git add src/wiki.ts test/wiki.test.ts
git commit -m "feat(wiki): log merge events with source title"
```

### Task C5: removeWikiPage / linkPages / unlinkPages 후크

- [ ] **Step 1: 실패 테스트 추가**

```ts
test("removeWikiPage logs rm event", async () => {
  const vault = mkdtempSync(join(tmpdir(), "wiki-log-rm-"));
  try {
    await createWikiPage(vault, { title: "Doomed", project: "p" });
    removeWikiPage(vault, "Doomed", "p");
    const log = readFileSync(getWikiLogPath(vault, "p"), "utf-8");
    expect(log).toMatch(/rm \| "Doomed"/);
  } finally {
    rmSync(vault, { recursive: true });
  }
});

test("linkPages logs link event for both pages", async () => {
  const vault = mkdtempSync(join(tmpdir(), "wiki-log-link-"));
  try {
    await createWikiPage(vault, { title: "A", project: "p" });
    await createWikiPage(vault, { title: "B", project: "p" });
    linkPages(vault, "A", "B", "p");
    const log = readFileSync(getWikiLogPath(vault, "p"), "utf-8");
    expect(log).toMatch(/link \| "A" — ↔ "B"/);
    expect(log).toMatch(/link \| "B" — ↔ "A"/);
  } finally {
    rmSync(vault, { recursive: true });
  }
});

test("unlinkPages logs unlink event for both pages", async () => {
  const vault = mkdtempSync(join(tmpdir(), "wiki-log-unlink-"));
  try {
    await createWikiPage(vault, { title: "A", project: "p" });
    await createWikiPage(vault, { title: "B", project: "p" });
    linkPages(vault, "A", "B", "p");
    unlinkPages(vault, "A", "B", "p");
    const log = readFileSync(getWikiLogPath(vault, "p"), "utf-8");
    expect(log).toMatch(/unlink \| "A" — ↔ "B"/);
    expect(log).toMatch(/unlink \| "B" — ↔ "A"/);
  } finally {
    rmSync(vault, { recursive: true });
  }
});
```

- [ ] **Step 2: 실패 확인**

```sh
npx vitest run --reporter=verbose test/wiki.test.ts -t "rm event|link event|unlink event"
```

Expected: FAIL.

- [ ] **Step 3: `removeWikiPage` 후크 (src/wiki.ts:484)**

```ts
export function removeWikiPage(vaultDir: string, title: string, project: string, store?: Store): void {
  const filePath = resolveWikiPath(vaultDir, title, project);
  if (!existsSync(filePath)) {
    throw new Error(`Wiki page "${title}" not found at ${filePath}`);
  }
  unlinkSync(filePath);

  appendWikiLog(vaultDir, project, "rm", title);   // ← 추가

  if (store) { /* ... */ }
}
```

- [ ] **Step 4: `linkPages` 후크 (src/wiki.ts:518)**

`linkPages` 함수 끝(unlinkPages 시작 직전)에 추가:

```ts
  // (기존 양쪽 페이지 갱신 로직 끝)
  appendWikiLog(vaultDir, project, "link", titleA, `↔ "${titleB}"`);   // ← 추가
  appendWikiLog(vaultDir, project, "link", titleB, `↔ "${titleA}"`);   // ← 추가
}
```

- [ ] **Step 5: `unlinkPages` 후크 (src/wiki.ts:540)**

함수 끝에 추가:

```ts
  // 기존 for loop 끝
  appendWikiLog(vaultDir, project, "unlink", titleA, `↔ "${titleB}"`);   // ← 추가
  appendWikiLog(vaultDir, project, "unlink", titleB, `↔ "${titleA}"`);   // ← 추가
}
```

- [ ] **Step 6: 통과 확인 + 회귀 확인**

```sh
npx vitest run --reporter=verbose test/wiki.test.ts
npx vitest run --reporter=verbose test/wiki-cli.test.ts
```

Expected: 전부 PASS.

- [ ] **Step 7: 빌드 확인**

```sh
bun run build
```

- [ ] **Step 8: 커밋**

```sh
git add src/wiki.ts test/wiki.test.ts
git commit -m "feat(wiki): log rm/link/unlink events"
```

### Task C6: CLAUDE.md 가드 + index.ts export

- [ ] **Step 1: `CLAUDE.md` "절대 하지 말 것" 섹션에 1줄 추가**

(`src/wiki.ts` 가 아닌 프로젝트 루트의 `CLAUDE.md`)

기존:
```
## 절대 하지 말 것

- `hwicortex collection add`, `hwicortex embed`, `hwicortex update`, `hwicortex extract` 자동 실행 금지 — 예시 명령어만 제시
- SQLite DB 직접 수정 금지 (인덱스: `~/.cache/qmd/index.sqlite`)
- `bun build --compile` 금지 — sqlite-vec 깨짐. `bin/hwicortex`는 셸 래퍼이므로 교체 금지
```

여기에 한 줄 추가:
```
- `wiki/{project}/_log.md` 재생성/덮어쓰기 금지 — append-only. 디버깅 시에도 손대지 말 것
```

- [ ] **Step 2: `src/index.ts` 가 wiki-log를 export 하는지 확인 (SDK 진입점이라면 노출 필요할 수 있음)**

```sh
grep -n "wiki-log\|wiki.js\|export.*wiki" /Users/ad03159868/Downloads/Claude_lab/hwicortex/src/index.ts
```

Expected: 기존에 `wiki.js` re-export 가 있다면 `wiki-log.js` 도 동일 패턴으로 추가:

```ts
export { appendWikiLog, getWikiLogPath } from "./wiki-log.js";
```

> 만약 wiki.js 가 SDK에서 노출되지 않는다면 wiki-log도 노출하지 않음. 일관성 우선.

- [ ] **Step 3: 빌드 + 전체 회귀 테스트**

```sh
bun run build && npx vitest run --reporter=verbose test/
```

Expected: 전체 테스트 PASS.

- [ ] **Step 4: 커밋**

```sh
git add CLAUDE.md src/index.ts
git commit -m "docs(claude.md): forbid regenerating wiki _log.md, export wiki-log helpers"
```

---

## Phase D: knowledge-tidy + `wiki list --stale-days N`

**Goal:** Karpathy gist의 "stale claims" 검사를 흡수. CLI 한쪽(노후 필터)과 스킬 한쪽(노후 + 모순 후보) 모두 손댐.

**Files:**
- Modify: `src/wiki.ts:405-436` (`listWikiPages` 에 staleDays 옵션 추가)
- Modify: `src/cli/wiki.ts:150-167` (`wiki list --stale-days N`)
- Modify: `skills/knowledge-tidy/SKILL.md`
- Test: `test/wiki.test.ts`, `test/wiki-cli.test.ts`

### Task D1: listWikiPages 에 staleDays 필터 추가

- [ ] **Step 1: 실패 테스트 작성 (`test/wiki.test.ts`)**

```ts
test("listWikiPages filters by staleDays", async () => {
  const vault = mkdtempSync(join(tmpdir(), "wiki-stale-"));
  try {
    await createWikiPage(vault, { title: "Fresh", project: "p" });
    // 강제 노후 페이지: 직접 frontmatter의 updated 를 과거로
    await createWikiPage(vault, { title: "Old", project: "p" });
    const oldPath = resolveWikiPath(vault, "Old", "p");
    const oldDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);
    let oldContent = readFileSync(oldPath, "utf-8");
    oldContent = oldContent.replace(/updated: \d{4}-\d{2}-\d{2}/, `updated: ${oldDate}`);
    writeFileSync(oldPath, oldContent);

    const stale = listWikiPages(vault, { project: "p", staleDays: 180 });
    expect(stale.map(p => p.title)).toEqual(["Old"]);
  } finally {
    rmSync(vault, { recursive: true });
  }
});

test("listWikiPages with staleDays excludes pages without updated/created", async () => {
  const vault = mkdtempSync(join(tmpdir(), "wiki-stale-noupdate-"));
  try {
    await createWikiPage(vault, { title: "Naked", project: "p" });
    // updated와 created 라인을 frontmatter에서 제거 — 빈 문자열 폴백 동작 검증
    const path = resolveWikiPath(vault, "Naked", "p");
    let c = readFileSync(path, "utf-8");
    c = c.replace(/^updated: .+$/m, "").replace(/^created: .+$/m, "");
    writeFileSync(path, c);

    const stale = listWikiPages(vault, { project: "p", staleDays: 180 });
    // 폴백이 "9999-99-99" → cutoff 보다 미래 → stale 결과에서 제외
    expect(stale).toEqual([]);
  } finally {
    rmSync(vault, { recursive: true });
  }
});
```

> import 누락 시 `resolveWikiPath`, `writeFileSync` 추가. 두 번째 테스트는 `||` (vs `??`) 폴백을 잠금 — 만약 잘못해서 `??`를 쓰면 빈 문자열이 살아나 페이지가 stale 로 분류되어 이 테스트가 깨진다.

- [ ] **Step 2: 실패 확인**

```sh
npx vitest run --reporter=verbose test/wiki.test.ts -t "staleDays"
```

Expected: option 미인식 → FAIL.

- [ ] **Step 3: `listWikiPages` 시그니처와 본문 수정 (src/wiki.ts:405)**

```ts
export function listWikiPages(
  vaultDir: string,
  filter?: { project?: string; tag?: string; staleDays?: number }   // ← staleDays 추가
): WikiPageMeta[] {
  // ... (기존 디렉토리 스캔)

  // 기존 push 직전, tag 필터 다음에 추가:
  const staleCutoff = filter?.staleDays !== undefined
    ? new Date(Date.now() - filter.staleDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    : undefined;

  // results.push 부분 직전:
  for (const proj of projects) {
    // ...
    for (const file of readdirSync(projDir)) {
      // ...
      try {
        const content = readFileSync(filePath, "utf-8");
        const { meta } = parseFrontmatter(content);
        if (filter?.tag && !meta.tags.includes(filter.tag)) continue;
        if (staleCutoff) {
          // parseFrontmatter는 누락 시 "" 반환 — `??`가 아니라 `||`로 폴백.
          // 둘 다 없으면 "9999-99-99"로 처리해서 not-stale (cutoff < "9999..." 이므로 continue).
          const lastTouched = meta.updated || meta.created || "9999-99-99";
          if (lastTouched > staleCutoff) continue;
        }
        results.push({ ...meta, filePath });
      } catch { /* skip */ }
    }
  }

  return results;
}
```

> 의미: `updated` 가 cutoff 보다 더 옛날(작으면) → stale. `updated` 없으면 `created` 사용. 둘 다 없으면 `"9999-99-99"` 라는 "매우 미래" 값으로 간주 → cutoff 보다 크므로 stale 결과에서 제외.
>
> **주의**: `parseFrontmatter` 의 `get()` 헬퍼(`src/wiki.ts:188-191`)는 누락 필드를 `undefined` 가 아닌 빈 문자열 `""` 로 반환한다. 따라서 `??` 연산자는 작동하지 않고 빈 문자열이 그대로 사용되어 모든 페이지가 stale 로 분류된다. **반드시 `||` 사용**.

- [ ] **Step 4: 통과 확인**

```sh
npx vitest run --reporter=verbose test/wiki.test.ts -t "staleDays"
```

Expected: PASS.

- [ ] **Step 5: 커밋**

```sh
git add src/wiki.ts test/wiki.test.ts
git commit -m "feat(wiki): listWikiPages supports staleDays filter"
```

### Task D2: CLI `wiki list --stale-days N` 통합

- [ ] **Step 1: 실패 테스트 (`test/wiki-cli.test.ts`)**

```ts
test("wiki list --stale-days filters old pages", () => {
  qmd('wiki create "Recent" --project p', vaultDir);
  // 강제 노후
  qmd('wiki create "Old" --project p', vaultDir);
  const oldPath = join(vaultDir, "wiki/p", "old.md");
  let c = readFileSync(oldPath, "utf-8");
  c = c.replace(/updated: \d{4}-\d{2}-\d{2}/, "updated: 2024-01-01");
  writeFileSync(oldPath, c);

  const out = qmd("wiki list --project p --stale-days 90 --json", vaultDir);
  const arr = JSON.parse(out);
  expect(arr.map((p: any) => p.title)).toEqual(["Old"]);
});
```

- [ ] **Step 2: 실패 확인**

```sh
npx vitest run --reporter=verbose test/wiki-cli.test.ts -t "stale-days"
```

Expected: 플래그 무시되어 모든 페이지 출력 → FAIL.

- [ ] **Step 3: CLI 핸들러 수정 (src/cli/wiki.ts:151-154)**

```ts
      case "list": {
        const staleDays = flags["stale-days"] !== undefined
          ? parseInt(flags["stale-days"] as string, 10)
          : undefined;
        if (staleDays !== undefined && (isNaN(staleDays) || staleDays < 0)) {
          console.error("Error: --stale-days must be a non-negative integer");
          process.exit(2);
        }
        const pages = listWikiPages(vaultDir, {
          project: flags.project as string | undefined,
          tag: flags.tag as string | undefined,
          staleDays,                                           // ← 추가
        });
        // ... 기존 출력 로직
      }
```

- [ ] **Step 4: usage 메시지 갱신 (src/cli/wiki.ts:48)**

```ts
    console.error("  hwicortex wiki list [--project <name>] [--tag <tag>] [--stale-days N]");
```

- [ ] **Step 5: 통과 확인**

```sh
npx vitest run --reporter=verbose test/wiki-cli.test.ts -t "stale-days"
```

Expected: PASS.

- [ ] **Step 6: 빌드**

```sh
bun run build
```

- [ ] **Step 7: 커밋**

```sh
git add src/cli/wiki.ts test/wiki-cli.test.ts
git commit -m "feat(cli): wiki list --stale-days N filters by updated timestamp"
```

### Task D3: `knowledge-tidy` SKILL.md — (E) 노후 검사 섹션 추가

- [ ] **Step 1: `skills/knowledge-tidy/SKILL.md` 의 `## Process` → "2. 정리 항목 분석 & 제안" 안의 D 다음에 E 추가**

기존 D 끝(L74) 다음에:

```markdown
   **E) 노후 페이지 검토** (Karpathy gist의 "stale claims")
   `updated`가 6개월(180일) 이상 지난 페이지를 검토 대상으로 표시:
   ```bash
   hwicortex wiki list --project $WIKI_PROJECT --stale-days 180 --json
   ```
   각 항목에 대해 사용자에게 보여주고 결정을 받는다:
   ```
   ⏳ 노후 검토 후보 (updated > 180일):
     1. "<title>" (updated: 2024-09-30) — 여전히 유효한가?
        → still valid (s) / 갱신 필요 (u) / 보관 처리 (a) / 스킵 (.)
   ```
   - **still valid (s)**: `wiki update --no-count`로 `updated`만 오늘로 갱신 (내용 변경 없음)
     ```bash
     hwicortex wiki update "<title>" --project $WIKI_PROJECT --no-count
     ```
     > 주의: `updateWikiPage`는 옵션 없이 호출해도 `updated` 필드를 오늘로 바꿈. body/tag 변경 없으니 `--no-count`로 importance bump 방지.
   - **갱신 필요 (u)**: 내용 한 줄로 어디가 outdated 인지 메모만 받고, 사용자가 직접 갱신하라고 안내. 이 스킬에서 자동 수정하지 않음.
   - **보관 (a)**: `archive` 태그 추가
     ```bash
     hwicortex wiki update "<title>" --project $WIKI_PROJECT --tags <기존태그+archive> --no-count
     ```
   - **스킵 (.)**: 아무 동작 안 함.
```

- [ ] **Step 2: 같은 자리에 (F) 모순 후보 섹션 추가**

```markdown
   **F) 모순 후보 검토** (실험적 — 자동 수정 절대 금지)
   같은 태그 그룹 내 페이지들의 본문을 LLM이 비교하여 *서로 다른 결론을 말하는 것 같은* 페이지 쌍을 찾는다. False positive 가 많을 수 있으므로 **반드시 후보로만 제시**하고, 어떤 자동 수정도 하지 않는다.

   처리 방식:
   1. 태그별로 페이지 묶기 (가장 흔한 태그 TOP 3 정도만 — 비용 제한)
   2. 묶음마다 페이지 본문을 읽어 LLM이 모순 후보를 골라냄
      ```bash
      # 같은 태그를 공유하는 페이지 본문을 모두 읽어 LLM 입력으로 사용
      for title in <태그 그룹 페이지들>; do
        echo "=== $title ==="
        hwicortex wiki show "$title" --project $WIKI_PROJECT --no-count
      done
      ```
   3. 후보 제시:
      ```
      ⚖ 모순 후보 (LLM 추정 — false positive 가능):
        1. "<A>" vs "<B>" (공통 태그: <tag>)
           A: "결론 X"
           B: "결론 Y"
           → 검토 필요. 본 스킬은 자동 수정 안 함.
      ```
   4. 사용자에게 어떻게 할지 묻지 않음. **읽기만 하고 다음 항목으로**. 실제 수정은 사용자가 별도로 진행.

   > 비용 통제: 페이지 수가 많은 태그(>20개)는 스킵. 비교는 페이지 본문 첫 1500자만 사용.
```

- [ ] **Step 3: `## Process` → "3. 사용자 문답"의 안내 메시지를 E를 포함하도록 갱신**

기존:
```markdown
3. **사용자 문답**
   각 항목별로 승인/수정/스킵:
   ```
   위 제안을 항목별로 진행합니다:
   병합 1: "<titleA>" + "<titleB>" → 승인(y) / 스킵(s)?
   ```
```

`각 항목별로` 다음에 한 줄 추가: "노후 검토(E)와 모순 후보(F)는 읽기 전용 — 사용자에게 보여주고 본 스킬에서는 별도 액션 안 함."

- [ ] **Step 4: `## Rules` 에 한 줄 추가**

```markdown
- **모순 후보(F)는 절대 자동 수정하지 않음.** 사용자에게 후보만 제시하고 종료.
- **노후(E)의 갱신 필요 케이스도 자동 수정하지 않음.** 메모만 받고 사용자가 직접 처리.
```

- [ ] **Step 5: SKILL.md 변경 검증 (수동 — 빌드/테스트 영향 없음)**

```sh
grep -n "노후\|모순" /Users/ad03159868/Downloads/Claude_lab/hwicortex/skills/knowledge-tidy/SKILL.md
```

Expected: 새로 추가된 (E), (F) 섹션 키워드가 grep 에 잡힘.

- [ ] **Step 6: 커밋**

```sh
git add skills/knowledge-tidy/SKILL.md
git commit -m "feat(skill): knowledge-tidy adds staleness review and contradiction candidates"
```

---

## Phase E: knowledge-post / knowledge-ingest 멀티페이지 갱신 제안

**Goal:** 한 인사이트가 *다른 기존 페이지에도* 영향을 줄 가능성이 있을 때, "<페이지 X도 갱신 제안>" 으로 사용자에게 보여주고 페이지별 승인을 받는다. Karpathy의 "한 source가 보통 10–15 페이지 갱신" 흐름의 흡수.

**Files:**
- Modify: `skills/knowledge-post/SKILL.md`
- Modify: `skills/knowledge-ingest/SKILL.md`

### Task E1: knowledge-post 멀티페이지 제안 단계 추가

- [ ] **Step 1: `## Process` → "3. 승인된 인사이트별 중복 체크" 단계를 확장**

기존(L52-56):
```markdown
3. **승인된 인사이트별 중복 체크**
   각 인사이트에 대해:
   ```bash
   hwicortex search -c $WIKI_COLLECTION "<인사이트 핵심 키워드>" -n 3 --json
   ```
```

다음과 같이 확장:

```markdown
3. **승인된 인사이트별 중복 체크 + 멀티페이지 영향 분석**
   각 인사이트에 대해:
   ```bash
   hwicortex search -c $WIKI_COLLECTION "<인사이트 핵심 키워드>" -n 5 --json
   ```
   결과 페이지를 다음과 같이 분류:
   - **A) Primary** — 인사이트와 가장 직접 관련된 페이지 (top score, 또는 core 주제 일치). 4-A/B 분기 대상.
   - **B) Also-relevant** — 같은 도메인이지만 직접 갱신할 정도는 아닌 페이지. 5단계의 *링크 후보*.
   - **C) Should-update** — 본문이 인사이트와 *겹치는 부분이 있고 그 부분이 outdated 거나 보강 필요* 한 페이지. 사용자에게 추가로 멀티페이지 갱신 제안.

   분류는 LLM이 본문 발췌를 읽고 판단. 단순 검색 점수만으로 결정하지 말 것.
```

- [ ] **Step 2: 새 단계 "3.5. 멀티페이지 갱신 제안" 추가 (4 직전)**

```markdown
3.5. **멀티페이지 갱신 제안** (옵셔널 — 해당 인사이트가 C 분류 페이지를 가질 때만)

   사용자에게 추가 갱신 후보를 보여주고 승인을 받는다:
   ```
   📎 인사이트 "<인사이트 제목>" 관련 추가 갱신 제안:
     [a] "<title-X>" — 어느 섹션을 어떻게 보강할지 한 줄 설명
     [b] "<title-Y>" — ...

   각각 승인(y) / 스킵(s)?
   ```
   - 승인된 페이지는 4단계와 동일한 방식으로 `wiki update --append` 처리. 단, **append 본문은 인사이트 본체가 아니라 해당 페이지에 맞춰 재작성된 짧은 추가 내용**이어야 한다 (보통 1-3 문장).
   - 사용자가 모두 스킵하면 4단계로 진행 (멀티페이지 갱신 안 함).

   비용 통제: 한 인사이트당 *최대 3개*까지만 추가 갱신 후보로 제시. 그 이상은 보여주지 않음.
```

- [ ] **Step 3: 기존 "5. 관련 문서 링크" 단계 보강**

기존:
```markdown
5. **관련 문서 링크**
   검색 중 관련 문서를 발견했으면:
```

다음과 같이 갱신:
```markdown
5. **관련 문서 링크**
   3단계의 B (Also-relevant) 분류 페이지에 대해:
```

> 의미: A는 직접 갱신, C는 멀티페이지 갱신, B는 링크 후보.

- [ ] **Step 4: `## Rules` 의 마지막 bullet (`- 하나의 인사이트 = 하나의 위키 페이지 원칙. 여러 주제를 한 페이지에 섞지 말 것.`) **다음 줄**에 두 줄 추가**

```markdown
- 멀티페이지 갱신 제안(3.5)은 **반드시 페이지별 승인을 받음**. 일괄 자동 적용 금지.
- 멀티페이지 갱신 시 append 내용은 *인사이트 본체 복사 금지* — 해당 페이지 맥락에 맞게 1-3 문장으로 재작성한다.
```

> Rules 섹션은 평면 bullet 리스트(서브섹션 없음). 마지막 bullet 다음 줄에 추가하면 된다.

- [ ] **Step 5: 커밋**

```sh
git add skills/knowledge-post/SKILL.md
git commit -m "feat(skill): knowledge-post proposes multi-page updates per insight"
```

### Task E2: knowledge-ingest 멀티페이지 제안 단계 추가

- [ ] **Step 1: `## Process` → "4. 승인된 인사이트를 wiki로 저장" 직전에 "3.5. 멀티페이지 영향 분석" 단계 추가**

knowledge-post의 Task E1 Step 1, 2와 동일한 패턴으로 적용. 단계 번호는 ingest 흐름에 맞춰 정렬:

```markdown
3.5. **인사이트별 멀티페이지 영향 분석** (옵셔널)

   3단계에서 승인된 각 인사이트에 대해 검색을 한 번 돌려 *Primary / Also-relevant / Should-update* 로 분류한다:
   ```bash
   hwicortex search -c $WIKI_COLLECTION "<인사이트 키워드>" -n 5 --json
   ```
   - **Primary** → 4단계 저장 분기에서 처리.
   - **Also-relevant** → 5단계 링크 후보.
   - **Should-update** → 사용자에게 멀티페이지 갱신 제안:
     ```
     📎 인사이트 "<제목>"가 영향을 주는 기존 문서:
       [a] "<title-X>" — 보강 포인트
       [b] "<title-Y>" — 보강 포인트

     각각 승인(y) / 스킵(s)?
     ```
   - 승인된 페이지는 4단계와 같은 방식으로 `wiki update --append` 처리하되, append 내용은 페이지 맥락에 맞게 재작성.

   비용 통제: 인사이트당 최대 3개. 또한 세션이 너무 많으면(10개 이상) 본 단계 스킵하고 사용자에게 한 번만 알림.
```

- [ ] **Step 2: 4단계 텍스트 보강**

기존 4단계의 첫 줄 ("각 승인된 인사이트에 대해:") 위에 한 줄 추가:

```markdown
4. **승인된 인사이트를 wiki로 저장**

   *Primary 페이지 갱신*. (Should-update 페이지는 3.5에서 이미 처리됨.)
   각 승인된 인사이트에 대해:
   ...
```

- [ ] **Step 3: `## Rules` 의 마지막 bullet 다음 줄에 두 줄 추가**

```markdown
- 멀티페이지 갱신 제안(3.5)은 페이지별 승인을 받는다. 일괄 자동 적용 금지.
- 세션 10개 이상 처리 시 멀티페이지 분석은 스킵 (비용 통제).
```

> knowledge-ingest의 Rules 섹션도 평면 bullet 리스트. 마지막 bullet 다음에 추가.

- [ ] **Step 4: 커밋**

```sh
git add skills/knowledge-ingest/SKILL.md
git commit -m "feat(skill): knowledge-ingest proposes multi-page updates per insight"
```

---

## Phase F: 마무리 — 전체 회귀, CHANGELOG, 수동 스모크

### Task F1: 전체 테스트와 빌드

- [ ] **Step 1: 전체 테스트 실행**

```sh
npx vitest run --reporter=verbose test/
```

Expected: **전체** 테스트 PASS. 실패가 나오면 수정 후 재실행. plan에서 의도하지 않은 회귀가 보이면 멈추고 보고.

- [ ] **Step 2: 클린 빌드**

```sh
rm -rf dist && bun run build
```

Expected: TS → dist/ 컴파일 성공.

- [ ] **Step 3: CLI 도움말 자체 점검**

```sh
bun src/cli/qmd.ts wiki
```

Expected: usage 메시지에 `--description`, `--kind`, `--stale-days` 모두 보임. 기존 옵션도 모두 보임.

### Task F2: 수동 스모크 — 임시 vault에서 통합 시나리오 (사용자 직접 실행 권장)

> **이 task는 destructive 가 아니지만 시간이 들고 사용자 환경에서 의미가 있다. 자동 실행 대신 plan 검증자/실행자가 사용자에게 권고만 하고, 실제 실행은 사용자가 결정한다.**

권고 명령어:
```sh
TMP_VAULT=$(mktemp -d)
echo "임시 vault: $TMP_VAULT"

# 새 description/kind 플래그 포함 페이지 만들기
QMD_VAULT_DIR=$TMP_VAULT bun src/cli/qmd.ts wiki create "테스트 결정" \
  --project demo --tags decision \
  --description "팀이 X 대신 Y를 채택한 이유" \
  --kind decision \
  --body "본문이 다소 길지만 description 이 인덱스에 우선 표시되어야 함."

# 인덱스 생성
QMD_VAULT_DIR=$TMP_VAULT bun src/cli/qmd.ts wiki index --project demo

# 결과 확인
cat $TMP_VAULT/wiki/demo/_index.md
# Expected: "- [[테스트 결정]] — 팀이 X 대신 Y를 채택한 이유"

# 활동 로그 확인
cat $TMP_VAULT/wiki/demo/_log.md
# Expected: create 라인 1줄 + 헤더

# 갱신
QMD_VAULT_DIR=$TMP_VAULT bun src/cli/qmd.ts wiki update "테스트 결정" \
  --project demo --append "추가 내용"

cat $TMP_VAULT/wiki/demo/_log.md
# Expected: append 라인이 추가됨

# 노후 필터 (현재 페이지는 노후 아님 → 빈 결과)
QMD_VAULT_DIR=$TMP_VAULT bun src/cli/qmd.ts wiki list --project demo --stale-days 1

# 정리
rm -rf $TMP_VAULT
```

- [ ] **Step 1: 위 스모크를 사용자에게 안내. 결과 확인 후 다음 task 로.**

> Plan executor 가 이 단계를 자동 실행하지 말 것 — CLAUDE.md 의 "자동 실행 금지" 정책. 안내만 하고 사용자가 직접 실행/확인.

### Task F3: CHANGELOG 갱신

- [ ] **Step 1: `CHANGELOG.md` `## [Unreleased]` 의 `### Added` 에 항목 추가**

```markdown
### Added

- Wiki frontmatter: optional `description` (한 줄 요약, `_index.md` 에 우선 사용) and `kind` (decision/howto/incident/concept/reference 등 옵셔널 분류) 필드. CLI: `wiki create`/`update` 에 `--description`, `--kind` 플래그.
- Wiki activity log: `wiki/{project}/_log.md` 에 create/update/append/merge/rm/link/unlink 이벤트가 자동 append. POSIX append 기반 (atomic for small writes), 검색 인덱싱 안 함, 재생성 금지.
- Wiki list staleness filter: `hwicortex wiki list --stale-days N` — `updated` 가 N일 이상 지난 페이지만 출력.
- knowledge-tidy: 노후 페이지 검토(E)와 모순 후보 분석(F) 단계. 둘 다 사용자 승인/검토용으로만 제시, 자동 수정 안 함.
- knowledge-post / knowledge-ingest: 인사이트당 멀티페이지 갱신 제안 단계 추가. Primary/Also-relevant/Should-update 분류 후 페이지별 승인 처리.
```

- [ ] **Step 2: 커밋**

```sh
git add CHANGELOG.md
git commit -m "docs(changelog): record wiki extensions inspired by Karpathy LLM-Wiki gist"
```

### Task F4: 최종 정리 커밋 / 점검

- [ ] **Step 1: git log 검토**

```sh
git log --oneline main..HEAD
```

Expected: 이 plan에 해당하는 ~15개 정도의 작은 커밋. 각 커밋이 한 가지 일을 함 (`feat(wiki): ...`, `feat(cli): ...`, `feat(skill): ...`, `docs: ...`).

- [ ] **Step 2: 최종 작업 디렉토리 깨끗한지 확인**

```sh
git status
```

Expected: untracked 없음, modified 없음. (있다면 의도된 것인지 확인.)

- [ ] **Step 3: 한 번 더 전체 회귀**

```sh
bun run build && npx vitest run --reporter=verbose test/
```

Expected: 전체 PASS.

---

## 검증 체크리스트 (Plan 완료 기준)

| 항목 | 확인 방법 |
|---|---|
| Phase A: description/kind 라운드트립 | `wiki.test.ts` 의 `describe("buildFrontmatter")`, `describe("parseFrontmatter")` 신규 4건 PASS |
| Phase A: CLI 플래그 통합 | `wiki-cli.test.ts` 의 description/kind 통합 2건 PASS |
| Phase B: `_index.md` description 우선 | `generateIndex prefers description over body first line` PASS + 기존 generateIndex 테스트 회귀 없음 |
| Phase C: appendWikiLog 단위 | `wiki-log.test.ts` 4건 PASS |
| Phase C: CRUD hook | `wiki.test.ts` 의 CRUD logs activity 5건 (create/update/append/merge/rm/link/unlink) PASS |
| Phase D: `--stale-days` CLI | `wiki-cli.test.ts` 의 stale-days 1건 PASS |
| Phase D: SKILL.md 갱신 | `grep "노후\|모순" skills/knowledge-tidy/SKILL.md` 가 새 섹션 잡음 |
| Phase E: knowledge-post/ingest SKILL.md 갱신 | `grep "멀티페이지\|3.5" skills/knowledge-post/SKILL.md skills/knowledge-ingest/SKILL.md` 가 새 단계 잡음 |
| 전체 회귀 | `npx vitest run test/` 전체 PASS |
| 빌드 | `bun run build` 성공 |
| CHANGELOG | `[Unreleased] / Added` 에 5개 항목 추가 |
| CLAUDE.md | `_log.md` 재생성 금지 1줄 추가 |

## 비-목표 (이 plan 에서 안 다룸)

- 마이그레이션 (옵셔널 필드라 기존 vault 그대로 동작)
- `_log.md` 의 FTS 인덱싱 (별도 plan)
- LLM 자율 위키 편집 — CLAUDE.md "자동 실행 금지" 정책과 충돌. 채택 안 함.
- Karpathy gist의 Layer 1 raw source 보관 — HwiCortex는 jsonl 세션 로그를 ephemeral source 로 보고 있어 별도 보관 불필요.
- 무거운 위키 페이지 타입 스키마 강제 — `kind` 는 옵셔널, 자유 문자열로만 둠.
- 릴리스 (별도 `/release` 스킬 사용)

## Karpathy gist 와 매핑 (참고)

| Karpathy gist 개념 | 이 plan에서 흡수한 형태 |
|---|---|
| `index.md` 의 one-line summaries | Phase A `description` + Phase B `_index.md` 우선 사용 |
| `log.md` (append-only chronological) | Phase C `_log.md` (프로젝트별, 같은 형식) |
| Lint pass: stale claims | Phase D 노후 검사 (E) — `--stale-days` + SKILL.md 검토 단계 |
| Lint pass: contradictions | Phase D 모순 후보 (F) — LLM 후보만 제시, 수정 안 함 |
| 한 source가 10-15 페이지 갱신 | Phase E 멀티페이지 갱신 제안 (Primary/Also-relevant/Should-update 분류) |
| Page type taxonomy (entity/concept/comparison/...) | Phase A `kind` 옵셔널 필드 (decision/howto/incident/concept/reference) — 강제 안 함 |
| LLM owns the wiki entirely | **채택 안 함** — HwiCortex 의 사용자 승인 게이트 정책 우선 |

## 위키 제안 (CLAUDE.md 준수)

이 plan 실행 후, 다음 항목들은 위키 저장 후보로 사용자에게 *제안* 할 만함 (자동 저장 금지):
- "Karpathy LLM-Wiki gist 흡수: description/kind/_log.md/멀티페이지/노후 검사"
- "_log.md 디자인 결정: append-only, FTS 인덱싱 안 함, 재생성 금지"
- "knowledge-tidy 의 노후/모순 검사 단계 추가"
