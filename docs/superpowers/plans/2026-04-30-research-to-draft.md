# Research-to-Draft Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a research-to-draft pipeline under `src/research/` that gathers web sources for a topic, builds curated knowledge cards and synthesis notes inside the user's hwicortex vault (so they enter RAG automatically), and produces AI-written drafts grounded in those documents.

**Architecture:** Adapter pattern. `pipeline/` orchestrates `sources/` (Discovery) → `core/fetcher` → `extractors/` → `store/staging` → `llm/card` → `store/cards`. Synthesis and draft layers consume cards/notes, calling Anthropic API. Stage 3 (RAG) is automatic because notes live in the indexed vault. Each pipeline function is also exposed as Anthropic tool-use definitions and as `skills/research/*` slash-commands.

**Tech Stack:** Bun + TypeScript, Zod, `@anthropic-ai/sdk` (already installed), `yaml` (already), `pdfjs-dist` (already, reused), Mozilla Readability + turndown (new), node `fetch` (built-in), vitest (existing).

**Spec:** `docs/superpowers/specs/2026-04-30-research-to-draft-design.md`

---

## Progress

_Last updated: 2026-05-01_

- **Branch / worktree:** `feat/research-pipeline` at `.worktrees/research-pipeline/` (37 commits ahead of `main`)
- **Done:** Phase A (A0–A3), Phase B (B0–B8), Phase C (C1–C5), Phase D (D1–D3), Phase E (E1–E6), Phase F (F1–F2)
- **Resume from:** Phase G — Task G1 (Draft prompt + writer, plan line ~3050)
- **All research tests:** 91/91 PASS via `npx vitest run test/research/` (~1.03s)
- **Notes for next session:**
  - Memory overheats on full `npx vitest run test/` — restrict to `test/research/` during work.
  - Intentional plan deviations on this branch (all documented in commit messages):
    1. `robots.ts`, `arxiv.ts`, `web-search.ts` use native `fetch()` instead of `undici.request` (MSW compat; `undici` is not a dep on this branch).
    2. C2 / E1 / E3 fixtures are synthesised, not captured real-world responses.
    3. C5 early-dispatches `research` in `qmd.ts` before `parseCLI()` so research-specific flags don't pollute the global parser.
    4. D3 explicitly adds `cardsEnabled: false` to the existing slice-1 fetch tests so the default `topic.cards.enabled = true` doesn't trigger a real Anthropic client during those tests.
    5. E6 introduces `parsePdfBuffer()` in `src/ingest/pdf-parser.ts` (existing `PdfParser` only took a file path; pipeline needs an in-memory variant) and explicitly copies into a fresh `Uint8Array` because pdfjs rejects Node `Buffer` instances.

---

## File Structure

### New files (`src/research/`)

```
src/research/
├── index.ts                      # SDK exports
├── topic/
│   ├── schema.ts                 # Zod TopicSpec + sub-schemas
│   ├── loader.ts                 # YAML → TopicSpec, ad-hoc topic from short NL
│   └── paths.ts                  # vault-relative path helpers
├── core/
│   ├── types.ts                  # RawRecord, FetchedDoc, Card, etc.
│   ├── url.ts                    # canonicalize URL
│   ├── fetcher.ts                # HTTP + ETag/LM
│   ├── cache.ts                  # _staging cache layout
│   ├── robots.ts                 # robots.txt parsing
│   ├── rate-limit.ts             # per-domain rate limiter
│   ├── dedup.ts                  # body_hash + URL dedup
│   ├── quality.ts                # filters (lang, length, paywall)
│   ├── budget.ts                 # URLs/bytes/USD accumulator
│   └── lang.ts                   # language detection wrapper
├── sources/
│   ├── types.ts                  # Discovery interface
│   ├── seed-urls.ts
│   ├── arxiv.ts
│   ├── rss.ts
│   ├── web-search.ts             # Brave + Tavily under one adapter
│   └── from-document.ts          # parse document for URLs (or use-as-cards)
├── extractors/
│   ├── types.ts                  # Extractor interface
│   ├── html.ts                   # Readability + turndown
│   ├── pdf.ts                    # reuse src/ingest/pdf-parser.ts
│   └── feed.ts                   # RSS/Atom item → FetchedDoc
├── llm/
│   ├── client.ts                 # Anthropic client factory + cost tracking hook
│   ├── card.ts                   # Haiku prompt + schema validation + quote-substring guard
│   ├── synthesize.ts             # Sonnet prompt for clusters / overview / subtopic
│   └── draft.ts                  # Sonnet prompt for drafts
├── store/
│   ├── staging.ts                # raw.jsonl append-only + dedup index
│   ├── cards.ts                  # notes/<id>/sources/*.md
│   ├── synthesis.ts              # notes/<id>/<subtopic>.md
│   ├── drafts.ts                 # drafts/<id>/<date>-<slug>.md
│   └── log.ts                    # run-log.jsonl
├── pipeline/
│   ├── fetch.ts                  # discovery → fetch → extract → quality → store → cards
│   ├── synthesize.ts             # cluster → write synthesis notes
│   └── draft.ts                  # RAG context → Sonnet draft
└── agent/
    └── tools.ts                  # researchTools[] + executeResearchTool
```

### Modified files

- `src/cli/qmd.ts` — add `research` subcommand router that dispatches to `src/cli/research.ts`
- `src/cli/research.ts` (new) — CLI surface
- `config/default.yml` — add `research:` section
- `package.json` — add deps: `@mozilla/readability`, `jsdom`, `turndown`, `rss-parser`
- `CHANGELOG.md` — add `## [Unreleased]` entry per release rules
- `skills/research/{research-pre,research-build,research-draft,research-tidy}/SKILL.md` (new)

### New test files (`test/research/`)

```
test/research/
├── topic/
│   ├── schema.test.ts
│   └── loader.test.ts
├── core/
│   ├── url.test.ts
│   ├── dedup.test.ts
│   ├── quality.test.ts
│   ├── budget.test.ts
│   ├── fetcher.test.ts
│   └── rate-limit.test.ts
├── sources/
│   ├── seed-urls.test.ts
│   ├── arxiv.test.ts
│   ├── rss.test.ts
│   ├── web-search.test.ts
│   └── from-document.test.ts
├── extractors/
│   ├── html.test.ts
│   └── feed.test.ts
├── llm/
│   ├── card.test.ts
│   ├── synthesize.test.ts
│   └── draft.test.ts
├── store/
│   ├── staging.test.ts
│   ├── cards.test.ts
│   ├── synthesis.test.ts
│   └── drafts.test.ts
├── pipeline/
│   ├── fetch.test.ts
│   ├── synthesize.test.ts
│   └── draft.test.ts
└── fixtures/
    ├── html/                     # saved HTML pages for golden tests
    ├── pdf/                      # sample PDFs
    ├── rss/                      # RSS XML samples
    ├── arxiv/                    # arXiv API responses
    └── topics/                   # sample topic YAML files
```

---

## Conventions

- **Bun, not node/npm.** Run tests with `bunx vitest run`. Run CLI with `bun src/cli/qmd.ts research <args>`.
- **Tests are `.test.ts` colocated under `test/research/` mirroring `src/research/` tree.**
- **TDD**: write the failing test, watch it fail, write minimal code, watch it pass, commit.
- **All HTTP and Anthropic calls are mocked in tests.** Use `msw` for HTTP. Use a small in-house Anthropic mock — see Task B0.
- **Do not run `hwicortex`/`qmd` indexing commands during tests.** Tests stay hermetic.
- **Commits**: per task. Use Conventional Commits (`feat:`, `test:`, `refactor:`). Sign-off line `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- **No new env vars besides the two secrets** (`ANTHROPIC_API_KEY`, `BRAVE_SEARCH_API_KEY` / `TAVILY_API_KEY`).
- **ESM rule.** `package.json` declares `"type": "module"`, so `__dirname` and `__filename` are NOT defined. In test fixtures and any other place that needs a file-relative path, use:
  ```ts
  import { fileURLToPath } from "url";
  import { dirname, join } from "path";
  const __dirname = dirname(fileURLToPath(import.meta.url));
  ```
  Apply this in every test that does `join(__dirname, "../fixtures/...")`. The plan code blocks below assume this idiom is in scope; copy it into the test file.

---

## Phase A — Foundation: dependencies, topic schema, config

### Task A0: Add new dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add deps**

```bash
bun add @mozilla/readability jsdom turndown rss-parser
bun add -D msw @types/jsdom
# turndown ships its own typings; only add @types/turndown if `bun run build` complains
```

- [ ] **Step 2: Verify install**

Run: `bun install && bun run build`
Expected: builds clean, no TS errors.

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lock
git commit -m "feat(research): add deps for HTML extraction and RSS parsing"
```

### Task A1: Topic Zod schema

**Files:**
- Create: `src/research/topic/schema.ts`
- Test: `test/research/topic/schema.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// test/research/topic/schema.test.ts
import { describe, it, expect } from "vitest";
import { TopicSpec, parseTopic } from "../../../src/research/topic/schema.js";

describe("TopicSpec", () => {
  it("accepts a minimal valid topic", () => {
    const ok = parseTopic({
      id: "rag-eval",
      title: "RAG eval",
      sources: [{ type: "seed-urls", urls: ["https://example.com"] }],
    });
    expect(ok.id).toBe("rag-eval");
  });

  it("rejects invalid id slug", () => {
    expect(() => parseTopic({ id: "RAG Eval!", title: "", sources: [] }))
      .toThrow(/id/);
  });

  it("discriminates source types", () => {
    const t = parseTopic({
      id: "x", title: "x",
      sources: [
        { type: "web-search", queries: ["foo"] },
        { type: "arxiv", queries: ["bar"], categories: ["cs.CL"] },
        { type: "rss", feeds: ["https://e.com/rss"] },
        { type: "from-document", path: "./b.md", mode: "seeds-only" },
      ],
    });
    expect(t.sources).toHaveLength(4);
  });

  it("supplies budget defaults", () => {
    const t = parseTopic({ id: "x", title: "x", sources: [] });
    expect(t.budget.max_new_urls).toBe(100);
    expect(t.budget.max_total_bytes).toBe(50_000_000);
    expect(t.budget.max_llm_cost_usd).toBe(0.5);
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `bunx vitest run test/research/topic/schema.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement schema**

```ts
// src/research/topic/schema.ts
import { z } from "zod";

const ID_RE = /^[a-z0-9-]+$/;

const SourceWebSearch = z.object({
  type: z.literal("web-search"),
  queries: z.array(z.string().min(1)).min(1),
  site_filters: z.array(z.string()).default([]),
  since: z.string().optional(),  // ISO date
  top_k_per_query: z.number().int().min(1).max(50).default(10),
});

const SourceArxiv = z.object({
  type: z.literal("arxiv"),
  queries: z.array(z.string().min(1)).min(1),
  categories: z.array(z.string()).default([]),
  top_k: z.number().int().min(1).max(200).default(30),
});

const SourceRss = z.object({
  type: z.literal("rss"),
  feeds: z.array(z.string().url()).min(1),
});

const SourceSeedUrls = z.object({
  type: z.literal("seed-urls"),
  urls: z.array(z.string().url()).min(1),
});

const SourceFromDocument = z.object({
  type: z.literal("from-document"),
  path: z.string().min(1),
  mode: z.enum(["seeds-only", "use-as-cards"]).default("seeds-only"),
  refetch: z.boolean().default(false),
});

const SourceSpec = z.discriminatedUnion("type", [
  SourceWebSearch, SourceArxiv, SourceRss, SourceSeedUrls, SourceFromDocument,
]);

const Filters = z.object({
  min_words: z.number().int().min(0).default(200),
  max_words: z.number().int().min(0).default(50_000),
  exclude_domains: z.array(z.string()).default([]),
  require_lang: z.string().nullable().default(null),
}).default({});

const Budget = z.object({
  max_new_urls: z.number().int().min(1).default(100),
  max_total_bytes: z.number().int().min(1).default(50_000_000),
  max_llm_cost_usd: z.number().min(0).default(0.5),
}).default({});

const Cards = z.object({
  enabled: z.boolean().default(true),
  model: z.string().default("claude-haiku-4-5"),
}).default({});

export const TopicSpec = z.object({
  id: z.string().regex(ID_RE, "id must match ^[a-z0-9-]+$"),
  title: z.string(),
  description: z.string().default(""),
  languages: z.array(z.string()).default([]),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  sources: z.array(SourceSpec).default([]),
  filters: Filters,
  budget: Budget,
  cards: Cards,
});

export type TopicSpec = z.infer<typeof TopicSpec>;
export type SourceSpec = z.infer<typeof SourceSpec>;

export function parseTopic(input: unknown): TopicSpec {
  return TopicSpec.parse(input);
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `bunx vitest run test/research/topic/schema.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/research/topic/schema.ts test/research/topic/schema.test.ts
git commit -m "feat(research): add topic Zod schema with discriminated source types"
```

### Task A2: Topic loader (YAML + ad-hoc)

**Files:**
- Create: `src/research/topic/loader.ts`
- Create: `src/research/topic/paths.ts`
- Test: `test/research/topic/loader.test.ts`

- [ ] **Step 1: Path helpers**

```ts
// src/research/topic/paths.ts
import { join } from "path";

export function topicYamlPath(vault: string, id: string): string {
  return join(vault, "research", "topics", `${id}.yml`);
}
export function stagingDir(vault: string, id: string): string {
  return join(vault, "research", "_staging", id);
}
export function notesDir(vault: string, id: string): string {
  return join(vault, "research", "notes", id);
}
export function sourcesDir(vault: string, id: string): string {
  return join(notesDir(vault, id), "sources");
}
export function draftsDir(vault: string, id: string): string {
  return join(vault, "research", "drafts", id);
}
```

- [ ] **Step 2: Write failing tests**

```ts
// test/research/topic/loader.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { loadTopic, adhocTopicFromPrompt } from "../../../src/research/topic/loader.js";

let vault: string;
beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "vault-"));
  mkdirSync(join(vault, "research", "topics"), { recursive: true });
});

describe("loadTopic", () => {
  it("loads a YAML topic", async () => {
    writeFileSync(join(vault, "research", "topics", "rag-eval.yml"),
`id: rag-eval
title: "RAG"
sources:
  - type: seed-urls
    urls: ["https://example.com"]
`);
    const t = await loadTopic("rag-eval", vault);
    expect(t.id).toBe("rag-eval");
    expect(t.sources).toHaveLength(1);
  });

  it("throws clear error for missing topic", async () => {
    await expect(loadTopic("nope", vault)).rejects.toThrow(/not found/i);
  });
});

describe("adhocTopicFromPrompt", () => {
  it("produces a slug + single web-search source", () => {
    const t = adhocTopicFromPrompt("RAG 평가 방법");
    expect(t.id).toMatch(/^[a-z0-9-]+$/);
    expect(t.sources[0].type).toBe("web-search");
  });

  it("is deterministic for same input", () => {
    expect(adhocTopicFromPrompt("foo bar").id).toBe(adhocTopicFromPrompt("foo bar").id);
  });
});
```

- [ ] **Step 3: Run, expect fail**

- [ ] **Step 4: Implement loader**

```ts
// src/research/topic/loader.ts
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { parse as parseYaml } from "yaml";
import { createHash } from "crypto";
import { TopicSpec, parseTopic } from "./schema.js";
import { topicYamlPath } from "./paths.js";

export async function loadTopic(id: string, vaultPath: string): Promise<TopicSpec> {
  const path = topicYamlPath(vaultPath, id);
  if (!existsSync(path)) {
    throw new Error(`topic not found: ${id} (expected at ${path})`);
  }
  const raw = await readFile(path, "utf-8");
  return parseTopic(parseYaml(raw));
}

export function adhocTopicFromPrompt(prompt: string): TopicSpec {
  const slug = slugify(prompt) + "-" + createHash("sha256").update(prompt).digest("hex").slice(0, 6);
  return parseTopic({
    id: slug,
    title: prompt,
    sources: [{ type: "web-search", queries: [prompt] }],
  });
}

function slugify(s: string): string {
  return s.toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/[^a-z0-9-]/g, "x") || "topic";
}
```

- [ ] **Step 5: Run tests, expect pass**

- [ ] **Step 6: Commit**

```bash
git add src/research/topic/ test/research/topic/loader.test.ts
git commit -m "feat(research): add topic YAML loader and ad-hoc topic generator"
```

### Task A3: Extend `config/default.yml` with `research:` section

**Files:**
- Modify: `config/default.yml`

- [ ] **Step 1: Add the section**

Append to `config/default.yml`:

```yaml
research:
  models:
    card:  claude-haiku-4-5
    synth: claude-sonnet-4-6
    draft: claude-sonnet-4-6
  search:
    provider: brave
    brave:
      api_key: ${BRAVE_SEARCH_API_KEY}
    tavily:
      api_key: ${TAVILY_API_KEY}
  fetch:
    user_agent: "hwicortex-research/0.1"
    rate_limit_per_domain_qps: 1
    timeout_ms: 30000
    max_redirects: 5
  budget:
    max_new_urls: 100
    max_total_bytes: 50_000_000
    max_llm_cost_usd: 0.50
  draft:
    default_top_k: 12
    include_vault_default: false
```

- [ ] **Step 2: Build, ensure no parse error**

Run: `bun run build`

- [ ] **Step 3: Commit**

```bash
git add config/default.yml
git commit -m "feat(research): add research section to default config"
```

---

## Phase B — Core infrastructure

### Task B0: Anthropic test mock harness

**Files:**
- Create: `src/research/llm/client.ts`
- Create: `test/research/_helpers/anthropic-mock.ts`

- [ ] **Step 1: Implement a thin client wrapper**

```ts
// src/research/llm/client.ts
import Anthropic from "@anthropic-ai/sdk";

export type LlmCallOptions = {
  model: string;
  system?: string;
  messages: { role: "user" | "assistant"; content: string }[];
  max_tokens?: number;
  temperature?: number;
};

export type LlmCallResult = {
  text: string;
  usage: { input_tokens: number; output_tokens: number };
  cost_usd: number;
  model: string;
};

// Pricing (USD per million tokens) — keep in code; revisit if pricing changes.
const PRICING: Record<string, { in: number; out: number }> = {
  "claude-haiku-4-5":   { in: 1.0,  out: 5.0  },
  "claude-sonnet-4-6":  { in: 3.0,  out: 15.0 },
};

export interface LlmClient {
  call(opts: LlmCallOptions): Promise<LlmCallResult>;
}

export function createAnthropicClient(): LlmClient {
  const client = new Anthropic();
  return {
    async call(opts) {
      const r = await client.messages.create({
        model: opts.model,
        system: opts.system,
        max_tokens: opts.max_tokens ?? 1024,
        temperature: opts.temperature ?? 0.2,
        messages: opts.messages,
      });
      const text = r.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
      const p = PRICING[opts.model] ?? { in: 0, out: 0 };
      const cost =
        (r.usage.input_tokens * p.in) / 1_000_000 +
        (r.usage.output_tokens * p.out) / 1_000_000;
      return { text, usage: r.usage, cost_usd: cost, model: opts.model };
    },
  };
}
```

- [ ] **Step 2: Implement test mock**

```ts
// test/research/_helpers/anthropic-mock.ts
import type { LlmClient, LlmCallOptions, LlmCallResult } from "../../../src/research/llm/client.js";

export function mockLlm(scripted: Array<string | ((opts: LlmCallOptions) => string)>): LlmClient {
  let i = 0;
  return {
    async call(opts) {
      const next = scripted[i++ % scripted.length];
      const text = typeof next === "function" ? next(opts) : next;
      return {
        text,
        usage: { input_tokens: 100, output_tokens: 50 },
        cost_usd: 0.001,
        model: opts.model,
      } satisfies LlmCallResult;
    },
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add src/research/llm/client.ts test/research/_helpers/anthropic-mock.ts
git commit -m "feat(research): add Anthropic client wrapper and test mock helper"
```

### Task B1: Core types

**Files:**
- Create: `src/research/core/types.ts`

- [ ] **Step 1: Implement types**

```ts
// src/research/core/types.ts

export type ContentType = "html" | "pdf" | "feed-item";

export type FetchedDoc = {
  url: string;
  canonical_url: string;
  status: number;
  fetched_at: string;       // ISO
  content_type: ContentType;
  body_bytes: Buffer;
  body_text?: string;
  cache_blob: string | null;
};

export type RawRecord = {
  id: string;               // sha256(canonical_url)[:12]
  topic_id: string;
  source_type: "web-search" | "arxiv" | "rss" | "seed-urls" | "from-document";
  url: string;
  canonical_url: string;
  title: string | null;
  author: string | null;
  published_at: string | null;
  fetched_at: string;
  content_type: ContentType;
  language: string | null;
  body_md: string;
  word_count: number;
  body_hash: string;
  source_meta: Record<string, unknown>;
  cache_blob: string | null;
};

export type Card = {
  source_id: string;
  topic_id: string;
  url: string;
  title: string;
  author: string | null;
  published: string | null;
  fetched: string;
  language: string | null;
  tags: string[];
  body_hash: string;
  tldr: string[];           // 3–7 bullets
  excerpts: string[];       // verbatim, validated as substring
};

export type SynthesisNote = {
  topic_id: string;
  subtopic: string;         // "overview" or slug
  generated_at: string;
  model: string;
  source_cards: string[];
  body_md: string;          // includes footnotes already
};

export type Draft = {
  topic_id: string;
  slug: string;
  prompt: string;
  generated_at: string;
  model: string;
  context_sources: string[];
  include_vault: boolean;
  body_md: string;
};
```

- [ ] **Step 2: Commit**

```bash
git add src/research/core/types.ts
git commit -m "feat(research): add core types (RawRecord, Card, SynthesisNote, Draft)"
```

### Task B2: URL canonicalization

**Files:**
- Create: `src/research/core/url.ts`
- Test: `test/research/core/url.test.ts`

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect } from "vitest";
import { canonicalize, sourceIdFor } from "../../../src/research/core/url.js";

describe("canonicalize", () => {
  it("strips fragments", () => {
    expect(canonicalize("https://x.com/a#foo")).toBe("https://x.com/a");
  });
  it("strips utm_ params", () => {
    expect(canonicalize("https://x.com/a?utm_source=foo&id=1")).toBe("https://x.com/a?id=1");
  });
  it("lowercases host", () => {
    expect(canonicalize("https://EXAMPLE.com/A")).toBe("https://example.com/A");
  });
  it("removes trailing slash on path /", () => {
    expect(canonicalize("https://x.com/")).toBe("https://x.com");
  });
});

describe("sourceIdFor", () => {
  it("returns 12-char hex", () => {
    expect(sourceIdFor("https://x.com/a")).toMatch(/^[0-9a-f]{12}$/);
  });
});
```

- [ ] **Step 2: Implement**

```ts
// src/research/core/url.ts
import { createHash } from "crypto";

const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|mc_|_hsenc$|_hsmi$|ref$|ref_)/;

export function canonicalize(url: string): string {
  const u = new URL(url);
  u.hash = "";
  u.hostname = u.hostname.toLowerCase();
  for (const [k] of [...u.searchParams.entries()]) {
    if (TRACKING_PARAMS.test(k)) u.searchParams.delete(k);
  }
  let s = u.toString();
  if (u.pathname === "/" && !u.search) s = s.replace(/\/$/, "");
  return s;
}

export function sourceIdFor(url: string): string {
  return createHash("sha256").update(canonicalize(url)).digest("hex").slice(0, 12);
}
```

- [ ] **Step 3: Run, pass, commit**

```bash
git add src/research/core/url.ts test/research/core/url.test.ts
git commit -m "feat(research): add URL canonicalization and source-id derivation"
```

### Task B3: Dedup helper

**Files:**
- Create: `src/research/core/dedup.ts`
- Test: `test/research/core/dedup.test.ts`

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect } from "vitest";
import { DedupIndex, bodyHash } from "../../../src/research/core/dedup.js";

describe("DedupIndex", () => {
  it("rejects duplicate canonical_url and duplicate body hash", () => {
    const idx = new DedupIndex();
    expect(idx.seen({ canonical_url: "https://x.com/a", body_hash: "h1" })).toBe(false);
    idx.record({ canonical_url: "https://x.com/a", body_hash: "h1" });
    expect(idx.seen({ canonical_url: "https://x.com/a", body_hash: "h2" })).toBe(true);
    expect(idx.seen({ canonical_url: "https://x.com/b", body_hash: "h1" })).toBe(true);
  });
});

describe("bodyHash", () => {
  it("normalizes whitespace before hashing", () => {
    expect(bodyHash("hello   world\n")).toBe(bodyHash("hello world"));
  });
});
```

- [ ] **Step 2: Implement**

```ts
// src/research/core/dedup.ts
import { createHash } from "crypto";

export function bodyHash(body: string): string {
  const normalized = body.replace(/\s+/g, " ").trim();
  return createHash("sha256").update(normalized).digest("hex");
}

export class DedupIndex {
  private urls = new Set<string>();
  private hashes = new Set<string>();
  seen(rec: { canonical_url: string; body_hash?: string }): boolean {
    if (this.urls.has(rec.canonical_url)) return true;
    if (rec.body_hash && this.hashes.has(rec.body_hash)) return true;
    return false;
  }
  record(rec: { canonical_url: string; body_hash?: string }): void {
    this.urls.add(rec.canonical_url);
    if (rec.body_hash) this.hashes.add(rec.body_hash);
  }
  size(): number { return this.urls.size; }
}
```

- [ ] **Step 3: Pass, commit**

```bash
git add src/research/core/dedup.ts test/research/core/dedup.test.ts
git commit -m "feat(research): add dedup index with URL and content-hash keys"
```

### Task B4: Quality filter

**Files:**
- Create: `src/research/core/quality.ts`
- Test: `test/research/core/quality.test.ts`

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect } from "vitest";
import { evaluateQuality } from "../../../src/research/core/quality.js";

const filt = {
  min_words: 50,
  max_words: 1000,
  exclude_domains: ["bad.com"],
  require_lang: null as string | null,
};

describe("evaluateQuality", () => {
  it("rejects too-short body", () => {
    expect(evaluateQuality({ body_md: "short", canonical_url: "https://x.com/a", language: "en" }, filt).accept).toBe(false);
  });
  it("rejects excluded domains", () => {
    const body = "x ".repeat(60);
    expect(evaluateQuality({ body_md: body, canonical_url: "https://bad.com/a", language: "en" }, filt).accept).toBe(false);
  });
  it("rejects when language mismatched and required", () => {
    const body = "x ".repeat(60);
    expect(evaluateQuality({ body_md: body, canonical_url: "https://x.com/a", language: "fr" }, { ...filt, require_lang: "ko" }).accept).toBe(false);
  });
  it("accepts a normal page", () => {
    const body = "x ".repeat(60);
    expect(evaluateQuality({ body_md: body, canonical_url: "https://x.com/a", language: "en" }, filt).accept).toBe(true);
  });
});
```

- [ ] **Step 2: Implement**

```ts
// src/research/core/quality.ts
type FilterCfg = {
  min_words: number;
  max_words: number;
  exclude_domains: string[];
  require_lang: string | null;
};

const PAYWALL_HINTS = /\b(subscribe to read|paywall|sign up to continue|members only)\b/i;

export function evaluateQuality(
  doc: { body_md: string; canonical_url: string; language: string | null },
  cfg: FilterCfg,
): { accept: boolean; reason?: string } {
  const wc = doc.body_md.split(/\s+/).filter(Boolean).length;
  if (wc < cfg.min_words) return { accept: false, reason: `min_words<${cfg.min_words}` };
  if (wc > cfg.max_words) return { accept: false, reason: `max_words>${cfg.max_words}` };
  const host = new URL(doc.canonical_url).hostname;
  if (cfg.exclude_domains.some(d => host === d || host.endsWith("." + d))) {
    return { accept: false, reason: "excluded_domain" };
  }
  if (cfg.require_lang && doc.language && doc.language !== cfg.require_lang) {
    return { accept: false, reason: "lang_mismatch" };
  }
  if (PAYWALL_HINTS.test(doc.body_md.slice(0, 2000))) {
    return { accept: false, reason: "paywall" };
  }
  return { accept: true };
}
```

- [ ] **Step 3: Pass, commit**

```bash
git add src/research/core/quality.ts test/research/core/quality.test.ts
git commit -m "feat(research): add quality filter (length, domain, lang, paywall)"
```

### Task B5: Budget tracker

**Files:**
- Create: `src/research/core/budget.ts`
- Test: `test/research/core/budget.test.ts`

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect } from "vitest";
import { Budget } from "../../../src/research/core/budget.js";

describe("Budget", () => {
  it("tracks URLs and bytes", () => {
    const b = new Budget({ max_new_urls: 2, max_total_bytes: 1000, max_llm_cost_usd: 1.0 });
    expect(b.tryAddUrl()).toBe(true);
    expect(b.tryAddUrl()).toBe(true);
    expect(b.tryAddUrl()).toBe(false);
  });
  it("tracks bytes", () => {
    const b = new Budget({ max_new_urls: 100, max_total_bytes: 1000, max_llm_cost_usd: 1.0 });
    expect(b.tryAddBytes(800)).toBe(true);
    expect(b.tryAddBytes(300)).toBe(false);
  });
  it("buckets cost by model", () => {
    const b = new Budget({ max_new_urls: 100, max_total_bytes: 1, max_llm_cost_usd: 0.10 });
    expect(b.tryAddCost("claude-haiku-4-5", 0.05)).toBe(true);
    expect(b.tryAddCost("claude-sonnet-4-6", 0.04)).toBe(true);
    expect(b.tryAddCost("claude-haiku-4-5", 0.02)).toBe(false);
    const r = b.report();
    expect(r.cost_usd_total).toBeCloseTo(0.09);
    expect(r.cost_usd_by_model["claude-haiku-4-5"]).toBeCloseTo(0.05);
  });
});
```

- [ ] **Step 2: Implement**

```ts
// src/research/core/budget.ts
type BudgetCfg = {
  max_new_urls: number;
  max_total_bytes: number;
  max_llm_cost_usd: number;
};

export class Budget {
  private urls = 0;
  private bytes = 0;
  private cost = 0;
  private byModel: Record<string, number> = {};
  constructor(private cfg: BudgetCfg) {}

  tryAddUrl(): boolean {
    if (this.urls >= this.cfg.max_new_urls) return false;
    this.urls += 1;
    return true;
  }
  tryAddBytes(n: number): boolean {
    if (this.bytes + n > this.cfg.max_total_bytes) return false;
    this.bytes += n;
    return true;
  }
  tryAddCost(model: string, usd: number): boolean {
    if (this.cost + usd > this.cfg.max_llm_cost_usd) return false;
    this.cost += usd;
    this.byModel[model] = (this.byModel[model] ?? 0) + usd;
    return true;
  }
  report() {
    return {
      urls: this.urls,
      bytes: this.bytes,
      cost_usd_total: this.cost,
      cost_usd_by_model: { ...this.byModel },
    };
  }
}
```

- [ ] **Step 3: Pass, commit**

```bash
git add src/research/core/budget.ts test/research/core/budget.test.ts
git commit -m "feat(research): add per-run budget tracker with model-bucketed costs"
```

### Task B6: Rate limiter + robots

**Files:**
- Create: `src/research/core/rate-limit.ts`
- Create: `src/research/core/robots.ts`
- Test: `test/research/core/rate-limit.test.ts`

- [ ] **Step 1: Rate-limit implementation**

```ts
// src/research/core/rate-limit.ts
type Pending = () => void;

export class DomainRateLimiter {
  private last: Map<string, number> = new Map();
  private queues: Map<string, Pending[]> = new Map();
  constructor(private qps: number) {}

  async acquire(host: string): Promise<void> {
    const minGap = 1000 / Math.max(this.qps, 0.001);
    const now = Date.now();
    const last = this.last.get(host) ?? 0;
    const wait = Math.max(0, last + minGap - now);
    if (wait > 0) await new Promise<void>((r) => setTimeout(r, wait));
    this.last.set(host, Date.now());
  }
}
```

- [ ] **Step 2: Robots implementation (minimal)**

```ts
// src/research/core/robots.ts
import { request } from "undici";

const cache = new Map<string, string>();

export async function isAllowed(url: string, userAgent: string): Promise<boolean> {
  const u = new URL(url);
  const robotsUrl = `${u.origin}/robots.txt`;
  let body = cache.get(robotsUrl);
  if (body === undefined) {
    try {
      const res = await request(robotsUrl, { method: "GET" });
      body = await res.body.text();
    } catch {
      body = "";
    }
    cache.set(robotsUrl, body);
  }
  return checkRobots(body, userAgent, u.pathname || "/");
}

function checkRobots(body: string, ua: string, path: string): boolean {
  // Minimal parser: applies the most specific User-agent block (or *) and Allow/Disallow lines.
  const lines = body.split("\n").map(l => l.replace(/#.*$/, "").trim()).filter(Boolean);
  let active: string[] = [];
  let groups: { ua: string; rules: { type: "allow" | "disallow"; pat: string }[] }[] = [];
  let cur: typeof groups[number] | null = null;
  for (const line of lines) {
    const [k0, ...rest] = line.split(":");
    const key = k0.trim().toLowerCase();
    const val = rest.join(":").trim();
    if (key === "user-agent") {
      if (!cur) { cur = { ua: val, rules: [] }; groups.push(cur); }
      else if (cur.rules.length === 0) { cur.ua = val; }
      else { cur = { ua: val, rules: [] }; groups.push(cur); }
    } else if (key === "allow" && cur) cur.rules.push({ type: "allow", pat: val });
    else if (key === "disallow" && cur) cur.rules.push({ type: "disallow", pat: val });
  }
  const candidate = groups.find(g => g.ua.toLowerCase() === ua.toLowerCase()) ?? groups.find(g => g.ua === "*");
  if (!candidate) return true;
  // Longest matching rule wins; allow > disallow on tie.
  let best: { type: "allow" | "disallow"; len: number } | null = null;
  for (const r of candidate.rules) {
    if (r.pat === "" && r.type === "disallow") continue;
    if (path.startsWith(r.pat) && (!best || r.pat.length > best.len || (r.pat.length === best.len && r.type === "allow"))) {
      best = { type: r.type, len: r.pat.length };
    }
  }
  return best?.type !== "disallow";
}
```

- [ ] **Step 3: Tests for rate limiter**

```ts
// test/research/core/rate-limit.test.ts
import { describe, it, expect } from "vitest";
import { DomainRateLimiter } from "../../../src/research/core/rate-limit.js";

describe("DomainRateLimiter", () => {
  it("enforces minimum gap per host", async () => {
    const rl = new DomainRateLimiter(10); // 100ms gap
    const t0 = Date.now();
    await rl.acquire("a.com");
    await rl.acquire("a.com");
    expect(Date.now() - t0).toBeGreaterThanOrEqual(95);
  });
  it("does not couple distinct hosts", async () => {
    const rl = new DomainRateLimiter(10);
    const t0 = Date.now();
    await rl.acquire("a.com");
    await rl.acquire("b.com");
    expect(Date.now() - t0).toBeLessThan(50);
  });
});
```

- [ ] **Step 4: Pass, commit**

```bash
git add src/research/core/rate-limit.ts src/research/core/robots.ts test/research/core/rate-limit.test.ts
git commit -m "feat(research): add per-domain rate limiter and robots.txt parser"
```

### Task B7: Cache + fetcher

**Files:**
- Create: `src/research/core/cache.ts`
- Create: `src/research/core/fetcher.ts`
- Test: `test/research/core/fetcher.test.ts` (uses `msw`)

- [ ] **Step 1: Cache helper**

```ts
// src/research/core/cache.ts
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import { stagingDir } from "../topic/paths.js";

export class FetchCache {
  private dir: string;
  private etagFile: string;
  private etags: Record<string, { etag?: string; lm?: string; blob?: string }>;

  constructor(vault: string, topicId: string) {
    this.dir = join(stagingDir(vault, topicId), "cache");
    mkdirSync(join(this.dir, "blobs"), { recursive: true });
    this.etagFile = join(this.dir, "etag.json");
    this.etags = existsSync(this.etagFile) ? JSON.parse(readFileSync(this.etagFile, "utf-8")) : {};
  }

  getValidators(url: string) {
    const e = this.etags[url];
    return e ? { etag: e.etag, lm: e.lm, blob: e.blob } : {};
  }

  store(url: string, body: Buffer, etag?: string, lm?: string): string {
    const hash = createHash("sha256").update(body).digest("hex");
    const blob = join(this.dir, "blobs", hash);
    if (!existsSync(blob)) writeFileSync(blob, body);
    this.etags[url] = { etag, lm, blob };
    writeFileSync(this.etagFile, JSON.stringify(this.etags, null, 2));
    return blob;
  }

  read(blob: string): Buffer {
    return readFileSync(blob);
  }
}
```

- [ ] **Step 2: Fetcher (uses node fetch built-in)**

```ts
// src/research/core/fetcher.ts
import { DomainRateLimiter } from "./rate-limit.js";
import { isAllowed } from "./robots.js";
import { FetchCache } from "./cache.js";
import { canonicalize } from "./url.js";
import type { FetchedDoc, ContentType } from "./types.js";

export type FetcherCfg = {
  user_agent: string;
  timeout_ms: number;
  max_redirects: number;
  rate_limiter: DomainRateLimiter;
  cache: FetchCache;
};

export async function fetchUrl(url: string, cfg: FetcherCfg): Promise<FetchedDoc> {
  const canonical = canonicalize(url);
  const u = new URL(canonical);

  const allowed = await isAllowed(canonical, cfg.user_agent);
  if (!allowed) throw new FetchError("ROBOTS_DISALLOWED", canonical);

  await cfg.rate_limiter.acquire(u.hostname);

  const validators = cfg.cache.getValidators(canonical);
  const headers: Record<string, string> = {
    "user-agent": cfg.user_agent,
    accept: "text/html,application/pdf,application/xhtml+xml,*/*;q=0.8",
  };
  if (validators.etag) headers["if-none-match"] = validators.etag;
  if (validators.lm)   headers["if-modified-since"] = validators.lm;

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), cfg.timeout_ms);
  let res: Response;
  try {
    res = await fetch(canonical, { headers, redirect: "follow", signal: ac.signal });
  } catch (e: any) {
    throw new FetchError("NETWORK", canonical, e?.message);
  } finally {
    clearTimeout(t);
  }

  if (res.status === 304 && validators.blob) {
    const buf = cfg.cache.read(validators.blob);
    return makeDoc(canonical, 304, buf, res.headers, validators.blob);
  }
  if (!res.ok) throw new FetchError("HTTP_" + res.status, canonical);

  const buf = Buffer.from(await res.arrayBuffer());
  const blob = cfg.cache.store(canonical, buf, res.headers.get("etag") ?? undefined, res.headers.get("last-modified") ?? undefined);
  return makeDoc(canonical, res.status, buf, res.headers, blob);
}

function makeDoc(url: string, status: number, body: Buffer, headers: Headers, blob: string | null): FetchedDoc {
  const ct = (headers.get("content-type") || "").toLowerCase();
  const content_type: ContentType =
    ct.includes("pdf") ? "pdf" : "html";
  return {
    url, canonical_url: url, status,
    fetched_at: new Date().toISOString(),
    content_type,
    body_bytes: body,
    cache_blob: blob,
  };
}

export class FetchError extends Error {
  constructor(public code: string, public url: string, public detail?: string) {
    super(`fetch ${code}: ${url}${detail ? ` — ${detail}` : ""}`);
  }
}
```

- [ ] **Step 3: msw-based fetcher tests**

```ts
// test/research/core/fetcher.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { mkdirSync } from "fs";
import { fetchUrl, FetchError } from "../../../src/research/core/fetcher.js";
import { DomainRateLimiter } from "../../../src/research/core/rate-limit.js";
import { FetchCache } from "../../../src/research/core/cache.js";

const server = setupServer(
  http.get("https://e.com/robots.txt", () => HttpResponse.text("User-agent: *\nAllow: /\n")),
  http.get("https://e.com/a", () => HttpResponse.html("<html><body>hi</body></html>", { headers: { etag: "W/abc" } })),
  http.get("https://forbid.com/robots.txt", () => HttpResponse.text("User-agent: *\nDisallow: /\n")),
  http.get("https://forbid.com/x", () => HttpResponse.text("nope")),
);
beforeAll(() => server.listen());
afterAll(() => server.close());

let vault: string;
beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "v-"));
  mkdirSync(join(vault, "research", "_staging", "t1"), { recursive: true });
});

function makeCfg(vault: string) {
  return {
    user_agent: "test/0.1",
    timeout_ms: 1000,
    max_redirects: 5,
    rate_limiter: new DomainRateLimiter(100),
    cache: new FetchCache(vault, "t1"),
  };
}

describe("fetchUrl", () => {
  it("fetches an allowed URL and caches the body", async () => {
    const doc = await fetchUrl("https://e.com/a", makeCfg(vault));
    expect(doc.status).toBe(200);
    expect(doc.content_type).toBe("html");
    expect(doc.body_bytes.toString()).toContain("hi");
  });
  it("rejects URLs disallowed by robots.txt", async () => {
    await expect(fetchUrl("https://forbid.com/x", makeCfg(vault))).rejects.toThrow(FetchError);
  });
});
```

- [ ] **Step 4: Pass, commit**

```bash
git add src/research/core/cache.ts src/research/core/fetcher.ts test/research/core/fetcher.test.ts
git commit -m "feat(research): add HTTP fetcher with cache and robots/rate-limit gating"
```

### Task B8: Run-log writer

**Files:**
- Create: `src/research/store/log.ts`
- Test: `test/research/store/log.test.ts`

- [ ] **Step 1: Implement append-only JSONL log**

```ts
// src/research/store/log.ts
import { appendFileSync, mkdirSync } from "fs";
import { join } from "path";
import { stagingDir } from "../topic/paths.js";

export type LogEvent =
  | { kind: "fetch_ok"; url: string; bytes: number }
  | { kind: "fetch_skip"; url: string; reason: string }
  | { kind: "fetch_error"; url: string; code: string; detail?: string }
  | { kind: "card_skip"; source_id: string; reason: string }
  | { kind: "card_ok"; source_id: string }
  | { kind: "budget_halt"; reason: string }
  | { kind: "synth_ok"; subtopic: string; cost_usd: number }
  | { kind: "draft_ok"; slug: string; cost_usd: number };

export class RunLog {
  private path: string;
  constructor(vault: string, topicId: string) {
    const dir = stagingDir(vault, topicId);
    mkdirSync(dir, { recursive: true });
    this.path = join(dir, "run-log.jsonl");
  }
  emit(ev: LogEvent) {
    appendFileSync(this.path, JSON.stringify({ ts: new Date().toISOString(), ...ev }) + "\n");
  }
}
```

- [ ] **Step 2: Smoke test**

```ts
// test/research/store/log.test.ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { RunLog } from "../../../src/research/store/log.js";

describe("RunLog", () => {
  it("appends JSONL entries", () => {
    const v = mkdtempSync(join(tmpdir(), "v-"));
    const log = new RunLog(v, "t1");
    log.emit({ kind: "fetch_ok", url: "https://e.com/a", bytes: 10 });
    const txt = readFileSync(join(v, "research", "_staging", "t1", "run-log.jsonl"), "utf-8");
    expect(txt).toContain("fetch_ok");
  });
});
```

- [ ] **Step 3: Pass, commit**

```bash
git add src/research/store/log.ts test/research/store/log.test.ts
git commit -m "feat(research): add append-only run-log writer"
```

---

## Phase C — Vertical slice 1: seed-urls + HTML → raw.jsonl + minimal CLI

By the end of this phase, `bun src/cli/qmd.ts research fetch <topic>` works for a topic that has only `seed-urls`, fetches HTML, runs Readability, dedups, and writes `raw.jsonl`. **No cards yet.**

### Task C1: Source interface + seed-urls

**Files:**
- Create: `src/research/sources/types.ts`
- Create: `src/research/sources/seed-urls.ts`
- Test: `test/research/sources/seed-urls.test.ts`

- [ ] **Step 1: Interface and impl**

```ts
// src/research/sources/types.ts
import type { SourceSpec } from "../topic/schema.js";

export type DiscoveryItem = {
  url: string;
  hint_title?: string;
  source_meta?: Record<string, unknown>;
};

export interface Discovery {
  discover(spec: SourceSpec, ctx: DiscoveryCtx): AsyncIterable<DiscoveryItem>;
}

export type DiscoveryCtx = {
  topic_id: string;
  vault: string;
  // Reserved: search keys, http client, etc.
};
```

```ts
// src/research/sources/seed-urls.ts
import type { Discovery, DiscoveryCtx, DiscoveryItem } from "./types.js";
import type { SourceSpec } from "../topic/schema.js";

export const seedUrls: Discovery = {
  async *discover(spec: SourceSpec, _ctx: DiscoveryCtx): AsyncIterable<DiscoveryItem> {
    if (spec.type !== "seed-urls") return;
    for (const url of spec.urls) {
      yield { url, source_meta: { adapter: "seed-urls" } };
    }
  },
};
```

- [ ] **Step 2: Tests**

```ts
import { describe, it, expect } from "vitest";
import { seedUrls } from "../../../src/research/sources/seed-urls.js";

describe("seedUrls", () => {
  it("yields the input URLs", async () => {
    const out: any[] = [];
    for await (const it of seedUrls.discover(
      { type: "seed-urls", urls: ["https://a.com", "https://b.com"] } as any,
      { topic_id: "t", vault: "/tmp/v" },
    )) out.push(it);
    expect(out).toHaveLength(2);
    expect(out[0].url).toBe("https://a.com");
  });
});
```

- [ ] **Step 3: Pass, commit**

```bash
git add src/research/sources/ test/research/sources/seed-urls.test.ts
git commit -m "feat(research): add Discovery interface and seed-urls source"
```

### Task C2: HTML extractor

**Files:**
- Create: `src/research/extractors/types.ts`
- Create: `src/research/extractors/html.ts`
- Test: `test/research/extractors/html.test.ts`
- Test fixtures: `test/research/fixtures/html/sample-blog.html`, `sample-arxiv-abstract.html`

- [ ] **Step 1: Save 2 fixture HTML files**

Capture two real-world HTML pages locally and place under `test/research/fixtures/html/`. Each must be > 200 words after Readability.

- [ ] **Step 2: Interface + extractor**

```ts
// src/research/extractors/types.ts
import type { FetchedDoc } from "../core/types.js";

export type ExtractedDoc = {
  title: string | null;
  author: string | null;
  published_at: string | null;
  body_md: string;
  language: string | null;
};

export interface Extractor {
  extract(doc: FetchedDoc): Promise<ExtractedDoc>;
}
```

```ts
// src/research/extractors/html.ts
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import type { Extractor, ExtractedDoc } from "./types.js";
import type { FetchedDoc } from "../core/types.js";

const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

export const htmlExtractor: Extractor = {
  async extract(doc: FetchedDoc): Promise<ExtractedDoc> {
    const html = doc.body_bytes.toString("utf-8");
    const dom = new JSDOM(html, { url: doc.canonical_url });
    const article = new Readability(dom.window.document).parse();
    if (!article) return empty();
    const md = td.turndown(article.content || "").trim();
    return {
      title: article.title || null,
      author: article.byline || null,
      published_at: extractPublishedAt(dom.window.document),
      body_md: md,
      language: detectLang(md),
    };
  },
};

function empty(): ExtractedDoc {
  return { title: null, author: null, published_at: null, body_md: "", language: null };
}

function extractPublishedAt(d: Document): string | null {
  const m =
    d.querySelector('meta[property="article:published_time"]')?.getAttribute("content") ??
    d.querySelector('meta[name="date"]')?.getAttribute("content");
  return m || null;
}

function detectLang(text: string): string | null {
  // Lightweight heuristic: % of CJK vs Latin.
  const sample = text.slice(0, 1000);
  const cjk = (sample.match(/[　-鿿가-힯]/g) ?? []).length;
  const latin = (sample.match(/[A-Za-z]/g) ?? []).length;
  if (cjk > latin * 2) return "ko";
  if (latin > 5 && cjk === 0) return "en";
  if (cjk > 0) return "ko";
  return null;
}
```

- [ ] **Step 3: Tests**

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { htmlExtractor } from "../../../src/research/extractors/html.js";

const fix = (n: string) => readFileSync(join(__dirname, "../fixtures/html/", n));

describe("htmlExtractor", () => {
  it("produces non-trivial markdown for a blog post", async () => {
    const out = await htmlExtractor.extract({
      url: "https://example.com/post",
      canonical_url: "https://example.com/post",
      status: 200,
      fetched_at: new Date().toISOString(),
      content_type: "html",
      body_bytes: fix("sample-blog.html"),
      cache_blob: null,
    });
    expect(out.body_md.length).toBeGreaterThan(200);
    expect(out.title).toBeTruthy();
  });
});
```

- [ ] **Step 4: Pass, commit**

```bash
git add src/research/extractors/ test/research/extractors/ test/research/fixtures/html/
git commit -m "feat(research): add HTML extractor with Readability and turndown"
```

### Task C3: Staging writer

**Files:**
- Create: `src/research/store/staging.ts`
- Test: `test/research/store/staging.test.ts`

- [ ] **Step 1: Implement append-only staging**

```ts
// src/research/store/staging.ts
import { appendFileSync, existsSync, readFileSync, mkdirSync } from "fs";
import { join } from "path";
import { stagingDir } from "../topic/paths.js";
import type { RawRecord } from "../core/types.js";
import { DedupIndex } from "../core/dedup.js";

export class StagingStore {
  private path: string;
  private index = new DedupIndex();
  private existing: number;

  constructor(vault: string, topicId: string) {
    const dir = stagingDir(vault, topicId);
    mkdirSync(dir, { recursive: true });
    this.path = join(dir, "raw.jsonl");
    this.existing = 0;
    if (existsSync(this.path)) {
      for (const line of readFileSync(this.path, "utf-8").split("\n")) {
        if (!line) continue;
        try {
          const r: RawRecord = JSON.parse(line);
          this.index.record({ canonical_url: r.canonical_url, body_hash: r.body_hash });
          this.existing += 1;
        } catch { /* skip malformed */ }
      }
    }
  }

  has(rec: { canonical_url: string; body_hash?: string }): boolean {
    return this.index.seen(rec);
  }

  append(rec: RawRecord): void {
    if (this.index.seen({ canonical_url: rec.canonical_url, body_hash: rec.body_hash })) return;
    appendFileSync(this.path, JSON.stringify(rec) + "\n");
    this.index.record({ canonical_url: rec.canonical_url, body_hash: rec.body_hash });
  }

  count(): number { return this.index.size(); }
  preExistingCount(): number { return this.existing; }

  *all(): Iterable<RawRecord> {
    if (!existsSync(this.path)) return;
    for (const line of readFileSync(this.path, "utf-8").split("\n")) {
      if (!line) continue;
      try { yield JSON.parse(line); } catch { /* skip */ }
    }
  }
}
```

- [ ] **Step 2: Test**

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { StagingStore } from "../../../src/research/store/staging.js";

describe("StagingStore", () => {
  it("dedupes on append", () => {
    const v = mkdtempSync(join(tmpdir(), "v-"));
    const s = new StagingStore(v, "t");
    const rec = (id: string, hash: string) => ({
      id, topic_id: "t", source_type: "seed-urls", url: "https://x/" + id,
      canonical_url: "https://x/" + id, title: null, author: null, published_at: null,
      fetched_at: "", content_type: "html", language: "en",
      body_md: "x", word_count: 1, body_hash: hash, source_meta: {}, cache_blob: null,
    } as any);
    s.append(rec("a", "h1"));
    s.append(rec("a", "h1"));
    s.append(rec("b", "h1"));
    expect(s.count()).toBe(1);
  });
});
```

- [ ] **Step 3: Pass, commit**

```bash
git add src/research/store/staging.ts test/research/store/staging.test.ts
git commit -m "feat(research): add staging writer with on-disk dedup recovery"
```

### Task C4: Pipeline `fetch` (no cards)

**Files:**
- Create: `src/research/pipeline/fetch.ts`
- Test: `test/research/pipeline/fetch.test.ts`

- [ ] **Step 1: Implement minimal pipeline**

```ts
// src/research/pipeline/fetch.ts
import { canonicalize, sourceIdFor } from "../core/url.js";
import { bodyHash } from "../core/dedup.js";
import { evaluateQuality } from "../core/quality.js";
import { Budget } from "../core/budget.js";
import { DomainRateLimiter } from "../core/rate-limit.js";
import { FetchCache } from "../core/cache.js";
import { fetchUrl, FetchError } from "../core/fetcher.js";
import { htmlExtractor } from "../extractors/html.js";
import { StagingStore } from "../store/staging.js";
import { RunLog } from "../store/log.js";
import { seedUrls } from "../sources/seed-urls.js";
// Other source adapters (arxiv/rss/web-search/from-document) are imported and
// registered in later phases — do NOT import them here in Phase C.
import type { Discovery } from "../sources/types.js";
import type { TopicSpec, SourceSpec } from "../topic/schema.js";
import type { LlmClient } from "../llm/client.js";

export type FetchOptions = {
  topic: TopicSpec;
  vault: string;
  config: ResearchConfig;
  refresh?: boolean;
  maxNew?: number;
  cardsEnabled?: boolean;
  source?: SourceSpec["type"];
  dryRun?: boolean;
  /** Test seam: inject a custom LLM client for cards. Unset = production Anthropic client. */
  _llmClient?: LlmClient;
};

export type ResearchConfig = {
  fetch: { user_agent: string; rate_limit_per_domain_qps: number; timeout_ms: number; max_redirects: number; };
  budget: { max_new_urls: number; max_total_bytes: number; max_llm_cost_usd: number; };
  search?: { provider: "brave" | "tavily" | "none"; brave?: { api_key?: string }; tavily?: { api_key?: string }; };
  models: { card: string; synth: string; draft: string };
};

export type FetchResult = {
  discovered: number;
  fetched: number;
  skipped: number;
  errored: number;
  records_added: number;
  budget: ReturnType<Budget["report"]>;
};

const REGISTRY: Partial<Record<SourceSpec["type"], Discovery>> = {
  "seed-urls": seedUrls,
  // Filled in Phase E:
  // "arxiv": arxivDiscovery,
  // "rss": rssDiscovery,
  // "web-search": webSearchDiscovery,
  // "from-document": fromDocument,
};

export async function fetchTopic(opts: FetchOptions): Promise<FetchResult> {
  const { topic, vault, config } = opts;
  const budget = new Budget({
    max_new_urls: opts.maxNew ?? topic.budget.max_new_urls,
    max_total_bytes: topic.budget.max_total_bytes,
    max_llm_cost_usd: topic.budget.max_llm_cost_usd,
  });
  const rl = new DomainRateLimiter(config.fetch.rate_limit_per_domain_qps);
  const cache = new FetchCache(vault, topic.id);
  const staging = new StagingStore(vault, topic.id);
  const log = new RunLog(vault, topic.id);
  const fetcherCfg = {
    user_agent: config.fetch.user_agent,
    timeout_ms: config.fetch.timeout_ms,
    max_redirects: config.fetch.max_redirects,
    rate_limiter: rl,
    cache,
  };

  let discovered = 0, fetched = 0, skipped = 0, errored = 0, recordsAdded = 0;

  for (const spec of topic.sources) {
    if (opts.source && spec.type !== opts.source) continue;
    const adapter = REGISTRY[spec.type];
    if (!adapter) { log.emit({ kind: "fetch_skip", url: spec.type, reason: "no_adapter" }); continue; }

    for await (const item of adapter.discover(spec, { topic_id: topic.id, vault })) {
      discovered += 1;
      const cu = canonicalize(item.url);
      if (staging.has({ canonical_url: cu })) { skipped += 1; continue; }
      if (!budget.tryAddUrl()) { log.emit({ kind: "budget_halt", reason: "max_new_urls" }); return summary(); }
      if (opts.dryRun) { fetched += 1; continue; }

      try {
        const doc = await fetchUrl(item.url, fetcherCfg);
        if (!budget.tryAddBytes(doc.body_bytes.byteLength)) {
          log.emit({ kind: "budget_halt", reason: "max_total_bytes" });
          return summary();
        }
        if (doc.content_type !== "html") { skipped += 1; continue; }  // PDF in Phase F
        const ex = await htmlExtractor.extract(doc);
        if (!ex.body_md) { skipped += 1; log.emit({ kind: "fetch_skip", url: cu, reason: "empty_body" }); continue; }
        const q = evaluateQuality({ body_md: ex.body_md, canonical_url: cu, language: ex.language }, topic.filters);
        if (!q.accept) { skipped += 1; log.emit({ kind: "fetch_skip", url: cu, reason: q.reason ?? "quality" }); continue; }
        const hash = bodyHash(ex.body_md);
        if (staging.has({ canonical_url: cu, body_hash: hash })) { skipped += 1; continue; }
        staging.append({
          id: sourceIdFor(cu),
          topic_id: topic.id,
          source_type: spec.type,
          url: item.url,
          canonical_url: cu,
          title: ex.title,
          author: ex.author,
          published_at: ex.published_at,
          fetched_at: doc.fetched_at,
          content_type: doc.content_type,
          language: ex.language,
          body_md: ex.body_md,
          word_count: ex.body_md.split(/\s+/).filter(Boolean).length,
          body_hash: hash,
          source_meta: item.source_meta ?? {},
          cache_blob: doc.cache_blob,
        });
        recordsAdded += 1;
        fetched += 1;
        log.emit({ kind: "fetch_ok", url: cu, bytes: doc.body_bytes.byteLength });
      } catch (e: any) {
        errored += 1;
        const code = e instanceof FetchError ? e.code : "UNKNOWN";
        log.emit({ kind: "fetch_error", url: cu, code, detail: e?.message });
      }
    }
  }

  return summary();

  function summary(): FetchResult {
    return { discovered, fetched, skipped, errored, records_added: recordsAdded, budget: budget.report() };
  }
}
```

In later phases the `REGISTRY` constant grows by adding more source adapters and (for `web-search`) becomes a function `makeRegistry(config)` resolved per call. The Phase C version intentionally only registers `seed-urls`; do not pre-import other source files yet.

- [ ] **Step 2: Pipeline test (msw + temp vault)**

```ts
// test/research/pipeline/fetch.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { mkdtempSync, readFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fetchTopic } from "../../../src/research/pipeline/fetch.js";
import { parseTopic } from "../../../src/research/topic/schema.js";

const HTML = `<html><head><title>T</title></head><body><article><h1>Title</h1>${"<p>" + "lorem ipsum ".repeat(100) + "</p>"}</article></body></html>`;

const server = setupServer(
  http.get("https://e.com/robots.txt", () => HttpResponse.text("User-agent: *\nAllow: /\n")),
  http.get("https://e.com/a", () => HttpResponse.html(HTML)),
);
beforeAll(() => server.listen());
afterAll(() => server.close());

let vault: string;
beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "v-"));
  mkdirSync(join(vault, "research"), { recursive: true });
});

describe("fetchTopic (slice 1)", () => {
  it("fetches a seed URL and writes a RawRecord", async () => {
    const topic = parseTopic({
      id: "t1", title: "t1",
      sources: [{ type: "seed-urls", urls: ["https://e.com/a"] }],
    });
    const cfg = {
      fetch: { user_agent: "test/0.1", rate_limit_per_domain_qps: 100, timeout_ms: 1000, max_redirects: 5 },
      budget: { max_new_urls: 10, max_total_bytes: 10_000_000, max_llm_cost_usd: 0.5 },
      models: { card: "claude-haiku-4-5", synth: "claude-sonnet-4-6", draft: "claude-sonnet-4-6" },
    };
    const r = await fetchTopic({ topic, vault, config: cfg });
    expect(r.records_added).toBe(1);
    const raw = readFileSync(join(vault, "research", "_staging", "t1", "raw.jsonl"), "utf-8");
    expect(raw).toContain('"canonical_url":"https://e.com/a"');
  });
});
```

- [ ] **Step 3: Pass, commit**

```bash
git add src/research/pipeline/fetch.ts test/research/pipeline/fetch.test.ts
git commit -m "feat(research): minimal fetch pipeline (seed-urls + HTML → raw.jsonl)"
```

### Task C5: CLI scaffold — `hwicortex research fetch`

**Files:**
- Create: `src/cli/research.ts`
- Modify: `src/cli/qmd.ts`

- [ ] **Step 1: Add `research` subcommand router in `qmd.ts`**

Locate the place where existing subcommands dispatch (search for `case "search":` or similar). Add:

```ts
// src/cli/qmd.ts (near other case statements)
case "research": {
  const { runResearchCli } = await import("./research.js");
  await runResearchCli(rest);  // rest = process.argv.slice(3)
  return;
}
```

If subcommand wiring is more complex, mimic the existing pattern (e.g., `wiki.ts`).

- [ ] **Step 2: `src/cli/research.ts`**

```ts
// src/cli/research.ts
import { parseArgs } from "util";
import { join } from "path";
import { readFileSync } from "fs";
import { parse as parseYaml } from "yaml";
import { fetchTopic } from "../research/pipeline/fetch.js";
import { loadTopic, adhocTopicFromPrompt } from "../research/topic/loader.js";

export async function runResearchCli(argv: string[]): Promise<void> {
  const [sub, ...rest] = argv;
  switch (sub) {
    case "fetch":      return runFetch(rest);
    // case "synthesize":  return runSynthesize(rest);   // Phase G
    // case "draft":       return runDraft(rest);        // Phase H
    // case "topic":       return runTopic(rest);        // Phase I
    // case "import":      return runImport(rest);       // Phase E
    // case "status":      return runStatus(rest);       // Phase I
    default:
      console.error("usage: hwicortex research <fetch|synthesize|draft|topic|import|status> ...");
      process.exitCode = 1;
  }
}

async function runFetch(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv, allowPositionals: true,
    options: {
      "refresh":   { type: "boolean", default: false },
      "max-new":   { type: "string" },
      "no-cards":  { type: "boolean", default: false },
      "dry-run":   { type: "boolean", default: false },
      "source":    { type: "string" },
      "vault":     { type: "string" },
      "json":      { type: "boolean", default: false },
    },
  });
  const target = positionals[0];
  if (!target) { console.error("usage: hwicortex research fetch <topic-id|prompt>"); process.exitCode = 1; return; }
  const vault = values.vault ?? loadVaultPath();
  const config = loadResearchConfig();

  let topic;
  try {
    topic = await loadTopic(target, vault);
  } catch {
    topic = adhocTopicFromPrompt(target);
  }
  const r = await fetchTopic({
    topic, vault, config,
    refresh: values["refresh"],
    maxNew: values["max-new"] ? Number(values["max-new"]) : undefined,
    cardsEnabled: !values["no-cards"],
    source: values.source as any,
    dryRun: values["dry-run"],
  });
  if (values.json) {
    process.stdout.write(JSON.stringify(r, null, 2) + "\n");
  } else {
    process.stdout.write(
      `Fetched ${r.fetched}/${r.discovered} (skipped ${r.skipped}, errored ${r.errored}); +${r.records_added} records.\n` +
      `Cost: $${r.budget.cost_usd_total.toFixed(4)}\n`
    );
  }
}

function loadVaultPath(): string {
  const cfg = loadConfigFile();
  return expandHome(cfg?.vault?.path ?? "~/hwicortex-vault");
}

function loadResearchConfig() {
  const cfg = loadConfigFile();
  const r = cfg?.research ?? {};
  // Provide defaults matching config/default.yml
  return {
    fetch: {
      user_agent: r.fetch?.user_agent ?? "hwicortex-research/0.1",
      rate_limit_per_domain_qps: r.fetch?.rate_limit_per_domain_qps ?? 1,
      timeout_ms: r.fetch?.timeout_ms ?? 30000,
      max_redirects: r.fetch?.max_redirects ?? 5,
    },
    budget: {
      max_new_urls: r.budget?.max_new_urls ?? 100,
      max_total_bytes: r.budget?.max_total_bytes ?? 50_000_000,
      max_llm_cost_usd: r.budget?.max_llm_cost_usd ?? 0.5,
    },
    search: r.search,
    models: {
      card:  r.models?.card  ?? "claude-haiku-4-5",
      synth: r.models?.synth ?? "claude-sonnet-4-6",
      draft: r.models?.draft ?? "claude-sonnet-4-6",
    },
  };
}

function loadConfigFile(): any {
  const userCfg = expandHome("~/.config/hwicortex/config.yml");
  try { return mergeYaml([readPkgDefault(), readMaybe(userCfg)]); } catch { return {}; }
}

function readPkgDefault(): string {
  return readFileSync(new URL("../../config/default.yml", import.meta.url), "utf-8");
}
function readMaybe(p: string): string | null {
  try { return readFileSync(p, "utf-8"); } catch { return null; }
}
function mergeYaml(layers: (string | null)[]): any {
  let out: any = {};
  for (const layer of layers) {
    if (!layer) continue;
    out = deepMerge(out, parseYaml(interpolateEnv(layer)) ?? {});
  }
  return out;
}
function interpolateEnv(s: string): string {
  return s.replace(/\$\{([A-Z0-9_]+)\}/g, (_, k) => process.env[k] ?? "");
}
function deepMerge(a: any, b: any): any {
  if (typeof a !== "object" || typeof b !== "object" || !a || !b || Array.isArray(a) || Array.isArray(b)) return b ?? a;
  const out: any = { ...a };
  for (const k of Object.keys(b)) out[k] = deepMerge(a[k], b[k]);
  return out;
}
function expandHome(p: string): string {
  return p.startsWith("~") ? p.replace(/^~/, process.env.HOME ?? "~") : p;
}
```

- [ ] **Step 3: Smoke (manual)**

```bash
mkdir -p /tmp/v/research/topics
cat > /tmp/v/research/topics/seed-test.yml <<'YAML'
id: seed-test
title: "Seed test"
sources:
  - type: seed-urls
    urls: ["https://blog.langchain.dev/"]
YAML
bun src/cli/qmd.ts research fetch seed-test --vault /tmp/v --json
```

Expected: prints JSON with `records_added: 1` (or more if redirects were hit). `/tmp/v/research/_staging/seed-test/raw.jsonl` exists.

- [ ] **Step 4: Commit**

```bash
git add src/cli/research.ts src/cli/qmd.ts
git commit -m "feat(research): wire research CLI subcommand and fetch implementation"
```

---

## Phase D — Cards (Haiku)

By the end of this phase, `research fetch` also writes `notes/<id>/sources/<source-id>.md` cards via Haiku, with quote substring validation and idempotence.

### Task D1: Card prompt + parser

**Files:**
- Create: `src/research/llm/card.ts`
- Test: `test/research/llm/card.test.ts`

- [ ] **Step 1: Implement card generation**

```ts
// src/research/llm/card.ts
import { z } from "zod";
import type { LlmClient } from "./client.js";
import type { RawRecord, Card } from "../core/types.js";

const CardOut = z.object({
  tldr: z.array(z.string().min(3)).min(3).max(7),
  excerpts: z.array(z.string().min(8)).max(5),
  tags: z.array(z.string().min(1)).max(8),
});

const SYSTEM = `You are an indexer that produces short, faithful "research cards" from web pages.
Rules:
- Output JSON ONLY, conforming to: {"tldr":[3..7 short bullets],"excerpts":[<=5 verbatim quotes from the body],"tags":[<=8 short tags]}.
- Each excerpt MUST appear verbatim (whitespace-normalized) in the body. If unsure, omit it.
- Cards are not analysis. No editorializing. Faithful to the source.
- Bullets are 1 line each.`;

export async function buildCard(
  client: LlmClient,
  rec: RawRecord,
  model: string,
): Promise<{ card: Card | null; cost_usd: number; reason?: string }> {
  const userPrompt = `URL: ${rec.canonical_url}
TITLE: ${rec.title ?? "(none)"}
LANGUAGE: ${rec.language ?? "?"}

BODY:
${rec.body_md.slice(0, 12000)}`;

  let res;
  try {
    res = await client.call({
      model,
      system: SYSTEM,
      messages: [{ role: "user", content: userPrompt }],
      max_tokens: 800,
      temperature: 0.0,
    });
  } catch (e: any) {
    return { card: null, cost_usd: 0, reason: "llm_error: " + (e?.message ?? "?") };
  }

  let parsed: z.infer<typeof CardOut>;
  try {
    parsed = CardOut.parse(JSON.parse(extractJson(res.text)));
  } catch (e: any) {
    return { card: null, cost_usd: res.cost_usd, reason: "schema_error" };
  }

  const verifiedExcerpts = parsed.excerpts.filter(q => substringMatchesNormalized(q, rec.body_md));

  return {
    card: {
      source_id: rec.id,
      topic_id: rec.topic_id,
      url: rec.canonical_url,
      title: rec.title ?? "(untitled)",
      author: rec.author,
      published: rec.published_at,
      fetched: rec.fetched_at,
      language: rec.language,
      tags: parsed.tags.slice(0, 8),
      body_hash: rec.body_hash,
      tldr: parsed.tldr,
      excerpts: verifiedExcerpts,
    },
    cost_usd: res.cost_usd,
  };
}

function extractJson(s: string): string {
  const m = s.match(/\{[\s\S]*\}/);
  return m ? m[0] : s;
}

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim().normalize("NFC");
}

export function substringMatchesNormalized(q: string, body: string): boolean {
  return normalize(body).includes(normalize(q));
}
```

- [ ] **Step 2: Tests**

```ts
// test/research/llm/card.test.ts
import { describe, it, expect } from "vitest";
import { buildCard, substringMatchesNormalized } from "../../../src/research/llm/card.js";
import { mockLlm } from "../_helpers/anthropic-mock.js";

const rec = {
  id: "abc", topic_id: "t", source_type: "seed-urls", url: "https://x.com/a",
  canonical_url: "https://x.com/a", title: "Hello", author: null, published_at: null,
  fetched_at: "2026-04-30", content_type: "html" as const, language: "en",
  body_md: "Hello world.  This is a body. RAG is great.",
  word_count: 8, body_hash: "h", source_meta: {}, cache_blob: null,
};

describe("buildCard", () => {
  it("validates and keeps only verbatim excerpts", async () => {
    const llm = mockLlm([JSON.stringify({
      tldr: ["a", "b", "c"],
      excerpts: ["This is a body.", "this never appeared"],
      tags: ["rag"],
    })]);
    const r = await buildCard(llm, rec as any, "claude-haiku-4-5");
    expect(r.card?.excerpts).toEqual(["This is a body."]);
  });

  it("returns null on malformed JSON", async () => {
    const llm = mockLlm(["not json"]);
    const r = await buildCard(llm, rec as any, "claude-haiku-4-5");
    expect(r.card).toBeNull();
    expect(r.reason).toBe("schema_error");
  });
});

describe("substringMatchesNormalized", () => {
  it("ignores whitespace differences", () => {
    expect(substringMatchesNormalized("hello world", "hello   world\n")).toBe(true);
  });
});
```

- [ ] **Step 3: Pass, commit**

```bash
git add src/research/llm/card.ts test/research/llm/card.test.ts
git commit -m "feat(research): generate cards via Haiku with quote-substring guard"
```

### Task D2: Cards writer (markdown)

**Files:**
- Create: `src/research/store/cards.ts`
- Test: `test/research/store/cards.test.ts`

- [ ] **Step 1: Writer**

```ts
// src/research/store/cards.ts
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { sourcesDir } from "../topic/paths.js";
import type { Card } from "../core/types.js";
import { stringify as yamlStringify, parse as yamlParse } from "yaml";

export function cardPath(vault: string, topicId: string, sourceId: string): string {
  return join(sourcesDir(vault, topicId), `${sourceId}.md`);
}

export function readCardFrontmatter(path: string): { body_hash?: string } | null {
  if (!existsSync(path)) return null;
  const txt = readFileSync(path, "utf-8");
  const m = txt.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  try { return yamlParse(m[1]); } catch { return null; }
}

export function writeCard(vault: string, c: Card): void {
  const dir = sourcesDir(vault, c.topic_id);
  mkdirSync(dir, { recursive: true });
  const fm = {
    type: "research-card",
    topic: c.topic_id,
    source_id: c.source_id,
    url: c.url,
    title: c.title,
    author: c.author,
    published: c.published,
    fetched: c.fetched,
    language: c.language,
    tags: c.tags,
    body_hash: c.body_hash,
    hwicortex_index: true,
  };
  const md = `---
${yamlStringify(fm).trimEnd()}
---

# ${c.title}

## TL;DR

${c.tldr.map(b => "- " + b).join("\n")}

## 핵심 발췌

${c.excerpts.length === 0 ? "_(none)_" : c.excerpts.map(q => "> " + q.replace(/\n/g, " ")).join("\n\n")}

## 메모

${"<!-- analysis lives in synthesis notes -->"}

[원문 링크](${c.url})
`;
  writeFileSync(cardPath(vault, c.topic_id, c.source_id), md);
}
```

- [ ] **Step 2: Test**

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { writeCard, cardPath, readCardFrontmatter } from "../../../src/research/store/cards.js";

describe("writeCard", () => {
  it("writes markdown with body_hash in frontmatter", () => {
    const v = mkdtempSync(join(tmpdir(), "v-"));
    writeCard(v, {
      source_id: "abc", topic_id: "t", url: "https://x/a", title: "T",
      author: null, published: null, fetched: "2026-04-30",
      language: "en", tags: ["r"], body_hash: "H",
      tldr: ["one", "two", "three"], excerpts: ["q1"],
    });
    const txt = readFileSync(cardPath(v, "t", "abc"), "utf-8");
    expect(txt).toContain("body_hash: H");
    expect(readCardFrontmatter(cardPath(v, "t", "abc"))?.body_hash).toBe("H");
  });
});
```

- [ ] **Step 3: Pass, commit**

```bash
git add src/research/store/cards.ts test/research/store/cards.test.ts
git commit -m "feat(research): persist cards as vault-indexed markdown with body_hash"
```

### Task D3: Wire cards into pipeline + idempotence

**Files:**
- Modify: `src/research/pipeline/fetch.ts`
- Test: `test/research/pipeline/fetch.test.ts` (extend)

- [ ] **Step 1: Add card generation to pipeline**

In `fetch.ts`:
- After `staging.append(...)`, when `cardsEnabled !== false` and `topic.cards.enabled`, call `buildCard` with the LLM client.
- Skip generation if a card already exists at `cardPath(vault, topic_id, source_id)` AND its frontmatter `body_hash` matches the new record's `body_hash`.
- Track cost via `budget.tryAddCost(model, cost_usd)`. If budget says no, halt with `budget_halt: max_llm_cost_usd`.

Sketch addition:

```ts
import { createAnthropicClient } from "../llm/client.js";
import { buildCard } from "../llm/card.js";
import { writeCard, cardPath, readCardFrontmatter } from "../store/cards.js";

// inside fetchTopic after staging.append(rec):
const cardsOn = (opts.cardsEnabled ?? true) && topic.cards.enabled;
if (cardsOn) {
  const existing = readCardFrontmatter(cardPath(vault, topic.id, rec.id));
  if (existing?.body_hash !== rec.body_hash) {
    const llm = opts._llmClient ?? createAnthropicClient();
    const out = await buildCard(llm, rec, topic.cards.model);
    if (out.cost_usd > 0 && !budget.tryAddCost(topic.cards.model, out.cost_usd)) {
      log.emit({ kind: "budget_halt", reason: "max_llm_cost_usd" });
      return summary();
    }
    if (out.card) {
      writeCard(vault, out.card);
      log.emit({ kind: "card_ok", source_id: rec.id });
    } else {
      log.emit({ kind: "card_skip", source_id: rec.id, reason: out.reason ?? "unknown" });
    }
  }
}
```

Note `_llmClient` injection — `FetchOptions` gets an optional `_llmClient?: LlmClient` for tests.

- [ ] **Step 2: Update test to inject mock LLM**

```ts
// test/research/pipeline/fetch.test.ts (additional case)
import { mockLlm } from "../_helpers/anthropic-mock.js";

it("writes a card via mock LLM and is idempotent on rerun", async () => {
  const topic = parseTopic({
    id: "t-card", title: "x",
    sources: [{ type: "seed-urls", urls: ["https://e.com/a"] }],
    cards: { enabled: true, model: "claude-haiku-4-5" },
  });
  const llm = mockLlm([JSON.stringify({ tldr: ["a","b","c"], excerpts: [], tags: ["rag"] })]);
  const cfg = /* ...same as earlier... */;
  const r1 = await fetchTopic({ topic, vault, config: cfg, _llmClient: llm });
  expect(r1.records_added).toBe(1);
  // 2nd run should not call the LLM (no fail because mock just no-ops)
  const r2 = await fetchTopic({ topic, vault, config: cfg, _llmClient: llm });
  expect(r2.records_added).toBe(0);
});
```

- [ ] **Step 3: Pass, commit**

```bash
git add src/research/pipeline/fetch.ts test/research/pipeline/fetch.test.ts
git commit -m "feat(research): generate cards in fetch pipeline with body_hash idempotence"
```

---

## Phase E — More sources & extractors

### Task E1: arxiv source

**Files:**
- Create: `src/research/sources/arxiv.ts`
- Test: `test/research/sources/arxiv.test.ts`
- Fixture: `test/research/fixtures/arxiv/cs-cl.xml` (real arXiv API response, saved)

- [ ] **Step 1: Save 1 fixture from `https://export.arxiv.org/api/query?search_query=...`**

- [ ] **Step 2: Implement adapter**

```ts
// src/research/sources/arxiv.ts
import { request } from "undici";
import type { Discovery, DiscoveryItem } from "./types.js";
import type { SourceSpec } from "../topic/schema.js";

const API = "https://export.arxiv.org/api/query";

export const arxivDiscovery: Discovery = {
  async *discover(spec: SourceSpec): AsyncIterable<DiscoveryItem> {
    if (spec.type !== "arxiv") return;
    for (const q of spec.queries) {
      const cats = spec.categories.length ? ` AND (${spec.categories.map(c => "cat:" + c).join(" OR ")})` : "";
      const search = encodeURIComponent(`all:"${q}"${cats}`);
      const url = `${API}?search_query=${search}&start=0&max_results=${spec.top_k}`;
      const xml = await (await request(url)).body.text();
      for (const item of parseAtom(xml)) yield item;
    }
  },
};

function parseAtom(xml: string): DiscoveryItem[] {
  const out: DiscoveryItem[] = [];
  const entries = xml.split("<entry>").slice(1);
  for (const e of entries) {
    const link = match(e, /<id>([^<]+)<\/id>/);
    const title = match(e, /<title>([^<]+)<\/title>/)?.replace(/\s+/g, " ").trim();
    const pdf = link?.replace("/abs/", "/pdf/") + ".pdf";
    if (link) out.push({
      url: link,
      hint_title: title,
      source_meta: { adapter: "arxiv", arxiv_id: link.split("/").pop(), pdf_url: pdf },
    });
  }
  return out;
}
function match(s: string, re: RegExp): string | null {
  const m = s.match(re); return m ? m[1] : null;
}
```

- [ ] **Step 3: Test with msw**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { readFileSync } from "fs";
import { join } from "path";
import { arxivDiscovery } from "../../../src/research/sources/arxiv.js";

const xml = readFileSync(join(__dirname, "../fixtures/arxiv/cs-cl.xml"), "utf-8");
const server = setupServer(http.get("https://export.arxiv.org/api/query", () => HttpResponse.text(xml)));
beforeAll(() => server.listen());
afterAll(() => server.close());

describe("arxivDiscovery", () => {
  it("yields entries from atom XML", async () => {
    const items: any[] = [];
    for await (const it of arxivDiscovery.discover(
      { type: "arxiv", queries: ["RAG"], categories: ["cs.CL"], top_k: 5 } as any,
      { topic_id: "t", vault: "/tmp" },
    )) items.push(it);
    expect(items.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 4: Register in pipeline + commit**

In `pipeline/fetch.ts` `REGISTRY`, add `"arxiv": arxivDiscovery`.

```bash
git add src/research/sources/arxiv.ts test/research/sources/arxiv.test.ts test/research/fixtures/arxiv/ src/research/pipeline/fetch.ts
git commit -m "feat(research): add arxiv discovery adapter"
```

### Task E2: rss source + feed extractor

**Files:**
- Create: `src/research/sources/rss.ts`
- Create: `src/research/extractors/feed.ts`
- Tests + fixtures

- [ ] **Step 1: Adapter using `rss-parser`**

```ts
// src/research/sources/rss.ts
import Parser from "rss-parser";
import type { Discovery, DiscoveryItem } from "./types.js";
import type { SourceSpec } from "../topic/schema.js";

const parser = new Parser();

export const rssDiscovery: Discovery = {
  async *discover(spec: SourceSpec): AsyncIterable<DiscoveryItem> {
    if (spec.type !== "rss") return;
    for (const feed of spec.feeds) {
      const f = await parser.parseURL(feed);
      for (const item of f.items) {
        if (!item.link) continue;
        yield {
          url: item.link,
          hint_title: item.title,
          source_meta: { adapter: "rss", feed, pubDate: item.isoDate, content_snippet: item.contentSnippet },
        };
      }
    }
  },
};
```

- [ ] **Step 2: Feed extractor (when feed contains full body, use it; else fall back to HTML extractor)**

```ts
// src/research/extractors/feed.ts
import type { Extractor, ExtractedDoc } from "./types.js";
import type { FetchedDoc } from "../core/types.js";
// Most RSS items don't carry full body; we delegate to HTML extractor by default.
// This file exists for symmetry; pipeline picks HTML extractor for content_type "html".
export const feedExtractor: Extractor = {
  async extract(doc: FetchedDoc): Promise<ExtractedDoc> {
    return { title: null, author: null, published_at: null, body_md: doc.body_bytes.toString("utf-8"), language: null };
  },
};
```

- [ ] **Step 3: Tests + register + commit**

Tests use msw to mock `parseURL` is awkward — instead, write `rss-parser`-compatible XML and call `parser.parseString` in the test. Skip end-to-end here; cover at the pipeline level.

```bash
git add src/research/sources/rss.ts src/research/extractors/feed.ts src/research/pipeline/fetch.ts
git commit -m "feat(research): add RSS discovery adapter"
```

### Task E3: web-search adapter (Brave, with Tavily fallback)

**Files:**
- Create: `src/research/sources/web-search.ts`
- Test: `test/research/sources/web-search.test.ts`
- Fixture: `test/research/fixtures/brave/q-rag-eval.json`

- [ ] **Step 1: Save a fixture from `https://api.search.brave.com/res/v1/web/search?q=...`**

- [ ] **Step 2: Adapter**

```ts
// src/research/sources/web-search.ts
import { request } from "undici";
import type { Discovery, DiscoveryItem, DiscoveryCtx } from "./types.js";
import type { SourceSpec } from "../topic/schema.js";

export interface SearchProvider {
  search(query: string, opts: { topK: number; siteFilters: string[]; since?: string }): Promise<DiscoveryItem[]>;
}

export class BraveProvider implements SearchProvider {
  constructor(private apiKey: string) {}
  async search(query: string, opts: { topK: number; siteFilters: string[]; since?: string }) {
    const q = opts.siteFilters.length
      ? `${query} ` + opts.siteFilters.map(s => `site:${s}`).join(" OR ")
      : query;
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=${opts.topK}`;
    const r = await request(url, { headers: { "X-Subscription-Token": this.apiKey, accept: "application/json" } });
    const j: any = await r.body.json();
    return (j.web?.results ?? []).map((it: any) => ({
      url: it.url,
      hint_title: it.title,
      source_meta: { adapter: "web-search", provider: "brave", query },
    }));
  }
}

export class TavilyProvider implements SearchProvider {
  constructor(private apiKey: string) {}
  async search(query: string, opts: { topK: number; siteFilters: string[]; since?: string }) {
    const r = await request("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ api_key: this.apiKey, query, max_results: opts.topK, include_domains: opts.siteFilters }),
    });
    const j: any = await r.body.json();
    return (j.results ?? []).map((it: any) => ({
      url: it.url,
      hint_title: it.title,
      source_meta: { adapter: "web-search", provider: "tavily", query },
    }));
  }
}

export function makeWebSearchDiscovery(provider: SearchProvider): Discovery {
  return {
    async *discover(spec: SourceSpec, _ctx: DiscoveryCtx): AsyncIterable<DiscoveryItem> {
      if (spec.type !== "web-search") return;
      for (const q of spec.queries) {
        const items = await provider.search(q, {
          topK: spec.top_k_per_query,
          siteFilters: spec.site_filters,
          since: spec.since,
        });
        for (const it of items) yield it;
      }
    },
  };
}
```

- [ ] **Step 3: Tests with msw + register provider in pipeline based on config**

In `pipeline/fetch.ts`, replace the static REGISTRY entry for `"web-search"` with one resolved per-call from config:

```ts
function makeRegistry(config: ResearchConfig): Partial<Record<SourceSpec["type"], Discovery>> {
  const reg: any = { "seed-urls": seedUrls, "arxiv": arxivDiscovery, "rss": rssDiscovery };
  if (config.search?.provider === "brave" && config.search.brave?.api_key) {
    reg["web-search"] = makeWebSearchDiscovery(new BraveProvider(config.search.brave.api_key));
  } else if (config.search?.provider === "tavily" && config.search.tavily?.api_key) {
    reg["web-search"] = makeWebSearchDiscovery(new TavilyProvider(config.search.tavily.api_key));
  }
  return reg;
}
```

Use `makeRegistry(config)` in place of the static `REGISTRY` constant.

- [ ] **Step 4: Pass, commit**

```bash
git add src/research/sources/web-search.ts test/research/sources/web-search.test.ts test/research/fixtures/brave/ src/research/pipeline/fetch.ts
git commit -m "feat(research): add web-search adapter with Brave and Tavily providers"
```

### Task E4: from-document — seeds-only

**Files:**
- Create: `src/research/sources/from-document.ts`
- Test: `test/research/sources/from-document.test.ts`

- [ ] **Step 1: Implementation (seeds-only)**

```ts
// src/research/sources/from-document.ts
import { readFileSync } from "fs";
import { resolve, isAbsolute } from "path";
import { join } from "path";
import type { Discovery, DiscoveryItem, DiscoveryCtx } from "./types.js";
import type { SourceSpec } from "../topic/schema.js";

const URL_RE = /https?:\/\/[^\s)>"'`]+/g;
const FENCE_RE = /```[\s\S]*?```/g;

export const fromDocument: Discovery = {
  async *discover(spec: SourceSpec, ctx: DiscoveryCtx): AsyncIterable<DiscoveryItem> {
    if (spec.type !== "from-document") return;
    const path = isAbsolute(spec.path) ? spec.path : join(ctx.vault, spec.path);
    const txt = readFileSync(path, "utf-8");
    if (spec.mode === "seeds-only") {
      const cleaned = txt.replace(FENCE_RE, "");
      const seen = new Set<string>();
      for (const m of cleaned.matchAll(URL_RE)) {
        const url = m[0].replace(/[.,;:)\]"'`]+$/, ""); // strip trailing punct
        if (!seen.has(url)) {
          seen.add(url);
          yield { url, source_meta: { adapter: "from-document", document: spec.path } };
        }
      }
    } else {
      // use-as-cards handled separately (Task E5)
      return;
    }
  },
};
```

- [ ] **Step 2: Tests**

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fromDocument } from "../../../src/research/sources/from-document.js";

describe("fromDocument seeds-only", () => {
  it("extracts URLs and ignores fenced code blocks", async () => {
    const v = mkdtempSync(join(tmpdir(), "v-"));
    const doc = join(v, "b.md");
    writeFileSync(doc, "Read [A](https://a.com/x) and https://b.com/y\n```\nhttps://ignored.com\n```");
    const out: any[] = [];
    for await (const it of fromDocument.discover(
      { type: "from-document", path: doc, mode: "seeds-only", refetch: false } as any,
      { topic_id: "t", vault: v },
    )) out.push(it);
    const urls = out.map(o => o.url).sort();
    expect(urls).toEqual(["https://a.com/x", "https://b.com/y"]);
  });
});
```

- [ ] **Step 3: Register in `makeRegistry` and commit**

```bash
git add src/research/sources/from-document.ts test/research/sources/from-document.test.ts src/research/pipeline/fetch.ts
git commit -m "feat(research): add from-document source (seeds-only mode)"
```

### Task E5: from-document — use-as-cards mode

**Files:**
- Create: `src/research/llm/from-document-extract.ts`
- Modify: `src/research/pipeline/fetch.ts` to special-case `from-document + use-as-cards`
- Test: `test/research/llm/from-document-extract.test.ts`

- [ ] **Step 1: LLM-driven extractor**

```ts
// src/research/llm/from-document-extract.ts
import { z } from "zod";
import type { LlmClient } from "./client.js";
// (note: substring validation lives in card.ts and is reused by the pipeline)

const Schema = z.array(z.object({
  url: z.string().url(),
  title: z.string().nullable().optional(),
  summary: z.string().min(1),
  excerpts: z.array(z.string()).default([]),
}));

const SYSTEM = `You extract { url, title?, summary, excerpts? } tuples from a user's research document.
Return JSON ONLY: an array of objects. Skip items without a URL. Do NOT invent information.`;

export async function extractCardsFromDocument(
  client: LlmClient,
  documentText: string,
  model: string,
): Promise<{ items: z.infer<typeof Schema>; cost_usd: number; reason?: string }> {
  const r = await client.call({
    model, system: SYSTEM, max_tokens: 2000, temperature: 0.0,
    messages: [{ role: "user", content: documentText.slice(0, 30000) }],
  });
  try {
    const m = r.text.match(/\[[\s\S]*\]/);
    return { items: Schema.parse(JSON.parse(m ? m[0] : r.text)), cost_usd: r.cost_usd };
  } catch {
    return { items: [], cost_usd: r.cost_usd, reason: "schema_error" };
  }
}
```

- [ ] **Step 2: Wire into pipeline**

In `pipeline/fetch.ts`, when `spec.type === "from-document" && spec.mode === "use-as-cards"`:
- Skip normal Discovery+Fetch loop.
- Call `extractCardsFromDocument(client, readFileSync(path, "utf-8"), topic.cards.model)`.
- For each item, synthesize a synthetic `RawRecord`-like and a `Card`. Validate excerpts (substring against the document text). Write the card via `writeCard`.
- Append a synthetic `RawRecord` to staging if `spec.refetch === false`, with `body_md = item.summary`. Otherwise, also enqueue the URL through normal fetch.

Add these imports at the top of `pipeline/fetch.ts` (alongside existing imports added in Phase D):

```ts
import { readFileSync } from "fs";
import { isAbsolute, join as joinPath } from "path";
import { extractCardsFromDocument } from "../llm/from-document-extract.js";
import { substringMatchesNormalized } from "../llm/card.js";
import type { RawRecord } from "../core/types.js";
```

Implementation sketch (apply within the source loop, before the standard discovery iteration):

```ts
if (spec.type === "from-document" && spec.mode === "use-as-cards") {
  const docPath = isAbsolute(spec.path) ? spec.path : joinPath(vault, spec.path);
  const docText = readFileSync(docPath, "utf-8");
  const llm = opts._llmClient ?? createAnthropicClient();
  const out = await extractCardsFromDocument(llm, docText, topic.cards.model);
  if (!budget.tryAddCost(topic.cards.model, out.cost_usd)) {
    log.emit({ kind: "budget_halt", reason: "max_llm_cost_usd" });
    return summary();
  }
  for (const item of out.items) {
    const cu = canonicalize(item.url);
    if (staging.has({ canonical_url: cu })) continue;
    if (!budget.tryAddUrl()) { log.emit({ kind: "budget_halt", reason: "max_new_urls" }); return summary(); }
    const sid = sourceIdFor(cu);
    const synth: RawRecord = {
      id: sid, topic_id: topic.id, source_type: "from-document",
      url: item.url, canonical_url: cu, title: item.title ?? null,
      author: null, published_at: null, fetched_at: new Date().toISOString(),
      content_type: "html", language: null, body_md: item.summary,
      word_count: item.summary.split(/\s+/).filter(Boolean).length,
      body_hash: bodyHash(item.summary),
      source_meta: { adapter: "from-document", document: spec.path, mode: "use-as-cards" },
      cache_blob: null,
    };
    staging.append(synth);
    const verifiedExcerpts = (item.excerpts ?? []).filter(q => substringMatchesNormalized(q, docText));
    writeCard(vault, {
      source_id: sid, topic_id: topic.id, url: cu,
      title: item.title ?? "(untitled)", author: null, published: null,
      fetched: synth.fetched_at, language: null, tags: [],
      body_hash: synth.body_hash,
      tldr: [item.summary.slice(0, 200)],
      excerpts: verifiedExcerpts,
    });
    log.emit({ kind: "card_ok", source_id: sid });
  }
  continue; // skip standard adapter loop for this source
}
```

- [ ] **Step 3: Tests, pass, commit**

```bash
git add src/research/llm/from-document-extract.ts src/research/pipeline/fetch.ts test/research/llm/from-document-extract.test.ts
git commit -m "feat(research): support from-document use-as-cards mode via Haiku extraction"
```

### Task E6: PDF extractor (reuse pdf-parser)

**Files:**
- Create: `src/research/extractors/pdf.ts`
- Modify: `src/research/pipeline/fetch.ts` (route by content_type)

- [ ] **Step 1: Implementation**

```ts
// src/research/extractors/pdf.ts
import type { Extractor, ExtractedDoc } from "./types.js";
import type { FetchedDoc } from "../core/types.js";
import { parsePdfBuffer } from "../../ingest/pdf-parser.js";  // adjust if export name differs

export const pdfExtractor: Extractor = {
  async extract(doc: FetchedDoc): Promise<ExtractedDoc> {
    const text = await parsePdfBuffer(doc.body_bytes);
    return { title: null, author: null, published_at: null, body_md: text.trim(), language: null };
  },
};
```

If `parsePdfBuffer` isn't exported, add the smallest possible export from the existing parser module rather than reimplementing.

- [ ] **Step 2: Pipeline route**

In `pipeline/fetch.ts`, replace the `if (doc.content_type !== "html") { skipped += 1; continue; }` block with:

```ts
const ex = doc.content_type === "pdf"
  ? await pdfExtractor.extract(doc)
  : await htmlExtractor.extract(doc);
```

- [ ] **Step 3: Test fixture + pass, commit**

```bash
git add src/research/extractors/pdf.ts src/research/pipeline/fetch.ts test/research/extractors/pdf.test.ts test/research/fixtures/pdf/
git commit -m "feat(research): support PDF extraction via reused pdf-parser"
```

---

## Phase F — Synthesize

### Task F1: Synthesis prompt + cluster auto-naming

**Files:**
- Create: `src/research/llm/synthesize.ts`
- Test: `test/research/llm/synthesize.test.ts`

- [ ] **Step 1: Implement**

```ts
// src/research/llm/synthesize.ts
import { z } from "zod";
import type { LlmClient } from "./client.js";
import type { Card } from "../core/types.js";

const ClusterPlan = z.object({
  clusters: z.array(z.object({
    subtopic: z.string().regex(/^[a-z0-9-]+$/),
    title: z.string(),
    source_ids: z.array(z.string().min(1)).min(1),
  })).min(1),
});

const PLAN_SYSTEM = `Group source cards into 3-7 coherent subtopics. For each subtopic:
- give a short slug (lowercase-hyphen)
- a short title
- the list of source_ids that belong.
Return JSON ONLY: {"clusters":[{"subtopic":"...","title":"...","source_ids":["..."]}]}`;

const SYNTH_SYSTEM = `Write a synthesis note in Markdown for one subtopic of a research topic.
Inputs: subtopic title and a list of cards (source_id, title, tldr, excerpts).
Rules:
- Use Markdown footnotes ([^source_id]) to cite. Define them at the bottom.
- Do not invent claims that are not in the cards.
- Section headings as appropriate. Mix Korean/English faithfully.
- Output ONLY the markdown body. No frontmatter.`;

export async function planClusters(client: LlmClient, cards: Card[], model: string) {
  const cardSummaries = cards.map(c => ({ source_id: c.source_id, title: c.title, tags: c.tags, tldr: c.tldr }));
  const r = await client.call({
    model, system: PLAN_SYSTEM, max_tokens: 1500, temperature: 0.2,
    messages: [{ role: "user", content: JSON.stringify(cardSummaries).slice(0, 30000) }],
  });
  const m = r.text.match(/\{[\s\S]*\}/);
  return { plan: ClusterPlan.parse(JSON.parse(m ? m[0] : r.text)), cost_usd: r.cost_usd };
}

export async function writeSubtopicNote(
  client: LlmClient,
  subtopicTitle: string,
  cards: Card[],
  model: string,
) {
  const lite = cards.map(c => ({
    source_id: c.source_id, title: c.title, tldr: c.tldr, excerpts: c.excerpts,
  }));
  const r = await client.call({
    model, system: SYNTH_SYSTEM, max_tokens: 4000, temperature: 0.4,
    messages: [{ role: "user", content: `Subtopic title: ${subtopicTitle}\nCards:\n${JSON.stringify(lite).slice(0, 60000)}` }],
  });
  const cited = Array.from(new Set(Array.from(r.text.matchAll(/\[\^([0-9a-f]{12})\]/g)).map(m => m[1])));
  return { body_md: r.text.trim(), cited, cost_usd: r.cost_usd, model };
}
```

- [ ] **Step 2: Tests with mock LLM**

(Cover schema validation, footnote extraction.)

- [ ] **Step 3: Commit**

```bash
git add src/research/llm/synthesize.ts test/research/llm/synthesize.test.ts
git commit -m "feat(research): add synthesis prompts (cluster plan + subtopic write)"
```

### Task F2: Synthesis writer + pipeline

**Files:**
- Create: `src/research/store/synthesis.ts`
- Create: `src/research/pipeline/synthesize.ts`
- Modify: `src/cli/research.ts` (add `synthesize` command)
- Tests

- [ ] **Step 1: Synthesis writer**

```ts
// src/research/store/synthesis.ts
import { mkdirSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { stringify as yamlStringify } from "yaml";
import { notesDir } from "../topic/paths.js";
import type { SynthesisNote } from "../core/types.js";

export function synthesisPath(vault: string, topicId: string, subtopic: string): string {
  return join(notesDir(vault, topicId), `${subtopic}.md`);
}

export function writeSynthesis(vault: string, n: SynthesisNote): void {
  const dir = notesDir(vault, n.topic_id);
  mkdirSync(dir, { recursive: true });
  const fm = {
    type: "research-synthesis",
    topic: n.topic_id,
    subtopic: n.subtopic,
    generated_at: n.generated_at,
    model: n.model,
    source_cards: n.source_cards,
    hwicortex_index: true,
  };
  const md = `---\n${yamlStringify(fm).trimEnd()}\n---\n\n${n.body_md}\n`;
  writeFileSync(synthesisPath(vault, n.topic_id, n.subtopic), md);
}
```

- [ ] **Step 2: Pipeline**

```ts
// src/research/pipeline/synthesize.ts
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { sourcesDir, notesDir } from "../topic/paths.js";
import { parse as yamlParse } from "yaml";
import { Budget } from "../core/budget.js";
import { RunLog } from "../store/log.js";
import { writeSynthesis, synthesisPath } from "../store/synthesis.js";
import { planClusters, writeSubtopicNote } from "../llm/synthesize.js";
import { createAnthropicClient } from "../llm/client.js";
import type { Card } from "../core/types.js";
import type { TopicSpec } from "../topic/schema.js";
import type { LlmClient } from "../llm/client.js";

export type SynthOptions = {
  topic: TopicSpec;
  vault: string;
  config: { models: { synth: string } };
  subtopic?: string;
  refresh?: boolean;
  _llmClient?: LlmClient;
};
export type SynthResult = { notes_written: string[]; cost_usd: number };

export async function synthesize(opts: SynthOptions): Promise<SynthResult> {
  const { topic, vault } = opts;
  const cards = loadCards(vault, topic.id);
  if (cards.length === 0) return { notes_written: [], cost_usd: 0 };

  const llm = opts._llmClient ?? createAnthropicClient();
  const log = new RunLog(vault, topic.id);
  const budget = new Budget(topic.budget);
  const written: string[] = [];
  const model = opts.config.models.synth;

  const targets: Array<{ subtopic: string; title: string; cards: Card[] }> = [];
  if (opts.subtopic) {
    targets.push({ subtopic: opts.subtopic, title: opts.subtopic, cards });
  } else {
    const plan = await planClusters(llm, cards, model);
    if (!budget.tryAddCost(model, plan.cost_usd)) return { notes_written: written, cost_usd: budget.report().cost_usd_total };
    for (const c of plan.plan.clusters) {
      const sub = cards.filter(card => c.source_ids.includes(card.source_id));
      if (sub.length) targets.push({ subtopic: c.subtopic, title: c.title, cards: sub });
    }
    targets.unshift({ subtopic: "overview", title: "Overview", cards });
  }

  for (const t of targets) {
    if (!opts.refresh && existsSync(synthesisPath(vault, topic.id, t.subtopic))) continue;
    const out = await writeSubtopicNote(llm, t.title, t.cards, model);
    if (!budget.tryAddCost(model, out.cost_usd)) break;
    writeSynthesis(vault, {
      topic_id: topic.id, subtopic: t.subtopic,
      generated_at: new Date().toISOString(),
      model: out.model,
      source_cards: out.cited,
      body_md: out.body_md,
    });
    written.push(synthesisPath(vault, topic.id, t.subtopic));
    log.emit({ kind: "synth_ok", subtopic: t.subtopic, cost_usd: out.cost_usd });
  }
  return { notes_written: written, cost_usd: budget.report().cost_usd_total };
}

function loadCards(vault: string, topicId: string): Card[] {
  const dir = sourcesDir(vault, topicId);
  if (!existsSync(dir)) return [];
  const out: Card[] = [];
  for (const f of readdirSync(dir).filter(n => n.endsWith(".md"))) {
    const txt = readFileSync(join(dir, f), "utf-8");
    const fm = txt.match(/^---\n([\s\S]*?)\n---/);
    const body = txt.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/)?.[1] ?? "";
    if (!fm) continue;
    const meta = yamlParse(fm[1]);
    out.push({
      source_id: meta.source_id, topic_id: meta.topic, url: meta.url,
      title: meta.title, author: meta.author, published: meta.published,
      fetched: meta.fetched, language: meta.language, tags: meta.tags ?? [],
      body_hash: meta.body_hash,
      tldr: extractBullets(body, "## TL;DR"),
      excerpts: extractQuotes(body, "## 핵심 발췌"),
    });
  }
  return out;
}

function extractBullets(body: string, heading: string): string[] {
  const seg = body.split(heading)[1]?.split(/\n## /)[0] ?? "";
  return seg.split("\n").filter(l => l.startsWith("- ")).map(l => l.slice(2).trim());
}
function extractQuotes(body: string, heading: string): string[] {
  const seg = body.split(heading)[1]?.split(/\n## /)[0] ?? "";
  return seg.split("\n").filter(l => l.startsWith("> ")).map(l => l.slice(2).trim());
}
```

- [ ] **Step 3: CLI command**

In `src/cli/research.ts`, replace the commented `synthesize` line with:

```ts
case "synthesize": return runSynthesize(rest);
```

and implement `runSynthesize` similar to `runFetch`, accepting `--subtopic`, `--refresh`, `--model`, `--vault`, `--json`.

- [ ] **Step 4: Pass, commit**

```bash
git add src/research/store/synthesis.ts src/research/pipeline/synthesize.ts src/cli/research.ts test/research/store/synthesis.test.ts test/research/pipeline/synthesize.test.ts
git commit -m "feat(research): add synthesize pipeline and CLI"
```

---

## Phase G — Draft (uses hwicortex SDK search)

### Task G1: Draft prompt + writer

**Files:**
- Create: `src/research/llm/draft.ts`
- Create: `src/research/store/drafts.ts`

- [ ] **Step 1: Prompt**

```ts
// src/research/llm/draft.ts
import type { LlmClient } from "./client.js";

const SYSTEM = `You write a research-grounded draft (Markdown) for the user's prompt.
Use ONLY the provided context. Cite using [^source_id] footnotes when concrete claims come from a source.
Define footnotes at the bottom. Do not fabricate.`;

export async function writeDraft(
  client: LlmClient,
  prompt: string,
  context: { source_id: string; title: string; snippet: string; path: string }[],
  model: string,
  style?: "blog" | "report" | "qa",
): Promise<{ body_md: string; cited: string[]; cost_usd: number; model: string }> {
  const styleHint = style === "blog" ? "Blog post tone (engaging, paragraphs, intro/outro)."
    : style === "qa" ? "Q&A format. Use ##  question style headings."
    : "Report-style: clear sections, factual tone.";
  const ctxStr = context.map(c => `### [${c.source_id}] ${c.title}\n${c.snippet}`).join("\n\n");
  const r = await client.call({
    model, system: SYSTEM + "\n" + styleHint,
    max_tokens: 6000, temperature: 0.6,
    messages: [{ role: "user", content: `User prompt:\n${prompt}\n\nContext:\n${ctxStr.slice(0, 80000)}` }],
  });
  const cited = Array.from(new Set(Array.from(r.text.matchAll(/\[\^([0-9a-f]{12})\]/g)).map(m => m[1])));
  return { body_md: r.text.trim(), cited, cost_usd: r.cost_usd, model };
}
```

- [ ] **Step 2: Writer**

```ts
// src/research/store/drafts.ts
import { mkdirSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { stringify as yamlStringify } from "yaml";
import { draftsDir } from "../topic/paths.js";
import type { Draft } from "../core/types.js";

export function draftPath(vault: string, topicId: string, dateSlug: string): string {
  return join(draftsDir(vault, topicId), dateSlug + ".md");
}

export function writeDraftFile(vault: string, d: Draft): string {
  const dir = draftsDir(vault, d.topic_id);
  mkdirSync(dir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  let n = 1;
  let path = draftPath(vault, d.topic_id, `${today}-${d.slug}`);
  while (existsSync(path)) {
    n += 1;
    path = draftPath(vault, d.topic_id, `${today}-${d.slug}-${n}`);
  }
  const fm = {
    type: "research-draft",
    topic: d.topic_id, slug: d.slug, prompt: d.prompt,
    generated_at: d.generated_at, model: d.model,
    context_sources: d.context_sources, include_vault: d.include_vault,
    hwicortex_index: false,
  };
  writeFileSync(path, `---\n${yamlStringify(fm).trimEnd()}\n---\n\n${d.body_md}\n`);
  return path;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/research/llm/draft.ts src/research/store/drafts.ts test/research/llm/draft.test.ts test/research/store/drafts.test.ts
git commit -m "feat(research): add draft prompt and writer with append-only naming"
```

### Task G2: Draft pipeline (RAG via hwicortex SDK)

**Files:**
- Create: `src/research/pipeline/draft.ts`
- Modify: `src/cli/research.ts` (add `draft` command)
- Test: `test/research/pipeline/draft.test.ts`

- [ ] **Step 1: Implementation**

```ts
// src/research/pipeline/draft.ts
import { createStore } from "../../index.js";
import { notesDir } from "../topic/paths.js";
import { writeDraftFile } from "../store/drafts.js";
import { writeDraft } from "../llm/draft.js";
import { createAnthropicClient } from "../llm/client.js";
import type { TopicSpec } from "../topic/schema.js";
import type { LlmClient } from "../llm/client.js";

export type DraftOptions = {
  topic: TopicSpec;
  vault: string;
  prompt: string;
  slug?: string;
  topK?: number;
  includeVault?: boolean;
  style?: "blog" | "report" | "qa";
  model: string;
  dbPath: string;
  requireContext?: boolean;
  _llmClient?: LlmClient;
};

export type DraftResult = { path: string; cost_usd: number; cited: string[] };

export async function draft(opts: DraftOptions): Promise<DraftResult> {
  const { topic, vault, prompt } = opts;
  const slug = opts.slug ?? slugFromPrompt(prompt);

  // Build a temporary store rooted at the topic notes (or whole vault).
  // The store uses inline config to register a research-topic collection
  // pointing at notes/<id> so that hits stay scoped.
  const collectionPath = opts.includeVault ? vault : notesDir(vault, topic.id);
  const store = await createStore({
    dbPath: opts.dbPath,
    config: { collections: { [`research-${topic.id}`]: { path: collectionPath, pattern: "**/*.md" } } },
  });

  try {
    // Make sure the index exists.
    await store.update();
    await store.embed({});

    const hits = await store.search({
      query: prompt,
      collections: [`research-${topic.id}`],
      limit: opts.topK ?? 12,
      rerank: true,
    });

    if (hits.length === 0 && opts.requireContext) {
      throw new Error("require_context: no RAG hits");
    }

    // HybridQueryResult fields (verified in src/store.ts):
    //   file, displayPath, title, body, bestChunk, bestChunkPos, score, context, docid
    const context = hits.map(h => ({
      source_id: extractSourceId(h.displayPath ?? h.file) ?? "",
      title: h.title || h.displayPath || h.file,
      snippet: h.bestChunk || (h.body ? h.body.slice(0, 800) : ""),
      path: h.displayPath ?? h.file,
    })).filter(c => c.source_id);

    const llm = opts._llmClient ?? createAnthropicClient();
    const out = await writeDraft(llm, prompt, context, opts.model, opts.style);
    const path = writeDraftFile(vault, {
      topic_id: topic.id, slug, prompt,
      generated_at: new Date().toISOString(),
      model: out.model,
      context_sources: context.map(c => c.path),
      include_vault: opts.includeVault ?? false,
      body_md: out.body_md,
    });
    return { path, cost_usd: out.cost_usd, cited: out.cited };
  } finally {
    await store.close();
  }
}

function extractSourceId(path: string): string | null {
  const m = path.match(/sources\/([0-9a-f]{12})\.md/);
  return m ? m[1] : null;
}
function slugFromPrompt(p: string): string {
  return p.toLowerCase().split(/\s+/).slice(0, 6).join("-").replace(/[^a-z0-9-]/g, "").slice(0, 40) || "draft";
}
```

**`dbPath` decision**: use a per-topic database at `<vault>/research/_staging/<id>/draft-rag.sqlite` so this pipeline never mutates the user's main hwicortex index. The CLI computes the path from `--vault` + topic id; agent tool does the same. Document this in the CLI help.

- [ ] **Step 2: CLI**

Add `runDraft` to `src/cli/research.ts`. Required arg: `--prompt`. Optional: `--slug`, `--top-k`, `--include-vault`, `--style`, `--model`, `--require-context`, `--vault`, `--json`.

- [ ] **Step 3: Test (mock SDK by using a tiny in-memory vault and the real createStore)**

Use a temp directory with sample card files to verify the full path returns hits, then mock LLM, and verify `writeDraftFile` produces the expected file. Anthropic client is mocked.

- [ ] **Step 4: Commit**

```bash
git add src/research/pipeline/draft.ts src/cli/research.ts test/research/pipeline/draft.test.ts
git commit -m "feat(research): add draft pipeline using hwicortex SDK for RAG context"
```

---

## Phase H — Topic management CLI + import + status

### Task H1: `topic new`, `topic list`, `topic show` CLI commands

**Files:**
- Create: `src/research/topic/scaffold.ts`
- Modify: `src/cli/research.ts`

- [ ] **Step 1: Scaffold helper**

```ts
// src/research/topic/scaffold.ts
import { mkdirSync, existsSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";
import { stringify as yamlStringify } from "yaml";
import { topicYamlPath } from "./paths.js";

export function scaffoldTopic(vault: string, id: string, fromPrompt?: string): string {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error("topic id must match ^[a-z0-9-]+$");
  const path = topicYamlPath(vault, id);
  if (existsSync(path)) throw new Error("topic already exists: " + path);
  mkdirSync(join(vault, "research", "topics"), { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const tpl = {
    id, title: fromPrompt ?? id, description: "", languages: ["ko", "en"],
    created_at: today, updated_at: today,
    sources: fromPrompt
      ? [{ type: "web-search", queries: [fromPrompt], top_k_per_query: 10 }]
      : [],
    filters: { min_words: 200, max_words: 50000, exclude_domains: [], require_lang: null },
    budget: { max_new_urls: 100, max_total_bytes: 50000000, max_llm_cost_usd: 0.5 },
    cards: { enabled: true, model: "claude-haiku-4-5" },
  };
  writeFileSync(path, yamlStringify(tpl));
  return path;
}

export function listTopicIds(vault: string): string[] {
  const dir = join(vault, "research", "topics");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith(".yml")).map(f => f.slice(0, -4));
}
```

- [ ] **Step 2: CLI**

Implement `runTopic` with subcommands `new <id> [--from-prompt "..."]`, `list`, `show <id>`.

- [ ] **Step 3: Tests, commit**

```bash
git add src/research/topic/scaffold.ts src/cli/research.ts test/research/topic/scaffold.test.ts
git commit -m "feat(research): add topic new/list/show CLI"
```

### Task H2: `import` CLI shortcut

**Files:**
- Modify: `src/cli/research.ts` (add `runImport`)

- [ ] **Step 1: Implementation**

`runImport` accepts `<topic-id> <doc-path> [--mode seeds-only|use-as-cards] [--refetch]`. Behavior:
- Load topic; if not found, scaffold one.
- Append a `from-document` source to the in-memory topic spec only (don't mutate file unless `--persist` is passed; v1 just runs once).
- Call `fetchTopic({ topic, ... })`.

- [ ] **Step 2: Test, commit**

```bash
git add src/cli/research.ts test/research/cli/import.test.ts
git commit -m "feat(research): add import CLI shortcut for from-document sources"
```

### Task H3: `pipeline/status.ts` — shared status reader

**Files:**
- Create: `src/research/pipeline/status.ts`
- Test: `test/research/pipeline/status.test.ts`

Extracted as its own module so both the CLI (`runStatus`) and the agent tool (`research_status`) call the same code path.

- [ ] **Step 1: Implementation**

```ts
// src/research/pipeline/status.ts
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { stagingDir, sourcesDir, notesDir, draftsDir } from "../topic/paths.js";

export type TopicStatus = {
  topic_id: string;
  raw_records: number;
  cards: number;
  synthesis_notes: number;
  drafts: number;
  cost_usd: number;
  last_event_ts: string | null;
  recent_events: any[];
};

export function computeStatus(vault: string, topicId: string): TopicStatus {
  const raw = countLines(join(stagingDir(vault, topicId), "raw.jsonl"));
  const cards = countMd(sourcesDir(vault, topicId));
  const notes = countMdShallow(notesDir(vault, topicId));
  const drafts = countMd(draftsDir(vault, topicId));

  const log = join(stagingDir(vault, topicId), "run-log.jsonl");
  const events: any[] = existsSync(log)
    ? readFileSync(log, "utf-8").split("\n").filter(Boolean).map(l => safeJson(l)).filter(Boolean)
    : [];
  const cost_usd = events
    .filter(e => typeof e?.cost_usd === "number")
    .reduce((s, e) => s + e.cost_usd, 0);

  return {
    topic_id: topicId,
    raw_records: raw,
    cards,
    synthesis_notes: notes,
    drafts,
    cost_usd,
    last_event_ts: events.length ? events[events.length - 1].ts ?? null : null,
    recent_events: events.slice(-10),
  };
}

function countLines(path: string): number {
  if (!existsSync(path)) return 0;
  return readFileSync(path, "utf-8").split("\n").filter(Boolean).length;
}
function countMd(dir: string): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter(f => f.endsWith(".md")).length;
}
function countMdShallow(dir: string): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isFile() && d.name.endsWith(".md"))
    .length;
}
function safeJson(s: string): any { try { return JSON.parse(s); } catch { return null; } }
```

- [ ] **Step 2: Test**

Use a temp vault with hand-written raw.jsonl, sources/, notes/, drafts/, run-log.jsonl. Assert returned counts and `cost_usd` aggregation.

- [ ] **Step 3: Commit**

```bash
git add src/research/pipeline/status.ts test/research/pipeline/status.test.ts
git commit -m "feat(research): extract shared status reader for CLI and agent"
```

### Task H4: `runStatus` CLI command

**Files:**
- Modify: `src/cli/research.ts` (add `runStatus`)

- [ ] **Step 1: Implementation**

`runStatus` accepts `<topic-id> [--json] [--vault]`. It calls `computeStatus(vault, topicId)` and prints either JSON or a human summary (`raw=N cards=N notes=N drafts=N cost=$X.XXXX last=...`).

- [ ] **Step 2: Test, commit**

```bash
git add src/cli/research.ts test/research/cli/status.test.ts
git commit -m "feat(research): add status CLI command using shared status reader"
```

---

## Phase I — Agent integration (Method A + C)

### Task I1: Tool definitions and executor

**Files:**
- Create: `src/research/agent/tools.ts`
- Test: `test/research/agent/tools.test.ts`

- [ ] **Step 1: Implementation**

```ts
// src/research/agent/tools.ts
import type Anthropic from "@anthropic-ai/sdk";
import { fetchTopic } from "../pipeline/fetch.js";
import { synthesize } from "../pipeline/synthesize.js";
import { draft } from "../pipeline/draft.js";
import { computeStatus } from "../pipeline/status.js";
import { loadTopic, adhocTopicFromPrompt } from "../topic/loader.js";
import { listTopicIds } from "../topic/scaffold.js";
import { stagingDir } from "../topic/paths.js";
import { join } from "path";

export const researchTools: Anthropic.Tool[] = [
  {
    name: "research_fetch",
    description: "Fetch sources for a topic and generate cards.",
    input_schema: {
      type: "object",
      properties: {
        topic_id: { type: "string" },
        max_new: { type: "integer", minimum: 1 },
        refresh: { type: "boolean" },
        no_cards: { type: "boolean" },
        dry_run: { type: "boolean" },
        source: { type: "string", enum: ["web-search", "arxiv", "rss", "seed-urls", "from-document"] },
      },
      required: ["topic_id"],
    },
  },
  {
    name: "research_synthesize",
    description: "Build synthesis notes for a topic. Auto-clusters if subtopic omitted.",
    input_schema: {
      type: "object",
      properties: {
        topic_id: { type: "string" },
        subtopic: { type: "string" },
        refresh: { type: "boolean" },
      },
      required: ["topic_id"],
    },
  },
  {
    name: "research_draft",
    description: "Generate a draft from topic context.",
    input_schema: {
      type: "object",
      properties: {
        topic_id: { type: "string" },
        prompt: { type: "string" },
        slug: { type: "string" },
        include_vault: { type: "boolean" },
        style: { type: "string", enum: ["blog", "report", "qa"] },
        top_k: { type: "integer", minimum: 1 },
        require_context: { type: "boolean" },
      },
      required: ["topic_id", "prompt"],
    },
  },
  {
    name: "research_topic_show",
    description: "Show a topic spec.",
    input_schema: { type: "object", properties: { topic_id: { type: "string" } }, required: ["topic_id"] },
  },
  {
    name: "research_topic_list",
    description: "List topics.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "research_status",
    description: "Show topic status (raw count, cards, costs).",
    input_schema: { type: "object", properties: { topic_id: { type: "string" } }, required: ["topic_id"] },
  },
];

export type AgentCtx = {
  vault: string;
  config: any;        // ResearchConfig
  /** Optional override for draft RAG db path. If omitted, uses
   *  <vault>/research/_staging/<topic>/draft-rag.sqlite. */
  dbPath?: string;
};

export async function executeResearchTool(name: string, input: any, ctx: AgentCtx): Promise<{ content: string }> {
  switch (name) {
    case "research_fetch": {
      const topic = await tryLoadTopic(input.topic_id, ctx.vault);
      const r = await fetchTopic({
        topic,
        vault: ctx.vault,
        config: ctx.config,
        refresh: input.refresh,
        maxNew: input.max_new,
        cardsEnabled: !input.no_cards,
        source: input.source,
        dryRun: input.dry_run,
      });
      return { content: JSON.stringify(r) };
    }
    case "research_synthesize": {
      const topic = await loadTopic(input.topic_id, ctx.vault);
      const r = await synthesize({
        topic, vault: ctx.vault, config: ctx.config,
        subtopic: input.subtopic, refresh: input.refresh,
      });
      return { content: JSON.stringify(r) };
    }
    case "research_draft": {
      const topic = await loadTopic(input.topic_id, ctx.vault);
      const dbPath = ctx.dbPath ?? join(stagingDir(ctx.vault, topic.id), "draft-rag.sqlite");
      const r = await draft({
        topic, vault: ctx.vault,
        prompt: input.prompt, slug: input.slug,
        includeVault: input.include_vault, style: input.style,
        topK: input.top_k, requireContext: input.require_context,
        model: ctx.config.models.draft, dbPath,
      });
      return { content: JSON.stringify(r) };
    }
    case "research_topic_show": {
      const t = await loadTopic(input.topic_id, ctx.vault);
      return { content: JSON.stringify(t) };
    }
    case "research_topic_list": {
      return { content: JSON.stringify(listTopicIds(ctx.vault)) };
    }
    case "research_status": {
      return { content: JSON.stringify(computeStatus(ctx.vault, input.topic_id)) };
    }
    default:
      throw new Error("unknown tool: " + name);
  }
}

async function tryLoadTopic(idOrPrompt: string, vault: string) {
  try { return await loadTopic(idOrPrompt, vault); }
  catch { return adhocTopicFromPrompt(idOrPrompt); }
}
```

- [ ] **Step 2: Tests**

Test the tool definitions array shape and that `executeResearchTool` dispatches correctly with mocked pipeline functions (use `vi.mock`).

- [ ] **Step 3: Commit**

```bash
git add src/research/agent/tools.ts test/research/agent/tools.test.ts
git commit -m "feat(research): expose pipeline as Anthropic tool-use definitions"
```

### Task I2: SDK exports

**Files:**
- Create: `src/research/index.ts`
- Modify: `src/index.ts` (re-export research namespace)

- [ ] **Step 1: SDK index**

```ts
// src/research/index.ts
export { fetchTopic } from "./pipeline/fetch.js";
export { synthesize } from "./pipeline/synthesize.js";
export { draft } from "./pipeline/draft.js";
export { loadTopic, adhocTopicFromPrompt } from "./topic/loader.js";
export { scaffoldTopic, listTopicIds } from "./topic/scaffold.js";
export { researchTools, executeResearchTool } from "./agent/tools.js";
export type { TopicSpec, SourceSpec } from "./topic/schema.js";
export type { Card, SynthesisNote, Draft, RawRecord } from "./core/types.js";
```

- [ ] **Step 2: Re-export at hwicortex top level**

In `src/index.ts`, append:

```ts
export * as research from "./research/index.js";
```

- [ ] **Step 3: Build, commit**

```bash
git add src/research/index.ts src/index.ts
git commit -m "feat(research): expose research namespace in hwicortex SDK"
```

### Task I3-I6: Skills (Method C)

**Files:**
- Create: `skills/research/research-pre/SKILL.md`
- Create: `skills/research/research-build/SKILL.md`
- Create: `skills/research/research-draft/SKILL.md`
- Create: `skills/research/research-tidy/SKILL.md`

Skills follow the same shape as `skills/knowledge-pre/`, `knowledge-post/`, etc. Each:
- declares trigger phrases
- explains the behavior
- specifies that automation is **NOT** run automatically — always ask the user before invoking the underlying CLI command
- references the relevant `hwicortex research <subcommand>` invocation

- [ ] **Step 1: Read existing knowledge skill for shape**

```bash
cat /Users/ad03159868/Downloads/Claude_lab/hwicortex/skills/knowledge-pre/SKILL.md
```

- [ ] **Step 2: Write each skill MD following the same structure**

Example (research-pre):

```markdown
---
name: research-pre
description: Prepare or top up sources for a research topic. Triggered when the user says "리서치 준비", "topic <id> 자료 모아", or similar. Always asks for confirmation before running fetch.
---

# Research-Pre

When the user wants to gather sources for a research topic:

1. Identify the target topic id (or short natural-language prompt).
2. Call `hwicortex research topic show <id>` to verify or `topic new <id>` to scaffold.
3. Show the user the candidate plan: source count, queries, budget caps. Ask for confirmation.
4. Run `hwicortex research fetch <id>` and report results.

Do NOT auto-run `fetch`. Always wait for user approval.
```

Repeat for `research-build` (synthesize), `research-draft` (draft), `research-tidy` (status + cleanup of `_staging` cache or stale cards). Stay consistent with the existing knowledge skill voice.

- [ ] **Step 3: Commit**

```bash
git add skills/research/
git commit -m "feat(research): add research-pre/build/draft/tidy skills"
```

---

## Phase J — Wrap-up

### Task J1: README + CHANGELOG

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: README**

Add a `## Research-to-Draft` section near the bottom with:
- one-paragraph description
- one-line install confirmation (already part of hwicortex)
- a 5-line example: scaffold topic → fetch → synthesize → draft → file location
- pointer to spec/plan docs

- [ ] **Step 2: CHANGELOG**

Under `## [Unreleased]`:

```markdown
### Added
- `hwicortex research` subcommand: end-to-end web research → curated cards → synthesis → grounded drafts
- New module `src/research/` with adapter-based discovery (web-search/arxiv/rss/seed-urls/from-document)
- Anthropic tool-use definitions and slash-command skills for agent integration
```

- [ ] **Step 3: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs(research): document new research-to-draft pipeline"
```

### Task J2: Smoke test

**Files:**
- Create: `docs/research/smoke-2026-04-30.md`

- [ ] **Step 1: Run a real-world fetch + synthesize + draft on a small topic**

Pick a small topic (≤ 5 URLs) using `--max-new 5`. Save the resulting numbers, costs, and any anomalies into the smoke doc. Include the exact commands.

- [ ] **Step 2: Commit**

```bash
git add docs/research/smoke-2026-04-30.md
git commit -m "test(research): record initial smoke run results"
```

### Task J3: Final integration test

**Files:**
- Create: `test/research/e2e/end-to-end.test.ts`

- [ ] **Step 1: Hermetic E2E**

Spin up a temp vault, fixture topic, msw HTTP mocks, mock LLM. Run `fetchTopic` → assert raw + cards. Run `synthesize` → assert notes. Run `draft` → assert draft file. Inspect run-log entries.

- [ ] **Step 2: Commit**

```bash
git add test/research/e2e/end-to-end.test.ts
git commit -m "test(research): add end-to-end pipeline smoke covering fetch→synth→draft"
```

---

## Done Criteria

- [ ] `bunx vitest run test/research/` is fully green.
- [ ] `bun run build` produces a clean `dist/` with no TS errors.
- [ ] `bun src/cli/qmd.ts research --help` lists `topic`, `fetch`, `synthesize`, `draft`, `import`, `status`.
- [ ] A topic YAML, fetch run, card files, synthesis notes, and one draft file exist in a real vault.
- [ ] Smoke doc captures real numbers and is committed.
- [ ] CHANGELOG updated.

---

## Open implementation items (from spec — resolve during execution)

1. **`_staging/` indexing exclusion**: confirm hwicortex skips `_`-prefixed directories. If not, add a `.qmdignore` file under `_staging/` automatically (in `StagingStore` constructor).
2. **`SearchResult.snippet` shape**: verify field names returned by `QMDStore.search` and adapt `pipeline/draft.ts` accordingly. Already noted at Task G2.
3. **PDF parser export**: verify `src/ingest/pdf-parser.ts` exposes a buffer-based parse function. If not, add a thin export rather than reimplementing.
4. **Pricing constants in `llm/client.ts`**: revisit if Anthropic publishes pricing changes; treat current values as placeholders documented in the file.
