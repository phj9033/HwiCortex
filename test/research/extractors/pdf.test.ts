import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { pdfExtractor } from "../../../src/research/extractors/pdf.js";
import type { FetchedDoc } from "../../../src/research/core/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SIMPLE = readFileSync(join(__dirname, "../fixtures/pdf/simple.pdf"));

describe("pdfExtractor", () => {
  it("extracts text from a simple PDF buffer", async () => {
    const doc: FetchedDoc = {
      url: "https://x.com/a.pdf",
      canonical_url: "https://x.com/a.pdf",
      status: 200,
      fetched_at: "2026-04-30T00:00:00Z",
      content_type: "pdf",
      body_bytes: SIMPLE,
      cache_blob: null,
    };
    const ex = await pdfExtractor.extract(doc);
    expect(ex.body_md.length).toBeGreaterThan(0);
    expect(ex.title).toBeNull();
    expect(ex.author).toBeNull();
  });
});
