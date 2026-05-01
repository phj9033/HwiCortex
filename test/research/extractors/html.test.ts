import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { htmlExtractor } from "../../../src/research/extractors/html.js";
import type { FetchedDoc } from "../../../src/research/core/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fix = (n: string) => readFileSync(join(__dirname, "../fixtures/html/", n));

function fakeDoc(name: string, url: string): FetchedDoc {
  return {
    url,
    canonical_url: url,
    status: 200,
    fetched_at: new Date().toISOString(),
    content_type: "html",
    body_bytes: fix(name),
    cache_blob: null,
  };
}

describe("htmlExtractor", () => {
  it("produces non-trivial markdown for a blog post", async () => {
    const out = await htmlExtractor.extract(
      fakeDoc("sample-blog.html", "https://example.com/blog/post"),
    );
    expect(out.body_md.length).toBeGreaterThan(200);
    expect(out.title).toBeTruthy();
    expect(out.title?.toLowerCase()).toContain("local-first");
    expect(out.published_at).toBe("2025-12-01T00:00:00Z");
    expect(out.language).toBe("en");
  });

  it("extracts an arxiv-like abstract", async () => {
    const out = await htmlExtractor.extract(
      fakeDoc("sample-arxiv-abstract.html", "https://arxiv.org/abs/2512.01234"),
    );
    expect(out.body_md.length).toBeGreaterThan(200);
    expect(out.title?.toLowerCase()).toContain("rank fusion");
    expect(out.published_at).toBe("2025-12-15");
    expect(out.language).toBe("en");
  });
});
