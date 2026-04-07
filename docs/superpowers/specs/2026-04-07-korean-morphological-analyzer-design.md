# Korean Morphological Analyzer Integration

**Date:** 2026-04-07
**Status:** Approved

## Problem

HwiCortex uses SQLite FTS5 with `tokenize='porter unicode61'` for BM25 search. This works well for English but poorly for Korean. Korean is agglutinative — a single stem like "검색" appears in many surface forms ("검색했다", "검색하는", "검색을") that FTS5 treats as completely different tokens. Searching "검색" won't reliably match "검색했다".

## Solution

Preprocess text with mecab-ko morphological analyzer before inserting into FTS5. Apply the same preprocessing to search queries. The FTS5 tokenizer (`porter unicode61`) remains unchanged.

```
[원문] → [Korean Tokenizer] → [토큰화된 텍스트] → [FTS5 인덱스]
                                                      ↑
[검색 쿼리] → [Korean Tokenizer] → [토큰화된 쿼리] → [FTS5 MATCH]
```

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Integration point | Indexing-time preprocessing | Avoids FTS5 custom tokenizer (C extension, build complexity) |
| Analyzer | mecab-ko | Best accuracy for Korean morphological analysis |
| Scope | All documents | Non-Korean text passes through unchanged |
| Missing mecab | Graceful fallback + install guide | No hard dependency; warns user with platform-specific install commands |

## Components

### 1. `src/korean.ts` — Morphological analysis module

Responsibilities:
- Detect mecab binary availability (`which mecab`)
- On missing mecab: log warning with platform-specific install instructions, set fallback mode
- `tokenizeKorean(text: string): string` — split Korean tokens into morphemes
  - Example: "검색했다" → "검색 하 았 다", "로그인을" → "로그인 을"
  - Non-Korean text (English, numbers, punctuation) passes through unchanged
  - In fallback mode: return input unchanged (no-op)
- mecab invocation via `child_process.execSync` with stdin pipe (batch per document)

Install guide message when mecab is not found:
```
⚠ mecab not found — Korean search quality will be limited.
  Install for better results:
    macOS:  brew install mecab && install-mecab-ko-dic
    Ubuntu: sudo apt install mecab libmecab-dev && install-mecab-ko-dic
```

### 2. Indexing pipeline changes (`src/store.ts`)

Current flow: SQL triggers insert `content.doc` directly into FTS5 `body` column.

New flow:
- Remove FTS5 auto-insert triggers for body/title
- Insert into FTS5 at application level after preprocessing with `tokenizeKorean()`
- `content` table retains original text (unchanged)
- FTS5 `body` and `title` columns receive tokenized text
- `filepath` column unchanged (no Korean content)

### 3. Search query preprocessing (`src/store.ts`)

- Apply `tokenizeKorean()` to query text before `buildFTS5Query()` in `searchFTS()`
- Single preprocessing point at `searchFTS()` entry
- Lex query syntax (quotes, negation, hyphens) parsed first, then each term/phrase preprocessed

### 4. Index migration

- No automatic migration
- Users run `hwicortex rebuild` to regenerate FTS5 with preprocessed text
- `qmd update` also regenerates FTS5 entries for changed documents

## What is NOT affected

- Vector search (embeddings use original text)
- `content` table (stores original text)
- `get`, `multi-get` document retrieval (reads from `content` table)
- Reranking (uses original text)
- Query expansion LLM (operates on original query)

## Testing

- Unit tests for `tokenizeKorean()`: Korean text, English text, mixed text, empty input
- Unit tests for mecab fallback mode (mecab not installed)
- Integration test: index Korean document, search with different surface forms, verify matches
- Regression test: existing English search behavior unchanged
