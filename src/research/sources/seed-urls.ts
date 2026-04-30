import type { Discovery, DiscoveryCtx, DiscoveryItem } from "./types.js";
import type { SourceSpec } from "../topic/schema.js";

export const seedUrls: Discovery = {
  async *discover(
    spec: SourceSpec,
    _ctx: DiscoveryCtx,
  ): AsyncIterable<DiscoveryItem> {
    if (spec.type !== "seed-urls") return;
    for (const url of spec.urls) {
      yield { url, source_meta: { adapter: "seed-urls" } };
    }
  },
};
