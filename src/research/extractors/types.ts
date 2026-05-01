import type { FetchedDoc } from "../core/types.js";

export type ExtractedDoc = {
  title: string | null;
  author: string | null;
  published_at: string | null;
  body_md: string;
  language: string | null;
};

export interface Extractor {
  extract(doc: FetchedDoc): Promise<ExtractedDoc>;
}
