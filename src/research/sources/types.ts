import type { SourceSpec } from "../topic/schema.js";

export type DiscoveryItem = {
  url: string;
  hint_title?: string;
  source_meta?: Record<string, unknown>;
};

export type DiscoveryCtx = {
  topic_id: string;
  vault: string;
};

export interface Discovery {
  discover(spec: SourceSpec, ctx: DiscoveryCtx): AsyncIterable<DiscoveryItem>;
}
