import { z } from "zod";

const ID_RE = /^[a-z0-9-]+$/;

const SourceWebSearch = z.object({
  type: z.literal("web-search"),
  queries: z.array(z.string().min(1)).min(1),
  site_filters: z.array(z.string()).default([]),
  since: z.string().optional(), // ISO date
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
  SourceWebSearch,
  SourceArxiv,
  SourceRss,
  SourceSeedUrls,
  SourceFromDocument,
]);

// NOTE: zod 4 changed `.default(value)` semantics for object schemas — it now
// returns the literal default value without re-parsing, so inner-field defaults
// would not fire when the parent key is missing. Use `.prefault({})` (zod 4's
// successor to zod 3's `.default()` behavior) so an absent parent key gets
// substituted with `{}`, which is then parsed and triggers inner defaults.
const Filters = z
  .object({
    min_words: z.number().int().min(0).default(200),
    max_words: z.number().int().min(0).default(50_000),
    exclude_domains: z.array(z.string()).default([]),
    require_lang: z.string().nullable().default(null),
  })
  .prefault({});

const Budget = z
  .object({
    max_new_urls: z.number().int().min(1).default(100),
    max_total_bytes: z.number().int().min(1).default(50_000_000),
    max_llm_cost_usd: z.number().min(0).default(0.5),
  })
  .prefault({});

const Cards = z
  .object({
    enabled: z.boolean().default(true),
    model: z.string().default("claude-haiku-4-5"),
  })
  .prefault({});

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
