import { readFileSync } from "fs";
import { isAbsolute, join } from "path";
import type { Discovery, DiscoveryItem, DiscoveryCtx } from "./types.js";
import type { SourceSpec } from "../topic/schema.js";

const URL_RE = /https?:\/\/[^\s)>"'`]+/g;
const FENCE_RE = /```[\s\S]*?```/g;
const TRAILING_PUNCT = /[.,;:)\]"'`]+$/;

export const fromDocument: Discovery = {
  async *discover(spec: SourceSpec, ctx: DiscoveryCtx): AsyncIterable<DiscoveryItem> {
    if (spec.type !== "from-document") return;

    const path = isAbsolute(spec.path) ? spec.path : join(ctx.vault, spec.path);
    const txt = readFileSync(path, "utf-8");
    const cleaned = txt.replace(FENCE_RE, "");
    const seen = new Set<string>();
    for (const m of cleaned.matchAll(URL_RE)) {
      const url = m[0].replace(TRAILING_PUNCT, "");
      if (!seen.has(url)) {
        seen.add(url);
        yield { url, source_meta: { adapter: "from-document", document: spec.path } };
      }
    }
  },
};
