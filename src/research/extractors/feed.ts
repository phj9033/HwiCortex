import type { Extractor, ExtractedDoc } from "./types.js";
import type { FetchedDoc } from "../core/types.js";

// RSS items typically don't carry full article bodies. The pipeline routes
// content_type "html" to the HTML extractor; this placeholder exists for
// content_type "feed-item" if a future source produces a body inline.
export const feedExtractor: Extractor = {
  async extract(doc: FetchedDoc): Promise<ExtractedDoc> {
    return {
      title: null,
      author: null,
      published_at: null,
      body_md: doc.body_bytes.toString("utf-8"),
      language: null,
    };
  },
};
