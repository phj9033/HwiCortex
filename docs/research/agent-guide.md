# Driving `hwicortex research` from an External AI Agent

This guide is for **an AI agent or MCP host that owns its own LLM access**
and uses `hwicortex` as data plumbing. hwicortex itself **does not call
any LLM** — no Anthropic, no OpenAI, no Bedrock. It runs:

- HTTP fetch + extraction (pdfjs, jsdom + Readability, Turndown)
- file IO under `<vault>/research/...` (raw, cards, notes, drafts)
- per-topic SDK store for RAG search (local llama-cpp embedding/rerank)
- robots.txt, rate-limit, dedup, quality filter

Card writing, cluster planning, synthesis prose, and draft prose are
**the agent's job** — done in the agent's own LLM session and persisted
via the SDK or CLI primitives below.

---

## Two integration shapes

### A) In-process: import the SDK

If the agent runs in the same Node process as a `hwicortex` install
(e.g., this Claude Code session), use the SDK:

```ts
import { research } from "hwicortex";

await research.fetchTopic({ topic, vault, config });
const records = readJsonl(`${vault}/research/_staging/${topic.id}/raw.jsonl`);
// agent writes the card markdown itself, then:
research.writeCard(vault, { source_id, ...card });

const { context } = await research.searchTopic({ topic, vault, query });
// agent writes the draft body itself, then:
research.writeDraftFile(vault, { topic_id, slug, ...draft });
```

### B) Subprocess: spawn the CLI

If the agent runs in a separate process (MCP host, GitHub Action,
unrelated language) it spawns `hwicortex research <subcommand>`. Pass
`--json` and parse stdout. The CLI does NOT do LLM work; it just
exposes the same primitives the SDK does.

```sh
hwicortex research fetch <id> --max-new 20 --vault "$VAULT" --json
hwicortex research search <id> --query "..." --top-k 12 --vault "$VAULT" --json
hwicortex research status <id> --vault "$VAULT" --json
```

The agent reads the resulting raw / cards / notes from disk. To write
new cards / notes / drafts via the CLI alone, the user must script
file writes directly — there is no `hwicortex research card-write`
subcommand. Most external agents will do file writes themselves.

---

## Prerequisites

| Requirement | Required for | How to provide |
|---|---|---|
| `hwicortex` on PATH | CLI use | `bun link` once; verify with `which hwicortex` |
| Vault directory | Anything that writes files | `QMD_VAULT_DIR=/path/to/vault` or `--vault /path` |
| `BRAVE_API_KEY` or `TAVILY_API_KEY` | Only `web-search` source | Configure via `~/.config/hwicortex/config.yml` `research.search.{provider, brave, tavily}` |

**No `ANTHROPIC_API_KEY` is required by hwicortex.** The agent's own
LLM access is what powers card / synthesis / draft writing — bring
your own.

### Detecting readiness

```sh
hwicortex research --help
# Should print: usage: hwicortex research <fetch|search|topic|import|status> ...
```

---

## Pipeline state machine

```
  topic new ─┐
             │
             ├─→ fetch ─→ (agent writes cards) ─→ (agent writes synthesis)
             │             │                          │
  topic show ┘             ├─ search ─→ (agent writes draft)
                           │
                           └────────── status (read-only)
```

All hwicortex steps are **idempotent and resumable**:

- `fetch` skips already-staged URLs (canonical-URL-keyed). The agent
  decides whether to re-card a record by comparing `body_hash` in the
  card frontmatter against the new raw record.
- `search` rebuilds (or reuses) the per-topic SDK store. The first run
  on a fresh topic does indexing + embedding (local llama-cpp); later
  runs reuse the SQLite at `<vault>/research/_staging/<id>/draft-rag.sqlite`.

The agent's writes (cards, synthesis notes, drafts) are append-only by
default: same-day same-slug drafts auto-suffix `-2`, `-3`; existing
synthesis notes are not overwritten unless the agent passes its own
`refresh` flag.

---

## CLI reference (all `--json` capable)

### `topic new <id> [--from-prompt "..."]`

Creates `<vault>/research/topics/<id>.yml`. `id` must match
`^[a-z0-9-]+$`.

### `topic list --json`

Returns `["id1", "id2", ...]`.

### `topic show <id> --json`

Returns the full TopicSpec (sources, filters, budget).

### `fetch <id-or-prompt> [--max-new N] [--source <type>] [--dry-run] --json`

Discovery → HTTP fetch → quality filter → extract → write
`raw.jsonl`. **No LLM call.** JSON shape:

```json
{
  "discovered": 12,
  "fetched": 10,
  "skipped": 2,
  "errored": 0,
  "records_added": 10,
  "budget": { "urls": 10, "bytes": 432100 }
}
```

### `search <id> --query "..." [--top-k N] [--include-vault] --json`

Builds (or reuses) the per-topic SDK store, runs hybrid+rerank search
scoped to the topic notes (or the whole vault with `--include-vault`),
returns:

```json
{
  "context": [
    { "source_id": "abcdef012345", "title": "...", "snippet": "...", "path": "..." },
    ...
  ]
}
```

`source_id` is the 12-hex card id derived from the canonical URL. The
agent uses this list as RAG context to write the draft body itself,
then cites with `[^source_id]` footnotes.

### `status <id> --json`

Pure file-system read. Reports `raw_records`, `cards`,
`synthesis_notes`, `drafts`, `last_event_ts`, `recent_events`. Cheap
to poll.

### `import <id> <doc-path> --json`

Convenience over `fetch`: appends an in-memory `from-document` source
to the topic and runs fetch on it. Extracts URLs from the document and
seeds them into the pipeline. Topic YAML is NOT mutated.

---

## SDK reference (`import { research } from "hwicortex"`)

Pipeline:

- `fetchTopic(opts)` — same as the CLI `fetch`.
- `searchTopic(opts)` — same as `search`. Returns `{ hits, context }`.
- `computeStatus(vault, topicId)` — same as `status`.

Topic file IO:

- `loadTopic(idOrPrompt, vault)`, `adhocTopicFromPrompt(prompt)`
- `scaffoldTopic(vault, id, fromPrompt?)`, `listTopicIds(vault)`

File writers (agent generates content, calls these to persist):

- `writeCard(vault, card)` — `notes/<topic>/sources/<source-id>.md`
- `writeSynthesis(vault, note)` — `notes/<topic>/<subtopic>.md`
- `writeDraftFile(vault, draft)` — `drafts/<topic>/<YYYY-MM-DD>-<slug>.md`
  (returns the actual path with `-2` / `-3` suffix on collision)

File readers:

- `readCardFrontmatter(path)` — agent uses this to body-hash-skip
  re-cards on rerun
- `StagingStore` — agent reads raw.jsonl this way

Agent tool surface:

- `researchTools` — Anthropic tool-use definitions for
  fetch/search/topic_*/status. The agent's own orchestrator can
  expose these to its parent LLM.
- `executeResearchTool(name, input, ctx)` — the dispatcher.

---

## A typical agent-driven session (in-process)

```ts
import { research } from "hwicortex";

const vault = process.env.QMD_VAULT_DIR!;
const topic = await research.loadTopic("rag-eval", vault).catch(() => {
  research.scaffoldTopic(vault, "rag-eval", "Evaluating RAG systems");
  return research.loadTopic("rag-eval", vault);
});

// 1. Fetch sources
await research.fetchTopic({ topic, vault, config });

// 2. Read raw records, decide what to card, write each via agent's LLM
const raw = readJsonl(`${vault}/research/_staging/rag-eval/raw.jsonl`);
for (const rec of raw) {
  const existing = research.readCardFrontmatter(
    research.cardPath(vault, "rag-eval", rec.id),
  );
  if (existing?.body_hash === rec.body_hash) continue;

  const card = await myAgentCallsItsOwnLLM_toBuildCardFor(rec);
  // card.excerpts MUST be verbatim substrings of rec.body_md
  research.writeCard(vault, card);
}

// 3. Plan clusters + write synthesis notes (agent reads cards itself)
const cards = readCardFiles(`${vault}/research/notes/rag-eval/sources/`);
const plan = await myAgentCallsItsOwnLLM_toClusterCards(cards); // 3-7 clusters
for (const cluster of plan.clusters) {
  const note = await myAgentCallsItsOwnLLM_toWriteSubtopicNote(cluster);
  research.writeSynthesis(vault, note);
}

// 4. Draft via RAG context
const { context } = await research.searchTopic({
  topic, vault, query: "Survey of RAG eval methods", topK: 12,
});
const draftBody = await myAgentCallsItsOwnLLM_toWriteDraft(context);
const path = research.writeDraftFile(vault, {
  topic_id: "rag-eval",
  slug: "rag-eval-survey",
  prompt: "Survey of RAG eval methods",
  generated_at: new Date().toISOString(),
  model: "claude-opus-4-7-via-claude-code", // whatever the agent used
  context_sources: context.map(c => c.path),
  include_vault: false,
  body_md: draftBody,
});
```

The `myAgentCallsItsOwnLLM_*` calls are placeholders. They could be
direct Anthropic SDK calls, OpenAI, Bedrock, or — when the agent IS a
Claude Code / Codex / Gemini session — just the agent thinking about
the input and producing markdown.

---

## Required behavior of an agent that writes cards

- **Card excerpts MUST be verbatim substrings** of `rec.body_md`
  (whitespace-normalized). The agent must verify this before writing
  the card. Hallucinated quotes destroy the trust model.
- TL;DR is 3-7 short bullets, one line each.
- Tags ≤8.
- Body hash idempotence: skip generation when existing card frontmatter
  matches `rec.body_hash`.

## Required behavior of an agent that writes synthesis notes

- Footnote `[^source_id]` must reference real 12-hex card ids (the
  agent gets these from the cards it has already written or read).
- No claims that aren't supported by the cards.
- One synthesis note per subtopic + an `overview.md`.

## Required behavior of an agent that writes drafts

- Concrete claims must be cited with `[^source_id]` from the
  `searchTopic` context.
- Style hints (blog/report/qa) are the agent's responsibility; hwicortex
  has no opinion.
- The draft is saved with `hwicortex_index: false` in frontmatter so it
  doesn't get pulled back into the user's main wiki collection.

---

## Failure modes

| Symptom | Cause | Recommended response |
|---|---|---|
| `record_added: 0` and `discovered: 0` | source returned no candidates | suggest topic edit |
| `record_added: 0` and `skipped: N` | already fetched | proceed; status reflects current state |
| `searchTopic` returns empty `context` | first run on a fresh topic with no notes yet, or query is too narrow | run after at least one card exists; broaden query |
| `fetch_skip` event with `reason: "no_adapter"` | `web-search` source but no Brave/Tavily key configured | configure key or remove the source |
| Embedding model load takes a long time | first `searchTopic` triggers llama-cpp model download | warn user; this is one-time per topic db |

The CLI never prompts interactively; everything is settable via flags
and env. The SDK never throws on a missing `ANTHROPIC_API_KEY` because
it never reads one.

---

## What an agent should NOT do

- **Don't auto-invoke the slash skills** (`/research-pre`,
  `/research-build`, `/research-draft`, `/research-tidy`,
  `/research-launch-headless`). Those are for interactive sessions
  with explicit user-approval semantics.
- **Don't delete `_staging/cards/notes/drafts`** without explicit user
  instruction. The `/research-tidy` skill exists precisely to surface
  deletion candidates to a human.
- **Don't push topic YAMLs back upstream** — they're user-local config.
  The agent can author them but should leave persistence to the user.
- **Don't write content that isn't grounded in the cards / context**.
  Hallucinated citations turn the whole pipeline into a liability.

---

## Pointers

- Implementation plan and design notes:
  `docs/superpowers/plans/2026-04-30-research-to-draft.md`
- In-process tool definitions: `src/research/agent/tools.ts`
- Skills (in-session workflow): `skills/research-pre/`, `research-build/`,
  `research-draft/`, `research-tidy/`, `research-launch-headless/`
