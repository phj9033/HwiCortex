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
import { arxivDiscovery } from "../sources/arxiv.js";
import { rssDiscovery } from "../sources/rss.js";
import {
  BraveProvider,
  TavilyProvider,
  makeWebSearchDiscovery,
} from "../sources/web-search.js";
import { fromDocument } from "../sources/from-document.js";
import type { Discovery } from "../sources/types.js";
import type { TopicSpec, SourceSpec } from "../topic/schema.js";
import { createAnthropicClient, type LlmClient } from "../llm/client.js";
import { buildCard, substringMatchesNormalized } from "../llm/card.js";
import { extractCardsFromDocument } from "../llm/from-document-extract.js";
import { writeCard, cardPath, readCardFrontmatter } from "../store/cards.js";
import type { RawRecord } from "../core/types.js";
import { readFileSync } from "fs";
import { isAbsolute, join as joinPath } from "path";

export type ResearchConfig = {
  fetch: {
    user_agent: string;
    rate_limit_per_domain_qps: number;
    timeout_ms: number;
    max_redirects: number;
  };
  budget: {
    max_new_urls: number;
    max_total_bytes: number;
    max_llm_cost_usd: number;
  };
  search?: {
    provider: "brave" | "tavily" | "none";
    brave?: { api_key?: string };
    tavily?: { api_key?: string };
  };
  models: { card: string; synth: string; draft: string };
};

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

export type FetchResult = {
  discovered: number;
  fetched: number;
  skipped: number;
  errored: number;
  records_added: number;
  budget: ReturnType<Budget["report"]>;
};

function makeRegistry(
  config: ResearchConfig,
): Partial<Record<SourceSpec["type"], Discovery>> {
  const reg: Partial<Record<SourceSpec["type"], Discovery>> = {
    "seed-urls": seedUrls,
    "arxiv": arxivDiscovery,
    "rss": rssDiscovery,
    "from-document": fromDocument,
  };
  if (config.search?.provider === "brave" && config.search.brave?.api_key) {
    reg["web-search"] = makeWebSearchDiscovery(
      new BraveProvider(config.search.brave.api_key),
    );
  } else if (config.search?.provider === "tavily" && config.search.tavily?.api_key) {
    reg["web-search"] = makeWebSearchDiscovery(
      new TavilyProvider(config.search.tavily.api_key),
    );
  }
  return reg;
}

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

  let discovered = 0;
  let fetched = 0;
  let skipped = 0;
  let errored = 0;
  let recordsAdded = 0;

  const summary = (): FetchResult => ({
    discovered,
    fetched,
    skipped,
    errored,
    records_added: recordsAdded,
    budget: budget.report(),
  });

  const registry = makeRegistry(config);

  for (const spec of topic.sources) {
    if (opts.source && spec.type !== opts.source) continue;

    if (spec.type === "from-document" && spec.mode === "use-as-cards") {
      const docPath = isAbsolute(spec.path) ? spec.path : joinPath(vault, spec.path);
      const docText = readFileSync(docPath, "utf-8");
      const llm = opts._llmClient ?? createAnthropicClient();
      const out = await extractCardsFromDocument(llm, docText, topic.cards.model);
      if (out.cost_usd > 0 && !budget.tryAddCost(topic.cards.model, out.cost_usd)) {
        log.emit({ kind: "budget_halt", reason: "max_llm_cost_usd" });
        return summary();
      }
      if (!out.items.length && out.reason) {
        log.emit({ kind: "card_skip", source_id: spec.path, reason: out.reason });
      }
      for (const item of out.items) {
        discovered += 1;
        const cu = canonicalize(item.url);
        if (staging.has({ canonical_url: cu })) {
          skipped += 1;
          continue;
        }
        if (!budget.tryAddUrl()) {
          log.emit({ kind: "budget_halt", reason: "max_new_urls" });
          return summary();
        }
        const sid = sourceIdFor(cu);
        const synth: RawRecord = {
          id: sid,
          topic_id: topic.id,
          source_type: "from-document",
          url: item.url,
          canonical_url: cu,
          title: item.title ?? null,
          author: null,
          published_at: null,
          fetched_at: new Date().toISOString(),
          content_type: "html",
          language: null,
          body_md: item.summary,
          word_count: item.summary.split(/\s+/).filter(Boolean).length,
          body_hash: bodyHash(item.summary),
          source_meta: { adapter: "from-document", document: spec.path, mode: "use-as-cards" },
          cache_blob: null,
        };
        staging.append(synth);
        recordsAdded += 1;
        const verifiedExcerpts = (item.excerpts ?? []).filter(q =>
          substringMatchesNormalized(q, docText),
        );
        writeCard(vault, {
          source_id: sid,
          topic_id: topic.id,
          url: item.url,
          title: item.title ?? "(untitled)",
          author: null,
          published: null,
          fetched: synth.fetched_at,
          language: null,
          tags: [],
          body_hash: synth.body_hash,
          tldr: [item.summary.slice(0, 200)],
          excerpts: verifiedExcerpts,
        });
        log.emit({ kind: "card_ok", source_id: sid });
      }
      continue;
    }

    const adapter = registry[spec.type];
    if (!adapter) {
      log.emit({ kind: "fetch_skip", url: spec.type, reason: "no_adapter" });
      continue;
    }

    for await (const item of adapter.discover(spec, { topic_id: topic.id, vault })) {
      discovered += 1;
      const cu = canonicalize(item.url);

      if (staging.has({ canonical_url: cu })) {
        skipped += 1;
        continue;
      }
      if (!budget.tryAddUrl()) {
        log.emit({ kind: "budget_halt", reason: "max_new_urls" });
        return summary();
      }
      if (opts.dryRun) {
        fetched += 1;
        continue;
      }

      try {
        const doc = await fetchUrl(item.url, fetcherCfg);
        if (!budget.tryAddBytes(doc.body_bytes.byteLength)) {
          log.emit({ kind: "budget_halt", reason: "max_total_bytes" });
          return summary();
        }
        if (doc.content_type !== "html") {
          skipped += 1;
          continue;
        }
        const ex = await htmlExtractor.extract(doc);
        if (!ex.body_md) {
          skipped += 1;
          log.emit({ kind: "fetch_skip", url: cu, reason: "empty_body" });
          continue;
        }
        const q = evaluateQuality(
          { body_md: ex.body_md, canonical_url: cu, language: ex.language },
          topic.filters,
        );
        if (!q.accept) {
          skipped += 1;
          log.emit({ kind: "fetch_skip", url: cu, reason: q.reason ?? "quality" });
          continue;
        }
        const hash = bodyHash(ex.body_md);
        if (staging.has({ canonical_url: cu, body_hash: hash })) {
          skipped += 1;
          continue;
        }
        const rec: RawRecord = {
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
        };
        staging.append(rec);
        recordsAdded += 1;
        fetched += 1;
        log.emit({ kind: "fetch_ok", url: cu, bytes: doc.body_bytes.byteLength });

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
      } catch (e: unknown) {
        errored += 1;
        const code = e instanceof FetchError ? e.code : "UNKNOWN";
        const detail = e instanceof Error ? e.message : String(e);
        log.emit({ kind: "fetch_error", url: cu, code, detail });
      }
    }
  }

  return summary();
}
