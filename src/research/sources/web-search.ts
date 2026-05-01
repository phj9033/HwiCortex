import type { Discovery, DiscoveryItem, DiscoveryCtx } from "./types.js";
import type { SourceSpec } from "../topic/schema.js";

export interface SearchProvider {
  search(
    query: string,
    opts: { topK: number; siteFilters: string[]; since?: string },
  ): Promise<DiscoveryItem[]>;
}

export class BraveProvider implements SearchProvider {
  constructor(private apiKey: string) {}

  async search(
    query: string,
    opts: { topK: number; siteFilters: string[]; since?: string },
  ): Promise<DiscoveryItem[]> {
    const q = opts.siteFilters.length
      ? `${query} ` + opts.siteFilters.map(s => `site:${s}`).join(" OR ")
      : query;
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=${opts.topK}`;
    const r = await fetch(url, {
      headers: {
        "X-Subscription-Token": this.apiKey,
        accept: "application/json",
      },
    });
    if (!r.ok) {
      throw new Error(`brave_search_failed: ${r.status}`);
    }
    const j: any = await r.json();
    const results: any[] = j?.web?.results ?? [];
    return results.map(it => ({
      url: it.url,
      hint_title: it.title,
      source_meta: { adapter: "web-search", provider: "brave", query },
    }));
  }
}

export class TavilyProvider implements SearchProvider {
  constructor(private apiKey: string) {}

  async search(
    query: string,
    opts: { topK: number; siteFilters: string[]; since?: string },
  ): Promise<DiscoveryItem[]> {
    const r = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: this.apiKey,
        query,
        max_results: opts.topK,
        include_domains: opts.siteFilters,
      }),
    });
    if (!r.ok) {
      throw new Error(`tavily_search_failed: ${r.status}`);
    }
    const j: any = await r.json();
    const results: any[] = j?.results ?? [];
    return results.map(it => ({
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
