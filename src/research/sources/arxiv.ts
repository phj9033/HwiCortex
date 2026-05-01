import type { Discovery, DiscoveryItem, DiscoveryCtx } from "./types.js";
import type { SourceSpec } from "../topic/schema.js";

const API = "https://export.arxiv.org/api/query";

export const arxivDiscovery: Discovery = {
  async *discover(spec: SourceSpec, _ctx: DiscoveryCtx): AsyncIterable<DiscoveryItem> {
    if (spec.type !== "arxiv") return;
    for (const q of spec.queries) {
      const cats = spec.categories.length
        ? ` AND (${spec.categories.map(c => "cat:" + c).join(" OR ")})`
        : "";
      const search = encodeURIComponent(`all:"${q}"${cats}`);
      const url = `${API}?search_query=${search}&start=0&max_results=${spec.top_k}`;
      const res = await fetch(url);
      const xml = await res.text();
      for (const item of parseAtom(xml)) yield item;
    }
  },
};

function parseAtom(xml: string): DiscoveryItem[] {
  const out: DiscoveryItem[] = [];
  const entries = xml.split("<entry>").slice(1);
  for (const e of entries) {
    const link = match(e, /<id>([^<]+)<\/id>/);
    const title = match(e, /<title>([\s\S]*?)<\/title>/)?.replace(/\s+/g, " ").trim();
    if (!link) continue;
    const arxivId = link.split("/").pop() ?? "";
    const pdf = link.replace("/abs/", "/pdf/") + ".pdf";
    out.push({
      url: link,
      hint_title: title ?? undefined,
      source_meta: { adapter: "arxiv", arxiv_id: arxivId, pdf_url: pdf },
    });
  }
  return out;
}

function match(s: string, re: RegExp): string | null {
  const m = s.match(re);
  return m && m[1] !== undefined ? m[1] : null;
}
