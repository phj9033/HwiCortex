import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import type { Extractor, ExtractedDoc } from "./types.js";
import type { FetchedDoc } from "../core/types.js";

const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

export const htmlExtractor: Extractor = {
  async extract(doc: FetchedDoc): Promise<ExtractedDoc> {
    const html = doc.body_bytes.toString("utf-8");
    const dom = new JSDOM(html, { url: doc.canonical_url });
    const article = new Readability(dom.window.document).parse();
    if (!article) return empty();
    const md = td.turndown(article.content || "").trim();
    return {
      title: article.title || null,
      author: article.byline || null,
      published_at: extractPublishedAt(dom.window.document),
      body_md: md,
      language: detectLang(md),
    };
  },
};

function empty(): ExtractedDoc {
  return { title: null, author: null, published_at: null, body_md: "", language: null };
}

function extractPublishedAt(d: Document): string | null {
  const m =
    d.querySelector('meta[property="article:published_time"]')?.getAttribute("content") ??
    d.querySelector('meta[name="date"]')?.getAttribute("content");
  return m || null;
}

function detectLang(text: string): string | null {
  const sample = text.slice(0, 1000);
  const cjk = (sample.match(/[　-鿿가-힯]/g) ?? []).length;
  const latin = (sample.match(/[A-Za-z]/g) ?? []).length;
  if (cjk > latin * 2) return "ko";
  if (latin > 5 && cjk === 0) return "en";
  if (cjk > 0) return "ko";
  return null;
}
