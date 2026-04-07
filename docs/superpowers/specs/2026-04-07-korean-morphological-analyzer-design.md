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
| POS filtering | Keep content words only (nouns, verbs, adjectives, adverbs) | Grammatical particles produce noisy prefix matches in FTS5 |
| mecab invocation | Persistent spawned process with streaming I/O | `execSync` per document is too slow for bulk indexing |

## Components

### 1. `src/korean.ts` — Morphological analysis module

Responsibilities:
- Detect mecab binary availability (`which mecab`)
- On missing mecab: log warning with platform-specific install instructions, set fallback mode
- `tokenizeKorean(text: string): string` — split Korean tokens into morphemes
- In fallback mode: return input unchanged (no-op)

**mecab invocation:**
- Use `child_process.spawn('mecab')` with persistent process, streaming stdin/stdout
- Lazy-start on first call, keep alive for session duration
- For bulk indexing (rebuild/update), reuse the same process across all documents
- Graceful shutdown on process exit

**mecab output parsing:**
```
검색    NNG,*,T,검색,*,*,*,*
했      XSV+EP,*,T,했,하/XSV/*+았/EP/*,*,*,*
다      EF,*,F,다,*,*,*,*
EOS
```

Parse strategy:
- Split each line on `\t`, take surface form (column 0) and POS tag (first field of column 1)
- **Keep content-word POS tags:** NNG (일반명사), NNP (고유명사), NNB (의존명사), VV (동사), VA (형용사), MAG (일반부사), XR (어근)
- **Drop grammatical POS tags:** JKS, JKC, JKG, JKO, JKB, JKV, JKQ (조사), EP, EF, EC, ETN, ETM (어미), XSN, XSV, XSA (접사)
- Output: space-separated content morphemes
- Example: "검색했다" → "검색" (only NNG kept), "로그인을 시작합니다" → "로그인 시작"

**Korean text detection:**
- Detect Korean segments by Unicode Hangul Syllables range (U+AC00–U+D7AF)
- Split text into Korean vs non-Korean runs
- Only Korean runs go through mecab; non-Korean runs pass through unchanged
- Mixed-script tokens like "React컴포넌트" are split at script boundary: "React" passes through, "컴포넌트" goes through mecab

Install guide message when mecab is not found:
```
⚠ mecab not found — Korean search quality will be limited.
  Install for better results:
    macOS:  brew install mecab mecab-ko-dic
    Ubuntu: sudo apt install mecab libmecab-dev && install-mecab-ko-dic
```

### 2. Indexing pipeline changes (`src/store.ts`)

Current flow: Three SQL triggers keep FTS5 in sync with `documents` table:
- `documents_ai` (AFTER INSERT): inserts into FTS5
- `documents_ad` (AFTER DELETE): deletes from FTS5
- `documents_au` (AFTER UPDATE): handles deactivation (delete) and reactivation (replace)

New flow:
- **Remove INSERT trigger** (`documents_ai`) — app-level insertion with preprocessed text
- **Keep DELETE trigger** (`documents_ad`) — no preprocessing needed, pure cleanup
- **Replace UPDATE trigger** (`documents_au`) — app-level handling for reactivation (needs preprocessed text), keep deactivation delete path as trigger or move to app level for consistency

Affected call sites that currently rely on triggers:
- `insertDocument()` (~line 2094): `INSERT ... ON CONFLICT DO UPDATE` — fires INSERT or UPDATE trigger. Must add explicit FTS5 insert/update with preprocessed text after this call.
- `reindexCollection()`: calls `insertDocument()` in a loop — covered by the above change.
- `deactivateDocument()`: sets `active = 0` — DELETE path, can keep as trigger.
- `updateDocumentTitle()`: updates title — must preprocess new title for FTS5.
- `src/cli/rebuild.ts`: calls `insertDocument()` — covered by the above change.

`content` table retains original text (unchanged). FTS5 `body` and `title` columns receive tokenized text. `filepath` column unchanged.

### 3. Search query preprocessing (`src/store.ts`)

- Apply `tokenizeKorean()` to raw query text **before** `buildFTS5Query()` in `searchFTS()`
- Since POS filtering removes particles, Korean query morphemes are content words → prefix matching with `*` is appropriate (e.g., "검색" → `"검색"*` matches "검색" in FTS5)
- Single preprocessing point at `searchFTS()` entry — all callers benefit automatically
- Lex syntax operators (quotes, negation, hyphens) are handled by `buildFTS5Query()` after preprocessing

### 4. Index state tracking

- Store `korean_tokenizer: "mecab"` or `korean_tokenizer: "none"` in the `meta` table
- On startup, compare current mecab availability against stored state
- `qmd status` shows tokenizer state and warns on mismatch:
  ```
  Korean tokenizer: mecab (index built with mecab)
  Korean tokenizer: none (index built without — run `hwicortex rebuild` after installing mecab)
  ```

### 5. Index migration

- No automatic migration
- Users run `hwicortex rebuild` to regenerate FTS5 with preprocessed text
- `qmd update` uses the same app-level FTS5 insertion path, so changed documents get preprocessed automatically

## What is NOT affected

- Vector search (embeddings use original text)
- `content` table (stores original text)
- `get`, `multi-get` document retrieval (reads from `content` table)
- Reranking (uses original text)
- Query expansion LLM (operates on original query)

## Testing

Unit tests for `tokenizeKorean()`:
- Pure Korean text: "검색했다" → "검색"
- Pure English text: "search query" → "search query" (unchanged)
- Mixed text: "React컴포넌트 검색" → "React컴포넌트 검색" (Korean parts tokenized)
- Empty input → empty output
- Text with no Korean content → unchanged

Unit tests for mecab process management:
- Fallback mode when mecab not installed (returns input unchanged)
- Persistent process reuse across multiple calls
- Graceful handling of mecab process crash mid-document

Integration tests:
- Index Korean document, search with stem "검색", verify "검색했다" document matches
- Index mixed Korean/English document, verify both Korean and English terms searchable
- Verify existing English-only search behavior unchanged (regression)
- Rebuild with mecab enabled, verify meta table records tokenizer state
- Search without mecab (fallback), verify still works with degraded quality

Edge cases:
- Documents with zero Korean content (should be unchanged in FTS5)
- Korean text inside code blocks (tokenized — no special handling, matches grep behavior)
- Very large documents (streaming mecab handles without buffer overflow)
- Single-character Korean queries
