import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { PdfParser } from "../src/ingest/pdf-parser.js";

const FIXTURES = resolve(import.meta.dirname, "../tests/fixtures/pdfs");

describe("PdfParser", () => {
  const parser = new PdfParser();

  it("should extract text from simple PDF", async () => {
    const result = await parser.parse(resolve(FIXTURES, "simple.pdf"));
    expect(result.error).toBeUndefined();
    expect(result.content).toContain("Hello PDF World");
  });

  it("should return error for broken PDF", async () => {
    const result = await parser.parse(resolve(FIXTURES, "broken.pdf"));
    expect(result.error).toBeDefined();
    expect(result.content).toBe("");
    expect(result.frontmatter.pages).toBe(0);
  });

  it("should generate markdown with frontmatter", async () => {
    const result = await parser.parse(resolve(FIXTURES, "simple.pdf"));
    expect(result.markdown).toMatch(/^---\n/);
    expect(result.markdown).toContain("source_path:");
    expect(result.markdown).toContain("pages: 1");
    expect(result.markdown).toContain("parsed_at:");
    expect(result.markdown).toContain("Hello PDF World");
  });

  it("should record error to _errors.md format", async () => {
    const result = await parser.parse(resolve(FIXTURES, "broken.pdf"));
    expect(result.errorEntry).toBeDefined();
    expect(result.errorEntry).toContain("PDF parse error:");
    expect(result.errorEntry).toMatch(/^\|.*\|.*\|.*\|$/);
  });
});
