import Parser from "rss-parser";
import type { Discovery, DiscoveryItem, DiscoveryCtx } from "./types.js";
import type { SourceSpec } from "../topic/schema.js";

type RssItem = {
  link?: string;
  title?: string;
  isoDate?: string;
  contentSnippet?: string;
};

const parser = new Parser();

export function feedItemToDiscovery(item: RssItem, feed: string): DiscoveryItem | null {
  if (!item.link) return null;
  return {
    url: item.link,
    hint_title: item.title,
    source_meta: {
      adapter: "rss",
      feed,
      pubDate: item.isoDate ?? null,
      content_snippet: item.contentSnippet ?? null,
    },
  };
}

export const rssDiscovery: Discovery = {
  async *discover(spec: SourceSpec, _ctx: DiscoveryCtx): AsyncIterable<DiscoveryItem> {
    if (spec.type !== "rss") return;
    for (const feed of spec.feeds) {
      const f = await parser.parseURL(feed);
      for (const item of f.items) {
        const out = feedItemToDiscovery(item, feed);
        if (out) yield out;
      }
    }
  },
};
