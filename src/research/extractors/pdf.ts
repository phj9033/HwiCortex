import type { Extractor, ExtractedDoc } from "./types.js";
import type { FetchedDoc } from "../core/types.js";
import { parsePdfBuffer } from "../../ingest/pdf-parser.js";

export const pdfExtractor: Extractor = {
  async extract(doc: FetchedDoc): Promise<ExtractedDoc> {
    const text = await parsePdfBuffer(doc.body_bytes);
    return {
      title: null,
      author: null,
      published_at: null,
      body_md: text.trim(),
      language: null,
    };
  },
};
