# HwiCortex

Use Bun instead of Node.js (`bun` not `node`, `bun install` not `npm install`).

## Commands

```sh
hwicortex collection add . --name <n>   # Create/index collection
hwicortex collection list               # List all collections with details
hwicortex collection remove <name>      # Remove a collection by name
hwicortex collection rename <old> <new> # Rename a collection
hwicortex ls [collection[/path]]        # List collections or files in a collection
hwicortex context add [path] "text"     # Add context for path (defaults to current dir)
hwicortex context list                  # List all contexts
hwicortex context check                 # Check for collections/paths missing context
hwicortex context rm <path>             # Remove context
hwicortex get <file>                    # Get document by path or docid (#abc123)
hwicortex multi-get <pattern>           # Get multiple docs by glob or comma-separated list
hwicortex status                        # Show index status and collections
hwicortex update [--pull]               # Re-index all collections (--pull: git pull first)
hwicortex embed                         # Generate vector embeddings (uses node-llama-cpp)
hwicortex query <query>                 # Search with query expansion + reranking (recommended)
hwicortex search <query>                # Full-text keyword search (BM25, no LLM)
hwicortex vsearch <query>               # Vector similarity search (no reranking)
hwicortex mcp                           # Start MCP server (stdio transport)
hwicortex mcp --http [--port N]         # Start MCP server (HTTP, default port 8181)
hwicortex mcp --http --daemon           # Start as background daemon
hwicortex mcp stop                      # Stop background MCP daemon
```

## Collection Management

```sh
# List all collections
hwicortex collection list

# Create a collection with explicit name
hwicortex collection add ~/Documents/notes --name mynotes --mask '**/*.md'

# Remove a collection
hwicortex collection remove mynotes

# Rename a collection
hwicortex collection rename mynotes my-notes

# List all files in a collection
hwicortex ls mynotes

# List files with a path prefix
hwicortex ls journals/2025
hwicortex ls qmd://journals/2025
```

## Context Management

```sh
# Add context to current directory (auto-detects collection)
hwicortex context add "Description of these files"

# Add context to a specific path
hwicortex context add /subfolder "Description for subfolder"

# Add global context to all collections (system message)
hwicortex context add / "Always include this context"

# Add context using virtual paths
hwicortex context add qmd://journals/ "Context for entire journals collection"
hwicortex context add qmd://journals/2024 "Journal entries from 2024"

# List all contexts
hwicortex context list

# Check for collections or paths without context
hwicortex context check

# Remove context
hwicortex context rm qmd://journals/2024
hwicortex context rm /  # Remove global context
```

## Document IDs (docid)

Each document has a unique short ID (docid) - the first 6 characters of its content hash.
Docids are shown in search results as `#abc123` and can be used with `get` and `multi-get`:

```sh
# Search returns docid in results
hwicortex search "query" --json
# Output: [{"docid": "#abc123", "score": 0.85, "file": "docs/readme.md", ...}]

# Get document by docid
hwicortex get "#abc123"
hwicortex get abc123              # Leading # is optional

# Docids also work in multi-get comma-separated lists
hwicortex multi-get "#abc123, #def456"
```

## Options

```sh
# Search & retrieval
-c, --collection <name>  # Restrict search to a collection (matches pwd suffix)
-n <num>                 # Number of results
--all                    # Return all matches
--min-score <num>        # Minimum score threshold
--full                   # Show full document content
--line-numbers           # Add line numbers to output

# Multi-get specific
-l <num>                 # Maximum lines per file
--max-bytes <num>        # Skip files larger than this (default 10KB)

# Output formats (search and multi-get)
--json, --csv, --md, --xml, --files
```

## Build & Install

```sh
bun install            # Install dependencies
bun run build          # TypeScript → dist/ (required before bun link)
bun link               # Install globally as 'hwicortex'
```

## Development

```sh
bun src/cli/qmd.ts <command>   # Run from source (no build needed)
```

## SDK Usage (Library Mode)

Other projects can import hwicortex as a library:

```typescript
import { createStore } from "hwicortex";

const store = await createStore({
  dbPath: "./index.sqlite",
  config: { collections: { docs: { path: "./docs", pattern: "**/*.md" } } },
});
const results = await store.search({ query: "auth flow" });
await store.close();
```

Entry point: `src/index.ts` → `dist/index.js`. Exports `createStore`, types, and utilities.

## Tests

All tests live in `test/`. Run everything:

```sh
npx vitest run --reporter=verbose test/
bun test --preload ./src/test-preload.ts test/
```

## Architecture

- SQLite FTS5 for full-text search (BM25)
- sqlite-vec for vector similarity search
- node-llama-cpp for embeddings (embeddinggemma), reranking (qwen3-reranker), and query expansion (Qwen3)
- Reciprocal Rank Fusion (RRF) for combining results
- Smart chunking: 900 tokens/chunk with 15% overlap, prefers markdown headings as boundaries
- AST-aware chunking: use `--chunk-strategy auto` to chunk code files (.ts/.js/.py/.go/.rs) at function/class/import boundaries via tree-sitter. Default is `regex` (existing behavior). Markdown and unknown file types always use regex chunking.
- Korean morphological analysis via mecab-ko: content morphemes (nouns, verbs, adjectives) are indexed for BM25 so inflected forms match (e.g. "검색" matches "검색했다"). Requires mecab-ko system package; falls back to standard FTS5 tokenization when not installed.

## Important: Do NOT run automatically

- Never run `hwicortex collection add`, `hwicortex embed`, or `hwicortex update` automatically
- Never modify the SQLite database directly
- Write out example commands for the user to run manually
- Index is stored at `~/.cache/qmd/index.sqlite`

## Do NOT compile

- Never run `bun build --compile` - it overwrites the shell wrapper and breaks sqlite-vec
- The `bin/hwicortex` file is a shell script that runs compiled JS from `dist/` - do not replace it
- `npm run build` compiles TypeScript to `dist/` via `tsc -p tsconfig.build.json`

## Releasing

Use `/release <version>` to cut a release. Full changelog standards,
release workflow, and git hook setup are documented in the
[release skill](skills/release/SKILL.md).

Key points:
- Add changelog entries under `## [Unreleased]` **as you make changes**
- The release script renames `[Unreleased]` → `[X.Y.Z] - date` at release time
- Credit external PRs with `#NNN (thanks @username)`
- GitHub releases roll up the full minor series (e.g. 1.2.0 through 1.2.3)

## Wiki

Wiki pages are stored in `vault/wiki/{project}/` as Obsidian-compatible markdown.

### Commands

```sh
hwicortex wiki create "Title" --project <name> --tags t1,t2 --body "content"
hwicortex wiki update "Title" --project <name> --append "more content"
hwicortex wiki link "A" "B" --project <name>
hwicortex wiki list [--project <name>] [--tag <tag>]
hwicortex wiki show "Title" --project <name>
hwicortex wiki rm "Title" --project <name>
hwicortex wiki index --project <name>
hwicortex wiki reset-importance --project <name> | --all [--all-counts]
```

### Wiki Options

- `--no-count`: Skip importance/hit count tracking (for scripts/automation)
- `--auto-merge`: Auto-merge into similar page on create (for MCP/SDK)
- `--force`: Skip similarity check on create
- `--all-counts`: Reset all counts including hit_count (for reset-importance)

### Wiki Suggestion Guidelines

Suggest saving to wiki when:
- A bug cause and solution are confirmed
- An architecture decision is made
- A reusable configuration or procedure is documented
- The user says "정리해줘", "기록해줘", or similar

Suggestion format:
> This looks worth recording in the wiki. Want to save it with `/wiki-save`?

Never auto-execute. Always wait for user approval.
