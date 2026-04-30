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
