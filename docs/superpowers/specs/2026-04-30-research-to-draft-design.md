# Research-to-Draft Pipeline — Design

**Date:** 2026-04-30
**Status:** Approved (brainstorming complete)
**Scope:** Stages 1–4 of the user's research workflow (web research → knowledge docs → RAG → AI drafting). Stages 5 (blog enhancement) and 6 (multi-platform publishing) are out of scope and tracked separately.

## Goal

Add a new pipeline to hwicortex that takes a research topic, gathers web sources, builds curated knowledge documents inside the existing vault, makes them automatically available to hwicortex's RAG, and produces AI-written drafts grounded in those documents.

## Non-goals

- Blog content enhancement (stage 5).
- Publishing to external platforms (stage 6).
- Headless-browser rendering for JS-only pages.
- Naver-specific search adapter or NewsAPI dedicated adapter.
- Automatic background polling or scheduling.
- In-stage agentic loops where an LLM autonomously iterates fetch/synthesize.
- Multi-version retention of cards/synthesis notes (git handles history).
- Translation between Korean and English source material.

## High-level data flow

```
topic YAML (vault/research/topics/<id>.yml)
        │
   hwicortex research fetch <id>
        │
        ▼
 ┌─ Discovery ─────────────┐  ┌─ Fetch ─────────┐  ┌─ Extract ─────┐
 │ web-search / arxiv /    │→ │ http+cache+     │→ │ html→md /     │
 │ rss / seed-urls /       │  │ robots+rate     │  │ pdf→text /    │
 │ from-document           │  │ limit           │  │ feed          │
 └─────────────────────────┘  └─────────────────┘  └──────┬────────┘
                                                          │
                                                          ▼
                                              dedup + quality filter
                                                          │
                              ┌───────────────────────────┴───────┐
                              ▼                                   ▼
              _staging/<topic>/raw.jsonl              card writer (Haiku)
              (RawRecord append-only)                            │
                                                                 ▼
                                              notes/<topic>/sources/<id>.md
                                              (vault first-class citizen)
        │
   hwicortex research synthesize <id> [--subtopic]
        │
        ▼
   pipeline/synthesize: cluster cards (auto if no --subtopic) →
   per-cluster Sonnet prompt → notes/<topic>/<subtopic>.md
        │
   (stage 3) hwicortex's existing watcher/index ingests notes/ automatically
        │
   hwicortex research draft <id> --prompt "..."
        │
        ▼
   pipeline/draft: hwicortex SDK search (BM25+vec+rerank) over topic context →
   Sonnet prompt → drafts/<topic>/<YYYY-MM-DD>-<slug>.md
```

## Disk layout (under user's vault)

```
<vault>/
├── research/
│   ├── topics/<id>.yml                       # topic spec (versioned in git)
│   ├── _staging/<id>/                        # excluded from index (prefix `_`)
│   │   ├── raw.jsonl                         # RawRecord append-only
│   │   ├── cache/                            # fetch cache (etag/blobs)
│   │   └── run-log.jsonl                     # reproducibility metadata
│   ├── notes/<id>/
│   │   ├── sources/<source-id>.md            # cards (auto, Haiku)
│   │   ├── overview.md                       # synthesis (manual, Sonnet)
│   │   └── <subtopic>.md                     # synthesis per subtopic
│   └── drafts/<id>/
│       └── <YYYY-MM-DD>-<slug>.md            # stage-4 outputs
└── notes/                                    # user's hand-written notes (existing)
```

`_staging/` indexing exclusion: confirm whether hwicortex skips `_`-prefixed folders. If not, add `.qmdignore` or extend ignore configuration. (Tracked under "Open implementation items".)

## Module layout (`src/research/`)

```
src/research/
├── index.ts              # SDK entry: fetchTopic, synthesize, draft, importDocument
├── topic/
│   ├── schema.ts         # Zod: TopicSpec, SourceSpec, BudgetSpec
│   └── loader.ts         # YAML → TopicSpec; short-NL inputs → ad-hoc topic
├── core/
│   ├── types.ts          # RawRecord, FetchedDoc, Card, SynthesisNote, Draft
│   ├── fetcher.ts        # HTTP + ETag/Last-Modified + robots + rate-limit
│   ├── cache.ts          # _staging/<id>/cache layout
│   ├── dedup.ts          # canonical URL + sha256(body) (+ optional simhash)
│   ├── quality.ts        # min/max words, language, paywall heuristics
│   └── budget.ts         # URLs / bytes / USD caps, accumulators
├── sources/              # Discovery interface implementations
│   ├── web-search.ts     # Brave (default) / Tavily adapter
│   ├── arxiv.ts
│   ├── rss.ts
│   ├── seed-urls.ts
│   └── from-document.ts  # parse a markdown/HTML file for URLs (or extract URL+summary pairs)
├── extractors/
│   ├── html.ts           # Mozilla Readability + turndown
│   ├── pdf.ts            # reuse src/ingest/pdf-parser.ts
│   └── feed.ts
├── llm/                  # Anthropic provider, isolated
│   ├── client.ts         # @anthropic-ai/sdk wrapper
│   ├── card.ts           # Haiku prompt + schema validation + quote substring check
│   ├── synthesize.ts     # Sonnet prompt
│   └── draft.ts          # Sonnet prompt
├── store/
│   ├── staging.ts        # raw.jsonl append + dedup
│   ├── cards.ts          # notes/<id>/sources/*.md writer
│   ├── synthesis.ts      # notes/<id>/<subtopic>.md writer
│   └── drafts.ts         # drafts/<id>/*.md writer
├── pipeline/
│   ├── fetch.ts
│   ├── synthesize.ts
│   └── draft.ts
└── agent/
    └── tools.ts          # Anthropic tool-use definitions + executor (Method A)
```

### Module responsibility principles

- `sources/` implements `Discovery` only: `discover(topic) → AsyncIterable<URL+meta>`. It has no knowledge of fetching or extraction.
- `extractors/` is keyed by content type (HTML/PDF/Feed). It has no knowledge of where the content came from.
- `fetcher.ts` is unaware of why content is being fetched — it only knows caching, robots, and rate limits.
- `llm/` only issues LLM calls and validates schemas; business logic lives in `pipeline/`.
- `store/` only writes files; it does not know about the LLM or the topic-level workflow.
- `pipeline/` is the only layer that orchestrates the others.

### Interface with hwicortex core

- **Read**: `pipeline/draft.ts` calls hwicortex's existing search SDK (`src/index.ts`) for RAG context.
- **Write**: `store/` writes Markdown into the vault. hwicortex's existing watcher/indexer picks them up automatically.
- **Shared deps** (already in `package.json`): `@anthropic-ai/sdk`, `pdfjs-dist`, `yaml`, `zod`, `chokidar`. No new heavy dependencies expected.

### "From-document" input (additional source type)

Two modes for ingesting an existing document of summaries + URLs:

| Mode | Behavior |
|---|---|
| `seeds-only` (default) | Extract URLs from the document; route through normal fetch + Haiku card pipeline. |
| `use-as-cards` | Use Haiku to parse `(url, title?, summary, quoted_excerpts?)` tuples from the document and write them directly as cards. Original URLs are not fetched unless `refetch: true`. |

Topic YAML expression:
```yaml
sources:
  - type: from-document
    path: ~/my-research-bookmarks.md       # absolute or vault-relative
    mode: seeds-only                       # or use-as-cards
    refetch: false
```

CLI shortcut:
```
hwicortex research import <topic-id> <document-path> [--mode seeds-only|use-as-cards] [--refetch]
```

Idempotence: document sha256 + per-URL dedup. New URLs added on re-import; existing cards untouched.

## Schemas

### Topic YAML

```yaml
id: rag-evaluation                         # slug, used as directory key (^[a-z0-9-]+$)
title: "RAG 평가 방법론"
description: |
  검색-증강 생성 평가 지표/벤치마크/휴먼 vs 자동 평가 비교.
languages: [ko, en]
created_at: 2026-04-30
updated_at: 2026-04-30                     # auto-updated by `research fetch`

sources:                                   # discriminated by `type`
  - type: web-search
    queries:
      - "RAG evaluation metrics"
      - "RAG 평가 지표"
    site_filters: []
    since: 2024-01-01
    top_k_per_query: 15

  - type: arxiv
    queries: ["retrieval augmented generation evaluation"]
    categories: [cs.CL, cs.IR]
    top_k: 30

  - type: rss
    feeds:
      - https://blog.langchain.dev/rss/

  - type: seed-urls
    urls: ["https://example.com/page"]

  - type: from-document
    path: ./bookmarks.md
    mode: seeds-only

filters:
  min_words: 200
  max_words: 50000
  exclude_domains: [pinterest.com, quora.com]
  require_lang: null

budget:                                    # per `fetch` invocation
  max_new_urls: 100
  max_total_bytes: 50_000_000              # 50 MB
  max_llm_cost_usd: 0.50

cards:
  enabled: true
  model: claude-haiku-4-5                  # override
```

Short-natural-language input (`hwicortex research fetch "RAG 평가"`) auto-generates an ad-hoc topic file with a single `web-search` source and a slug derived from the prompt + hash.

### RawRecord (`_staging/<id>/raw.jsonl`)

```ts
type RawRecord = {
  id: string;                              // sha256(canonical_url)[:12]
  topic_id: string;
  source_type: "web-search" | "arxiv" | "rss" | "seed-urls" | "from-document";
  url: string;
  canonical_url: string;
  title: string | null;
  author: string | null;
  published_at: string | null;             // ISO 8601
  fetched_at: string;
  content_type: "html" | "pdf" | "feed-item";
  language: string | null;

  body_md: string;
  word_count: number;
  body_hash: string;                       // sha256(body_md)

  source_meta: Record<string, unknown>;    // adapter-specific (query, score, arxiv id, ...)
  cache_blob: string | null;               // _staging/<id>/cache/blobs/<hash>
};
```

JSONL append-only. Duplicates by `id` or `body_hash` are skipped.

### Card (`notes/<id>/sources/<source-id>.md`)

```markdown
---
type: research-card
topic: rag-evaluation
source_id: a3f9c2e1b4d8
url: https://arxiv.org/abs/2401.12345
title: "Beyond Retrieval: Evaluating Generation Quality in RAG Systems"
author: "Jane Doe et al."
published: 2024-01-15
fetched: 2026-04-30
language: en
tags: [rag, evaluation, faithfulness]     # ≤ 8
body_hash: "<sha256 of source RawRecord.body_md>"  # idempotence key
hwicortex_index: true
---

# <title>

## TL;DR
3–7 bullets (Haiku).

## 핵심 발췌
> Verbatim quotes (validated as substring of body_md).

## 메모
Reserved for synthesis later — cards do not contain analysis.

[원문 링크](<url>)
```

Card validation before write:
- Frontmatter passes Zod schema.
- Each quoted excerpt must exist as a substring of `body_md`. Failed quotes are dropped (Haiku hallucination guard).
- `tags` length ≤ 8.

### Synthesis note (`notes/<id>/<subtopic>.md`)

```markdown
---
type: research-synthesis
topic: rag-evaluation
subtopic: evaluation-metrics              # or "overview"
generated_at: 2026-04-30T10:30:00Z
model: claude-sonnet-4-6
source_cards: [a3f9c2e1b4d8, b7e2d4a91f02]
hwicortex_index: true
---

# 평가 지표

## 개요
…

## Faithfulness
…[^a3f9c2e1b4d8]

## 출처
[^a3f9c2e1b4d8]: [Beyond Retrieval... (Doe 2024)](sources/a3f9c2e1b4d8.md)
```

- Cited via Markdown footnotes, preserving traceability to source cards.
- `source_cards` is auto-populated by extracting cited IDs from the model's response.
- Re-synthesis of the same `subtopic` overwrites the file (git captures history).

### Draft (`drafts/<id>/<YYYY-MM-DD>-<slug>.md`)

```markdown
---
type: research-draft
topic: rag-evaluation
slug: rag-eval-overview
prompt: |
  RAG 평가 방법을 처음 접하는 시니어 엔지니어를 위한 개요 문서를 써줘.
generated_at: 2026-04-30T11:00:00Z
model: claude-sonnet-4-6
context_sources:                          # which notes RAG retrieved
  - notes/rag-evaluation/overview.md
  - notes/rag-evaluation/sources/a3f9c2e1b4d8.md
  - notes/rag-evaluation/evaluation-metrics.md
include_vault: false
hwicortex_index: false                    # default, prevents self-RAG noise
---

# (초안) RAG 평가 방법 — 실무 의사결정 가이드
…
```

- `hwicortex_index: false` by default — drafts are not indexed unless the user toggles.
- Re-running with the same `--slug` produces a new file (`<date>-<slug>-2.md`); never overwrites.

### Indexing inclusion/exclusion

| Path | Indexed? | Reason |
|---|---|---|
| `topics/*.yml` | No | YAML, not searchable content. |
| `_staging/**` | No | Raw data, would pollute search. |
| `notes/<id>/sources/*.md` | Yes | Cards = evidence. |
| `notes/<id>/*.md` (overview/subtopic) | Yes | Synthesis notes = first-class. |
| `drafts/**` | No (per-file frontmatter) | User can opt in by toggling frontmatter. |

## CLI surface

### Command tree

```
hwicortex research
├── topic
│   ├── new <id> [--from-prompt "..."]   # scaffold topics/<id>.yml
│   ├── list                             # topics + last fetch / card / note counts
│   └── show <id>                        # YAML + accumulated stats
│
├── fetch <id|"prompt">                  # stage 1 + cards
│   --refresh                            # ignore cache (default = incremental)
│   --max-new <N>                        # override budget.max_new_urls
│   --no-cards                           # raw.jsonl only
│   --dry-run                            # discovery only; print candidates + cost estimate
│   --source <type>                      # restrict to one adapter
│
├── synthesize <id>                      # stage 2
│   --subtopic "<name>"                  # explicit; missing = auto-cluster + overview
│   --refresh                            # overwrite existing synthesis (default = skip)
│   --model claude-sonnet-4-6
│
├── draft <id> --prompt "..."            # stage 4
│   --slug <slug>
│   --include-vault                      # broaden RAG to whole vault (default = topic only)
│   --style blog|report|qa
│   --top-k <N>
│   --require-context                    # exit 1 if RAG returns 0 hits (default = warn + proceed)
│   --model claude-sonnet-4-6
│
├── import <id> <doc-path>               # stage 1 shortcut from a doc
│   --mode seeds-only|use-as-cards
│   --refetch
│
├── status <id>                          # raw count, card count, accumulated cost, last run
│
└── mcp                                  # OUT OF v1 SCOPE (see §Agent integration)
```

Short-NL fallback: `hwicortex research fetch "RAG 평가"` synthesizes a topic YAML on first use, persists it under `topics/<auto-id>.yml`, and runs.

### Output conventions

- Progress: human-readable on stderr (TTY = colored progress; non-TTY = line-buffered).
- Result: human summary on stdout by default; `--json` switches to machine-readable.
- Cost line at end: `Cost: $0.034 (Haiku: $0.012, Sonnet: $0.022)`.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Success (incl. partial fetch failures — those are reported, not fatal). |
| 1 | Input error (missing topic, YAML parse failure). |
| 2 | External dependency failure (network down, auth failure). |
| 3 | Budget cap hit; partial results are committed. |

### Configuration

Resolution order (later overrides earlier):

1. Bundled defaults: `config/default.yml`.
2. User config: `~/.config/hwicortex/config.yml`.
3. Topic YAML: `<vault>/research/topics/<id>.yml`.
4. CLI flags.

Secrets remain environment variables (per existing hwicortex pattern):

- `ANTHROPIC_API_KEY`
- `BRAVE_SEARCH_API_KEY` (or `TAVILY_API_KEY`)

`config/default.yml` gains a `research:` section:

```yaml
research:
  models:
    card:  claude-haiku-4-5
    synth: claude-sonnet-4-6
    draft: claude-sonnet-4-6
  search:
    provider: brave                       # brave | tavily | none
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

No new non-secret env vars are introduced.

### SDK entry points (`src/research/index.ts`)

```ts
export async function fetchTopic(opts: FetchOptions): Promise<FetchResult>;
export async function synthesize(opts: SynthOptions): Promise<SynthResult>;
export async function draft(opts: DraftOptions): Promise<DraftResult>;
export async function importDocument(opts: ImportOptions): Promise<ImportResult>;
export async function loadTopic(id: string, vaultPath: string): Promise<TopicSpec>;
```

CLI commands are thin wrappers over these.

## Error handling

| Stage | Failure | Behavior |
|---|---|---|
| Discovery | Search API auth failure | exit 2 with explicit missing-key message. |
| Discovery | Search API rate limit | Exponential backoff (3 attempts); skip query, accumulate warnings. |
| Discovery | arXiv transient outage | Retry then skip; other sources continue. |
| Fetch | Single URL failure (404/timeout/SSL) | Skip URL, log to `run-log.jsonl`; final report counts. |
| Fetch | robots.txt disallow | Skip domain; report at end. |
| Fetch | `max_total_bytes` reached | Halt run, commit partial results, exit 3. |
| Fetch | Same domain consecutive failures (≥5) | Quarantine domain for this run; warn. |
| Extract | HTML parse failure / empty body | Reject in `quality.ts`; log. |
| Extract | PDF parse failure | Skip + warn. |
| Extract | Language detection failure | Empty string; pass filter unless excluded. |
| Card (Haiku) | Rate limit | Backoff + retry. |
| Card | Schema-violating response | One retry; if still bad, skip card (raw retained). |
| Card | Hallucinated quote (substring check fails) | Drop that quote; keep card. |
| Card | Cost cap reached | Halt run, commit partial cards, exit 3. |
| Synthesize | API failure | One retry; otherwise exit 2 (user-explicit op, fail loudly). |
| Synthesize | Cited card ID does not exist | Drop that footnote; warn. |
| Draft | RAG returns 0 hits | Warn and proceed (Sonnet runs without context — weak result). `--require-context` flag flips to exit 1. |

### Partial-failure principles

- `fetch` treats partial success as the norm (e.g., 47/50 OK). Exit 0; report counts.
- `synthesize` and `draft` are all-or-nothing — they are user-explicit and partial outputs cause confusion. On failure, no file is written.
- All partial failures land in `_staging/<id>/run-log.jsonl`, surfaced via `hwicortex research status <id>`.

### Idempotence

- **Fetch**: `body_hash` + `canonical_url` dedup; cache-hit avoids LLM call entirely.
- **Cards**: skip regeneration when card frontmatter `body_hash` matches the current RawRecord. Regenerate only on body change.
- **Synthesize**: same `--subtopic` re-run is a no-op unless `--refresh` is given.
- **Draft**: always writes a new file.

### Budget guarding

- All LLM calls pass through `core/budget.ts`, which tracks tokens and dollar cost.
- Hitting `max_llm_cost_usd` halts the run, commits partial work, and exits 3.
- `--dry-run` runs only Discovery and prints candidate URLs plus an estimated cost.

## Testing strategy

### Unit tests (`vitest`, in `test/`)

| Module | Coverage |
|---|---|
| `topic/loader.ts` | Valid/invalid YAML; short-NL ad-hoc topic generation. |
| `core/dedup.ts` | Canonical-URL normalization, body hashing, duplicate detection. |
| `core/quality.ts` | Word/lang filters, paywall heuristic. |
| `core/budget.ts` | Accumulation, overage, reset semantics. |
| `extractors/html.ts` | Fixture-driven golden tests (HTML → markdown). |
| `extractors/pdf.ts` | Reuse existing pdf-parser fixtures where possible. |
| `llm/card.ts` | Mocked Anthropic responses; schema validation; quote substring check. |
| `llm/synthesize.ts` | Mocked responses; footnote/citation extraction. |

### Integration tests

- HTTP traffic mocked via `msw` or `nock` using stored fixtures (HTML/PDF/RSS XML).
- Anthropic SDK stubbed when `ANTHROPIC_API_KEY=test`.
- One end-to-end scenario: fixture topic YAML → `fetchTopic` → cards on disk → `synthesize` → notes on disk → assertions.

### Smoke testing

The first PR includes a manual smoke run with real keys (single topic, small budget) checked in as `docs/research/smoke-2026-04-30.md`, capturing fetch counts, card counts, costs, and any anomalies.

## Agent integration (Tier ① only — methods A + C)

Each pipeline function is exposed as a callable tool so external agents can orchestrate the pipeline. **Stages remain deterministic internally** — autonomous in-stage loops are explicitly out of scope for v1.

### Method A — Anthropic tool-use definitions

`src/research/agent/tools.ts` exports:

```ts
export const researchTools: Anthropic.Tool[] = [
  { name: "research_fetch",       description: "...", input_schema: { ... } },
  { name: "research_synthesize",  description: "...", input_schema: { ... } },
  { name: "research_draft",       description: "...", input_schema: { ... } },
  { name: "research_import",      description: "...", input_schema: { ... } },
  { name: "research_status",      description: "...", input_schema: { ... } },
  { name: "research_topic_show",  description: "...", input_schema: { ... } },
];

export async function executeResearchTool(
  name: string,
  input: unknown,
  ctx: { vaultPath: string }
): Promise<{ content: string }>;
```

The executor maps tool names to SDK functions. Schemas mirror CLI flags. SDK consumers `import { researchTools, executeResearchTool } from "hwicortex/research/agent"`.

### Method C — Skills (`skills/research/`)

Following the existing `knowledge-*` pattern:

| Skill | Purpose |
|---|---|
| `/research-pre <topic>` | Trigger fetch and summarize results. |
| `/research-build <topic>` | Trigger synthesize (auto-cluster). |
| `/research-draft <topic> "<prompt>"` | Generate a draft. |
| `/research-tidy` | Status check; surface stale caches and empty cards. |

Skills follow CLAUDE.md's "no auto-execution; always wait for approval" rule.

### MCP server (Method B) — out of v1 scope

The `hwicortex research mcp` command is reserved as a future addition. It would expose the same tools to MCP clients. Adding it later requires only a thin adapter over `executeResearchTool`.

## Open implementation items

These do not block design approval but must be resolved during implementation:

1. **`_staging/` indexing exclusion.** Verify whether hwicortex skips folders prefixed with `_`. If not, add `.qmdignore` or extend its ignore configuration. Document the chosen mechanism in code.
2. **Search-API choice for v1.** Both Brave and Tavily are implementable as adapters. Default ships as Brave (free tier of ~2k req/month, simple key). Final choice can be deferred until first smoke test.
3. **hwicortex SDK search export.** Confirm whether the current SDK exposes a programmatic `search(query, vaultPath, opts)` callable from `pipeline/draft.ts`. If absent, add a thin SDK extension.
4. **Korean tokenization.** mecab-ko is applied at indexing time by hwicortex; no special handling expected in the new pipeline. Verify on first integration.

## Risks

- **LLM cost variance**: synthesis and draft on a large topic may exceed expectation. Mitigated by per-run `max_llm_cost_usd` and `--dry-run` cost estimation.
- **HTML extraction quality**: Readability fails on heavy SPAs; v1 accepts this and surfaces it as a fetch warning. Headless rendering deferred.
- **Quote-substring check tightness**: very strict matching may drop legitimate near-quotes (e.g., whitespace-normalized). The check normalizes whitespace and Unicode form before comparing.
- **Topic-id collisions** for short-NL inputs: hash suffix prevents collisions but can produce ugly slugs. Acceptable for v1.

## Out of scope (explicit non-goals)

- Stage 5 (blog enhancement) and Stage 6 (multi-platform publishing) — separate spec.
- Headless-browser fetching.
- Naver search adapter, NewsAPI adapter (web-search with `--since` covers most of the latter).
- Background polling / scheduling daemon.
- Image and screenshot capture.
- Multi-version retention of generated artifacts.
- LLM reranking inside fetch (uses hwicortex's existing rerank only at draft time).
- Translation between languages.
- In-stage autonomous LLM loops (Tier ② of agent integration).
