import { describe, it, expect } from "vitest";
import { buildCard, substringMatchesNormalized } from "../../../src/research/llm/card.js";
import { mockLlm } from "../_helpers/anthropic-mock.js";

const rec = {
  id: "abc",
  topic_id: "t",
  source_type: "seed-urls" as const,
  url: "https://x.com/a",
  canonical_url: "https://x.com/a",
  title: "Hello",
  author: null,
  published_at: null,
  fetched_at: "2026-04-30",
  content_type: "html" as const,
  language: "en",
  body_md: "Hello world.  This is a body. RAG is great.",
  word_count: 8,
  body_hash: "h",
  source_meta: {},
  cache_blob: null,
};

describe("buildCard", () => {
  it("validates and keeps only verbatim excerpts", async () => {
    const llm = mockLlm([
      JSON.stringify({
        tldr: ["alpha bullet", "beta bullet", "gamma bullet"],
        excerpts: ["This is a body.", "this never appeared"],
        tags: ["rag"],
      }),
    ]);
    const r = await buildCard(llm, rec, "claude-haiku-4-5");
    expect(r.card?.excerpts).toEqual(["This is a body."]);
    expect(r.card?.tldr.length).toBeGreaterThanOrEqual(3);
    expect(r.card?.body_hash).toBe("h");
  });

  it("returns null on malformed JSON", async () => {
    const llm = mockLlm(["not json"]);
    const r = await buildCard(llm, rec, "claude-haiku-4-5");
    expect(r.card).toBeNull();
    expect(r.reason).toBe("schema_error");
  });

  it("returns null on llm error", async () => {
    const llm = {
      async call() {
        throw new Error("boom");
      },
    };
    const r = await buildCard(llm, rec, "claude-haiku-4-5");
    expect(r.card).toBeNull();
    expect(r.reason).toMatch(/^llm_error:/);
    expect(r.cost_usd).toBe(0);
  });
});

describe("substringMatchesNormalized", () => {
  it("ignores whitespace differences", () => {
    expect(substringMatchesNormalized("hello world", "hello   world\n")).toBe(true);
  });

  it("returns false for genuine non-matches", () => {
    expect(substringMatchesNormalized("missing phrase", "hello world")).toBe(false);
  });
});
