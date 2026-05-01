# Driving `hwicortex research` from an External AI Agent

This guide is for **another AI agent or MCP host** that wants to run the
research-to-draft pipeline as a subprocess. It assumes the agent does
NOT have in-process access to this codebase — only the installed
`hwicortex` CLI and a shell.

If you ARE running inside this repo with SDK access, prefer the
`research.researchTools` / `research.executeResearchTool` API instead
(see `src/research/agent/tools.ts`). The CLI route is for cross-process
agents (Claude Desktop tool servers, MCP hosts, GitHub Actions, etc.).

---

## Prerequisites

The host that spawns the CLI must provide all of these:

| Requirement | Required for | How to provide |
|---|---|---|
| `hwicortex` on PATH | Everything | `bun link` once, or `npm install -g`; verify with `which hwicortex` |
| `ANTHROPIC_API_KEY` | `fetch` (default), `synthesize`, `draft` | Pass through `env: { ANTHROPIC_API_KEY: "sk-ant-..." }` when spawning |
| Vault directory | Everything that writes files | Set `QMD_VAULT_DIR=/path/to/vault` or pass `--vault /path` to each command |
| `BRAVE_API_KEY` or `TAVILY_API_KEY` | Only `web-search` source type | Configure via `~/.config/hwicortex/config.yml` `research.search.{provider, brave, tavily}` |

The host does NOT need to install Bun or build the project — only the
already-built `hwicortex` binary.

### Detecting readiness

```sh
hwicortex research --help
# Should print: usage: hwicortex research <fetch|synthesize|draft|topic|import|status> ...
```

If this fails, the CLI is not installed or not on PATH for the agent's
subprocess environment.

---

## Pipeline state machine

```
  topic new ──┐
              ├─→ fetch ──→ synthesize ──→ draft
  topic show ─┘     │            │           │
                    └────────────┴───────────┴─→ status
```

Steps are **idempotent and resumable**:

- `fetch` skips already-staged URLs (canonical-URL-keyed) and skips card
  regeneration when the card's frontmatter `body_hash` matches the new
  record's hash.
- `synthesize` skips an existing subtopic note unless `--refresh` is set.
- `draft` always writes a new draft; same-day same-slug runs auto-suffix
  with `-2`, `-3`, ...

So a stuck or restarted agent can re-run the same command without
duplicating work or losing prior output.

---

## Recommended command shape

Always pass `--json` and `--vault` explicitly so the agent doesn't depend
on user environment defaults. Read stdout as JSON.

```sh
hwicortex research <subcommand> [args] --vault "$VAULT" --json
```

Process exit codes:
- `0` — success (output is valid JSON)
- `1` — usage error (missing arg)
- `2` — validation error (bad enum value, etc.)
- non-zero from a runtime error — `stderr` carries the message; `stdout`
  may be empty or partial

---

## Subcommands

### `topic new <id> [--from-prompt "..."]`

Create a topic YAML at `<vault>/research/topics/<id>.yml`. `id` must
match `^[a-z0-9-]+$`.

```sh
hwicortex research topic new rag-eval --from-prompt "Evaluating RAG systems" --vault "$VAULT"
# stdout: Created /path/to/vault/research/topics/rag-eval.yml
```

Fails (exit 2) if the id is invalid or the file already exists.

### `topic list --json`

```sh
hwicortex research topic list --vault "$VAULT" --json
# stdout: ["rag-eval", "agent-eval", ...]
```

### `topic show <id> --json`

```sh
hwicortex research topic show rag-eval --vault "$VAULT" --json
# stdout: full TopicSpec — id, title, sources[], filters, budget, cards
```

Fails if topic not found.

### `fetch <id-or-prompt> [--max-new N] [--source <type>] [--no-cards] [--dry-run] --json`

Calls Discovery for each source, fetches HTTP/HTTPS, writes raw records
+ cards.

- `--no-cards` skips the Haiku card-generation step (no
  ANTHROPIC_API_KEY needed for this run)
- `--source` constrains to one of `seed-urls|arxiv|rss|web-search|from-document`
- `--max-new` caps new URLs per run (overrides topic.budget.max_new_urls)

Output JSON shape:

```json
{
  "discovered": 12,
  "fetched": 10,
  "skipped": 2,
  "errored": 0,
  "records_added": 10,
  "budget": {
    "urls": 10,
    "bytes": 432100,
    "cost_usd_total": 0.0123,
    "cost_usd_by_model": { "claude-haiku-4-5": 0.0123 }
  }
}
```

Costs are per-run, not cumulative — track totals via `status`.

### `synthesize <id> [--subtopic <name>] [--refresh] [--model <id>] --json`

If `--subtopic` is omitted, calls Sonnet to plan 3-7 subtopic clusters,
then writes one note per cluster + an `overview.md`. With `--subtopic`,
writes a single targeted note.

Output:

```json
{ "notes_written": ["/.../research/notes/<id>/<sub>.md", ...], "cost_usd": 0.0456 }
```

Returns `notes_written: []` and `cost_usd: 0` when no cards exist yet
(call `fetch` first).

### `draft <id-or-prompt> --prompt "..." [--style blog|report|qa] [--top-k N] [--include-vault] [--require-context] [--slug s] [--db-path p] --json`

Builds a per-topic SDK store at
`<vault>/research/_staging/<id>/draft-rag.sqlite` (or `--db-path`),
indexes the topic notes, runs hybrid+rerank search, calls Sonnet with
the hits as context, writes a draft markdown.

- `--prompt` is required.
- `--require-context` makes the command fail if the SDK returns 0 hits
  (useful when the agent wants to refuse rather than hallucinate).

Output:

```json
{
  "path": "/.../research/drafts/<id>/<YYYY-MM-DD>-<slug>.md",
  "cost_usd": 0.0789,
  "cited": ["abcdef012345", "112233445566"]
}
```

`cited` is the deduplicated list of `[^source_id]` footnotes the LLM
emitted. Length 0 is a yellow flag — the model didn't ground anything.

### `status <id> --json`

Pure file-system read; no LLM, no network. Always cheap. Suitable for
polling.

```json
{
  "topic_id": "rag-eval",
  "raw_records": 10,
  "cards": 10,
  "synthesis_notes": 4,
  "drafts": 2,
  "cost_usd": 0.135,
  "last_event_ts": "2026-04-30T10:23:01Z",
  "recent_events": [ /* last 10 run-log entries */ ]
}
```

`cost_usd` here aggregates events from the `run-log.jsonl` and may
underestimate the real spend slightly (events without a `cost_usd`
field don't count). Treat as an order-of-magnitude tracker.

### `import <id> <doc-path> [--mode seeds-only|use-as-cards] [--refetch] --json`

Convenience wrapper over `fetch` that injects an in-memory
from-document source. The topic YAML is NOT mutated.

`use-as-cards` mode requires `ANTHROPIC_API_KEY` (Haiku extracts
`{url, title, summary, excerpts}` tuples and writes them as synthetic
cards directly).

---

## A typical agent-driven session

```sh
export ANTHROPIC_API_KEY=sk-ant-...
export VAULT=/Users/me/hwicortex-vault

# 1. Provision topic (idempotent if it already exists — check first)
hwicortex research topic show rag-eval --vault "$VAULT" --json 2>/dev/null \
  || hwicortex research topic new rag-eval --from-prompt "Evaluating RAG systems" --vault "$VAULT"

# 2. Gather sources (idempotent; pass --max-new to cap blast radius)
hwicortex research fetch rag-eval --max-new 10 --vault "$VAULT" --json
# Inspect: records_added, budget.cost_usd_total

# 3. Synthesize once enough cards exist (status.cards >= 3 is a reasonable gate)
hwicortex research status rag-eval --vault "$VAULT" --json
hwicortex research synthesize rag-eval --vault "$VAULT" --json

# 4. Draft against the topic notes
hwicortex research draft rag-eval \
  --prompt "Brief survey of current RAG evaluation methods" \
  --style report --top-k 12 \
  --vault "$VAULT" --json

# 5. Final status
hwicortex research status rag-eval --vault "$VAULT" --json
```

Each step is one subprocess call. The agent is responsible for ordering,
retries, and budget interpretation.

---

## Budget interpretation

The agent should treat `budget.cost_usd_total` as an **approximate spend
ceiling for this command's scope**, not a session-wide tracker.

- `fetch` budget caps URLs (`max_new_urls`), bytes (`max_total_bytes`),
  and Haiku cost (`max_llm_cost_usd`). When any cap is hit the run
  halts cleanly and emits a `budget_halt` log event with `reason`.
- `synthesize` and `draft` use the same Budget object scoped to that
  one run.
- These caps default from the topic YAML (`budget:` block); override
  via topic edits or future `--budget-*` flags (not yet implemented).

If your agent has a session-wide spend ceiling, sum `cost_usd` across
runs from `status` or your own bookkeeping.

---

## Failure modes the agent should handle

| Symptom | Likely cause | Recommended response |
|---|---|---|
| `Error: ANTHROPIC_API_KEY not set` (or 401 from Anthropic) | env var missing | Surface to user; don't retry |
| `record_added: 0` and `discovered: 0` | source returned no candidates (e.g., wrong queries) | Suggest topic edit; don't loop |
| `record_added: 0` and `skipped: N` | already fetched | Working as intended; proceed to synthesize |
| `notes_written: []` from synthesize | no cards yet | Run fetch first |
| `cited: []` from draft | LLM didn't ground; usually means topic notes are too thin | Increase `--top-k`, add `--include-vault`, or fetch more sources |
| `budget_halt` in run-log | hit cap | Either accept partial result or raise topic budget |
| `fetch_skip` with `reason: "no_adapter"` | source type registered but no adapter (only `web-search` if Brave/Tavily key missing) | Configure key or remove the source |

The CLI never prompts interactively; everything is settable via
flags/env. Agents can run unattended.

---

## What the agent should NOT do

- **Don't auto-invoke the slash skills** (`/research-pre`,
  `/research-build`, `/research-draft`, `/research-tidy`) — those
  carry user-facing "ask before running" semantics. They're for
  Claude Code interactive sessions, not headless agents.
- **Don't delete `_staging/`, cards, notes, or drafts** without
  explicit user instruction. The `tidy` skill exists precisely to
  surface deletion candidates to a human.
- **Don't push topic YAMLs back upstream** — they're user-local
  config. The agent can author them but should leave persistence to
  the user.

---

## MCP host integration sketch

If you're wiring this into an MCP server that exposes the pipeline as
tools, the natural mapping is one MCP tool per subcommand. Example
(stdio MCP):

```json
{
  "name": "research_fetch",
  "description": "Gather web sources for a research topic and generate cards.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "topic_id": { "type": "string" },
      "max_new":  { "type": "integer", "minimum": 1 },
      "no_cards": { "type": "boolean" }
    },
    "required": ["topic_id"]
  }
}
```

Server impl spawns `hwicortex research fetch <topic_id> --max-new N
[--no-cards] --vault $VAULT --json` and returns stdout. The schemas
emitted by `src/research/agent/tools.ts` (`researchTools`) are a
ready-to-copy reference.

---

## Pointers

- Implementation plan and design notes:
  `docs/superpowers/plans/2026-04-30-research-to-draft.md`
- In-process tool definitions: `src/research/agent/tools.ts`
- Smoke run guide (deferred live test): `docs/research/smoke-2026-04-30.md`
- SDK namespace: `import { research } from "hwicortex"`
