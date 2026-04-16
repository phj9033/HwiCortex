# Knowledge Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI 대화에서 지식을 자동 추출하여 위키에 축적하고, 작업 전 관련 지식을 검색하여 참고하는 순환 루프를 구축한다.

**Architecture:** 4개의 스킬(knowledge-pre, knowledge-post, knowledge-ingest, knowledge-tidy)이 기존 `hwicortex` CLI를 조합하여 동작. 코드 변경은 `update --embed` 플래그와 `wiki list --json` 지원 2건만 필요.

**Tech Stack:** TypeScript (Bun), hwicortex CLI, Claude Code Skills (SKILL.md)

**Spec:** `docs/superpowers/specs/2026-04-16-knowledge-loop-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/cli/qmd.ts:2577,3196-3198` | `update --embed` 플래그 추가 |
| Modify | `src/cli/wiki.ts:150-163` | `wiki list --json` 출력 |
| Modify | `test/cli.test.ts` | update --embed 테스트 |
| Modify | `test/wiki-cli.test.ts` | wiki list --json 테스트 |
| Create | `skills/knowledge-pre/SKILL.md` | 작업 전 지식 검색 스킬 |
| Create | `skills/knowledge-post/SKILL.md` | 작업 후 지식 저장 스킬 |
| Create | `skills/knowledge-ingest/SKILL.md` | 세션 배치 처리 스킬 |
| Create | `skills/knowledge-tidy/SKILL.md` | 지식 정리 스킬 |
| Modify | `CLAUDE.md` | 플래그 문서화, 자동 저장 예외 규칙 |

---

### Task 1: `wiki list --json` 지원 추가

**Files:**
- Modify: `src/cli/wiki.ts:150-163`
- Test: `test/wiki-cli.test.ts`

- [ ] **Step 1: Write the failing test**

`test/wiki-cli.test.ts`에 테스트 추가:

```typescript
test("list --json outputs JSON array with metadata", () => {
  qmd('wiki create "Test Page" --project test --tags t1,t2 --body "content"', vaultDir);
  qmd('wiki create "Another Page" --project test --tags t2,t3 --body "more"', vaultDir);
  const out = qmd("wiki list --project test --json", vaultDir);
  const pages = JSON.parse(out);
  expect(Array.isArray(pages)).toBe(true);
  expect(pages).toHaveLength(2);
  expect(pages[0]).toHaveProperty("title");
  expect(pages[0]).toHaveProperty("project", "test");
  expect(pages[0]).toHaveProperty("tags");
  expect(pages[0]).toHaveProperty("importance");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/wiki-cli.test.ts -t "list --json" --reporter=verbose`
Expected: FAIL — 현재 `wiki list`는 plain text를 출력하므로 JSON.parse 실패

- [ ] **Step 3: Implement wiki list --json**

`src/cli/wiki.ts` line 150의 `case "list"` 블록 수정:

```typescript
case "list": {
  const pages = listWikiPages(vaultDir, {
    project: flags.project as string | undefined,
    tag: flags.tag as string | undefined,
  });
  if (flags.json) {
    // WikiMeta 전체 필드 출력 (filePath만 제외)
    // title, project, tags, sources, related, count_*, importance, hit_count, etc.
    const jsonPages = pages.map(({ filePath, ...rest }) => rest);
    console.log(JSON.stringify(jsonPages, null, 2));
  } else if (pages.length === 0) {
    console.log("No wiki pages found.");
  } else {
    for (const p of pages) {
      const tags = p.tags.length > 0 ? ` [${p.tags.join(", ")}]` : "";
      console.log(`${p.title} (${p.project})${tags}`);
    }
  }
  break;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/wiki-cli.test.ts -t "list --json" --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/wiki.ts test/wiki-cli.test.ts
git commit -m "feat(wiki): add --json output support to wiki list"
```

---

### Task 2: `update --embed` 플래그 추가

**Files:**
- Modify: `src/cli/qmd.ts:2577,3196-3198`
- Test: `test/cli.test.ts`

- [ ] **Step 1: Write the failing test**

`test/cli.test.ts`의 update describe 블록에 추가:

```typescript
test("update --embed runs embedding after index", async () => {
  const { stdout, exitCode } = await runQmd(["update", "--embed"], { dbPath: localDbPath });
  expect(exitCode).toBe(0);
  // --embed 플래그에 의해 추가된 메시지 확인
  expect(stdout).toContain("Running embedding for updated content");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/cli.test.ts -t "update --embed" --reporter=verbose`
Expected: FAIL — `--embed` 플래그가 파싱되지만 update 로직에서 사용되지 않음

- [ ] **Step 3: Add --embed flag option**

`src/cli/qmd.ts` line 2577 근처, 기존 `pull` 옵션 아래에 추가:

```typescript
pull: { type: "boolean" },  // git pull before update
embed: { type: "boolean" },  // run embedding after update
```

- [ ] **Step 4: Implement --embed in update command**

`src/cli/qmd.ts` line 3196의 `case "update"` 수정:

```typescript
case "update":
  await updateCollections();
  if (cli.values.embed) {
    console.log(`\n${c.dim}Running embedding for updated content...${c.reset}`);
    try {
      await vectorIndex(DEFAULT_EMBED_MODEL_URI, false);
    } catch (error) {
      console.error(`Embedding failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  break;
```

주의: `updateCollections()` 내부에서 `closeDb()`를 호출하므로, embed 전에 DB가 닫히는 문제가 있을 수 있음. `updateCollections()` 함수 line 625의 `closeDb()` 호출을 확인하고, `--embed` 시에는 DB를 닫지 않도록 조정이 필요할 수 있음. `vectorIndex()`가 자체적으로 `getStore()`를 호출하여 DB를 다시 여므로 문제 없을 수 있지만, 테스트로 확인할 것.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/cli.test.ts -t "update --embed" --reporter=verbose`
Expected: PASS

- [ ] **Step 6: Run full update test suite**

Run: `npx vitest run test/cli.test.ts -t "update" --reporter=verbose`
Expected: 기존 테스트 + 새 테스트 모두 PASS

- [ ] **Step 7: Commit**

```bash
git add src/cli/qmd.ts test/cli.test.ts
git commit -m "feat(cli): add --embed flag to update command"
```

---

### Task 3: knowledge-pre 스킬 작성

**Files:**
- Create: `skills/knowledge-pre/SKILL.md`

- [ ] **Step 1: Create skill file**

```markdown
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
```

- [ ] **Step 2: Verify skill file structure**

Run: `head -5 skills/knowledge-pre/SKILL.md` — frontmatter가 올바른지 확인
기존 스킬과 비교: `head -5 skills/wiki-save/SKILL.md`

- [ ] **Step 3: Commit**

```bash
git add skills/knowledge-pre/SKILL.md
git commit -m "feat(skill): add knowledge-pre skill for pre-work knowledge search"
```

---

### Task 4: knowledge-post 스킬 작성

**Files:**
- Create: `skills/knowledge-post/SKILL.md`

- [ ] **Step 1: Create skill file**

```markdown
---
name: knowledge-post
description: Extract insights from the current conversation and save to wiki automatically after task completion. Also available as /knowledge-post.
user_invocable: true
---

# Knowledge Post — 작업 후 지식 저장

작업 완료 후 대화에서 인사이트를 추출하여 위키에 자동 저장한다.

## 트리거

- 자동: 작업 완료 시점 (커밋 후, 또는 사용자가 완료를 확인했을 때)
- 수동: `/knowledge-post`

## Process

1. **대화 분석**
   현재 대화를 분석하여 저장할 만한 인사이트를 판단한다:
   - 버그 원인과 해법
   - 아키텍처 결정과 근거
   - 재사용 가능한 패턴/절차
   - 삽질 경험 (이렇게 하면 안 된다)
   - 설정/환경 관련 발견

   저장할 인사이트가 없으면 → **아무 출력 없이 조용히 종료**.

2. **인사이트별 중복 체크**
   각 인사이트에 대해:
   ```bash
   hwicortex search -c wiki "<인사이트 핵심 키워드>" -n 3 --json
   ```

3. **저장 분기**

   **A) 유사 문서 발견 시** → 기존 문서에 append:
   ```bash
   hwicortex wiki update "<기존 문서 title>" --project <project> --append "<새 인사이트 내용>"
   ```

   **B) 유사 문서 없음** → 새 문서 생성:
   ```bash
   echo "<body 내용>" | hwicortex wiki create "<title>" --project <project> --tags <tag1,tag2> --auto-merge --stdin
   ```

   에러 발생 시 → 에러 메시지를 리포트에 포함하고 다음 인사이트 처리 계속.

4. **관련 문서 링크**
   검색 중 관련 문서를 발견했으면:
   ```bash
   hwicortex wiki link "<새/업데이트된 문서>" "<관련 문서>" --project <project>
   ```

5. **인덱스 갱신**
   모든 저장 완료 후 1회 실행:
   ```bash
   hwicortex update --embed
   ```

6. **리포트 출력**
   ```
   📝 지식 저장 완료:
     - 업데이트: "<title>" (+추가된 내용 요약)
     - 신규: "<title>" (tags: tag1, tag2)
     - 링크: "<A>" ↔ "<B>"
   ```

## Rules

- **승인 없이 자동 저장한다.** 이것은 CLAUDE.md의 "자동 실행 금지" 규칙의 명시적 예외이다.
- 저장할 인사이트가 없으면 조용히 종료. 불필요한 출력 금지.
- 프로젝트명은 현재 작업 디렉토리 이름 또는 CLAUDE.md에서 추론.
- body 내용은 간결한 참고 자료 형태로 작성. 대화 전문을 그대로 넣지 말 것.
- 하나의 인사이트 = 하나의 위키 페이지 원칙. 여러 주제를 한 페이지에 섞지 말 것.
- CLI 에러 시 해당 인사이트를 건너뛰고 다음으로 진행.
```

- [ ] **Step 2: Verify skill file structure**

Run: `head -5 skills/knowledge-post/SKILL.md`

- [ ] **Step 3: Commit**

```bash
git add skills/knowledge-post/SKILL.md
git commit -m "feat(skill): add knowledge-post skill for auto knowledge extraction"
```

---

### Task 5: knowledge-ingest 스킬 작성

**Files:**
- Create: `skills/knowledge-ingest/SKILL.md`

- [ ] **Step 1: Create skill file**

```markdown
---
name: knowledge-ingest
description: Batch process local AI session files, review extracted insights with user, and save selected ones to wiki. Use /knowledge-ingest to start.
user_invocable: true
---

# Knowledge Ingest — 세션 배치 처리

로컬 AI 세션 파일들을 읽어 인사이트를 추출하고, 사용자와 문답하며 선별하여 위키에 저장한다.

## 트리거

- 수동 전용: `/knowledge-ingest` 또는 `/knowledge-ingest --project <name>`

## Process

1. **미처리 세션 스캔**
   ```bash
   hwicortex extract --dry-run
   ```
   처리 가능한 세션 목록과 각 세션 요약을 표시.
   미처리 세션이 없으면 → `처리할 세션이 없습니다.` 출력 후 종료.

2. **세션 선택 (사용자 문답)**
   ```
   N개 미처리 세션 발견:
     1. 2026-04-15 — Bun SQLite 동시성 디버깅
     2. 2026-04-14 — 그래프 클러스터링 개선
     3. 2026-04-13 — 위키 링크 기능 추가

   전체 처리? 또는 번호 선택? (예: 1,3)
   ```
   사용자 응답을 기다린다.

3. **선택된 세션 처리**
   각 세션에 대해:
   ```bash
   hwicortex extract --session <id>
   ```
   LLM이 추출한 인사이트 목록을 제시:
   ```
   세션 "Bun SQLite 동시성 디버깅"에서 추출:
     [1] Bun SQLite WAL 모드 설정법 → 저장?
     [2] 동시 쓰기 시 BUSY 에러 원인과 해법 → 저장?
     [3] vitest 테스트 픽스처 패턴 → 저장?

   전체 승인(a) / 번호 선택 / 스킵(s)?
   ```
   사용자 응답을 기다린다.

4. **승인된 인사이트를 wiki로 저장**
   각 승인된 인사이트에 대해:

   중복 체크:
   ```bash
   hwicortex search -c wiki "<인사이트 키워드>" -n 3 --json
   ```

   유사 문서 있음:
   ```bash
   hwicortex wiki update "<title>" --project <project> --append "<인사이트>"
   ```

   유사 문서 없음:
   ```bash
   echo "<body>" | hwicortex wiki create "<title>" --project <project> --tags <tags> --auto-merge --stdin
   ```

   관련 문서 링크:
   ```bash
   hwicortex wiki link "<문서A>" "<문서B>" --project <project>
   ```

5. **인덱스 갱신**
   모든 저장 완료 후 1회:
   ```bash
   hwicortex update --embed
   ```

6. **리포트 출력**
   ```
   📥 인제스트 완료 (N개 세션 처리):
     - 신규: M건
     - 업데이트: K건
     - 스킵: J건
   ```

## Rules

- 항상 사용자와 문답하며 진행. 자동 저장 없음.
- 세션 선택, 인사이트 선택 모두 사용자 승인 필요.
- 프로젝트명은 인자로 받거나, 없으면 사용자에게 질문.
- extract 실패 시 에러 보고 후 다음 세션으로 진행.
```

- [ ] **Step 2: Verify skill file structure**

Run: `head -5 skills/knowledge-ingest/SKILL.md`

- [ ] **Step 3: Commit**

```bash
git add skills/knowledge-ingest/SKILL.md
git commit -m "feat(skill): add knowledge-ingest skill for batch session processing"
```

---

### Task 6: knowledge-tidy 스킬 작성

**Files:**
- Create: `skills/knowledge-tidy/SKILL.md`

- [ ] **Step 1: Create skill file**

```markdown
---
name: knowledge-tidy
description: Review and tidy wiki knowledge base — merge duplicates, fix links, clean tags, remove low-importance pages. Use /knowledge-tidy to start.
user_invocable: true
---

# Knowledge Tidy — 지식 정리

위키 지식베이스를 정리한다. 중복 병합, 링크 보강, 태그 통일, 저importance 문서 정리.

## 트리거

- 수동 전용: `/knowledge-tidy` 또는 `/knowledge-tidy --project <name>`

## Process

1. **현황 파악**
   ```bash
   hwicortex wiki list --project <project> --json
   ```
   전체 문서 수, importance 분포, 태그 분포를 요약 표시:
   ```
   📊 위키 현황 (project: hwicortex):
     - 문서 수: 42
     - importance 분포: 0 (15건), 1-5 (12건), 6-10 (8건), 11+ (7건)
     - 태그 TOP 5: sqlite(12), bug(8), architecture(6), bun(5), config(4)
   ```
   프로젝트가 지정되지 않았으면 사용자에게 질문.

2. **정리 항목 분석 & 제안**

   **A) 중복/유사 문서 병합 후보**
   타이틀과 태그가 유사한 문서 쌍을 탐지. 내용 비교가 필요하면:
   ```bash
   hwicortex wiki show "<titleA>" --project <project>
   hwicortex wiki show "<titleB>" --project <project>
   ```
   제안:
   ```
   🔄 병합 후보:
     1. "Session Timeout 처리" + "세션 만료 대응" → 하나로 통합?
     2. "SQLite WAL" + "SQLite Write-Ahead Logging" → 하나로 통합?
   ```

   **B) 링크 보강**
   관련 내용이지만 링크되지 않은 문서:
   ```
   🔗 링크 제안:
     1. "Bun SQLite Lock" ↔ "SQLite 동시성 패턴"
   ```

   **C) 태그 정리**
   유사/중복 태그 통일:
   ```
   🏷 태그 통일 제안:
     - "db", "database", "sqlite" → "sqlite"로 통일?
   ```

   **D) 저importance 문서 정리**
   importance 0이고 30일 이상 접근 없는 문서:
   ```
   🗑 삭제 후보 (importance: 0, 장기 미접근):
     1. "임시 테스트 메모" (created: 2026-03-01)
   ```

3. **사용자 문답**
   각 항목별로 승인/수정/스킵:
   ```
   위 제안을 항목별로 진행합니다:
   병합 1: "Session Timeout 처리" + "세션 만료 대응" → 승인(y) / 스킵(s)?
   ```

4. **실행**
   승인된 항목만 실행:

   병합:
   ```bash
   hwicortex wiki show "<병합 대상>" --project <project>
   # 내용을 합쳐서:
   hwicortex wiki update "<유지할 문서>" --project <project> --append "<병합할 내용>"
   hwicortex wiki rm "<삭제할 문서>" --project <project>
   ```

   링크:
   ```bash
   hwicortex wiki link "<A>" "<B>" --project <project>
   ```

   태그 변경:
   ```bash
   hwicortex wiki update "<title>" --project <project> --tags <new,tags>
   ```

   삭제:
   ```bash
   hwicortex wiki rm "<title>" --project <project>
   ```

5. **인덱스 갱신**
   ```bash
   hwicortex wiki index --project <project>
   hwicortex update --embed
   ```

6. **리포트**
   ```
   🧹 정리 완료:
     - 병합: 2건
     - 링크 추가: 3건
     - 태그 통일: 5건
     - 삭제: 1건
   ```

## Rules

- **항상 문답 기반.** 자동 삭제/병합 절대 금지.
- 모든 변경은 승인 후에만 실행.
- 병합 시 중요도가 높은 쪽을 유지하고 낮은 쪽을 삭제.
- 삭제 전 반드시 show로 내용을 확인하고 사용자에게 보여줌.
```

- [ ] **Step 2: Verify skill file structure**

Run: `head -5 skills/knowledge-tidy/SKILL.md`

- [ ] **Step 3: Commit**

```bash
git add skills/knowledge-tidy/SKILL.md
git commit -m "feat(skill): add knowledge-tidy skill for wiki maintenance"
```

---

### Task 7: CLAUDE.md 업데이트

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update wiki create command documentation**

CLAUDE.md의 `wiki create` 항목에 누락된 플래그 추가:

```
wiki create "제목" --project <n> [--tags t1,t2] [--body "..."] [--stdin] [--auto-merge] [--force]
```

- [ ] **Step 2: Add update --embed to CLI reference**

```
update [--pull] [--embed]    # --embed: 인덱스 갱신 후 임베딩 자동 실행
```

- [ ] **Step 3: Add knowledge-post auto-save exception**

위키 제안 규칙 섹션에 추가:

```
예외: knowledge-post 스킬은 승인 없이 wiki 저장 및 `hwicortex update --embed` 자동 실행한다 (리포트만 출력).
```

- [ ] **Step 4: Add wiki collection setup guide**

CLAUDE.md 하단 또는 적절한 위치에 지식 루프 설정 가이드 추가:

```markdown
## 지식 루프 설정

```sh
# wiki vault를 컬렉션으로 등록 (1회)
hwicortex collection add <vault>/wiki --name wiki --mask "**/*.md"
hwicortex update --embed
```

스킬: `/knowledge-pre`, `/knowledge-post`, `/knowledge-ingest`, `/knowledge-tidy`
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with knowledge loop CLI flags and rules"
```

---

### Task 8: 통합 테스트 및 검증

- [ ] **Step 1: Run full test suite**

```bash
npx vitest run --reporter=verbose test/
```

모든 기존 테스트 + 새 테스트 PASS 확인.

- [ ] **Step 2: Verify skill files are well-formed**

각 스킬 파일의 frontmatter가 올바른지 확인:
```bash
for skill in knowledge-pre knowledge-post knowledge-ingest knowledge-tidy; do
  echo "=== $skill ==="
  head -6 skills/$skill/SKILL.md
done
```

- [ ] **Step 3: Manual smoke test — wiki list --json**

```bash
bun src/cli/qmd.ts wiki list --json | head -20
```

JSON 출력 확인.

- [ ] **Step 4: Commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: address integration test findings"
```
