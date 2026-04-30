import { describe, it, expect } from "vitest";
import { TopicSpec, parseTopic } from "../../../src/research/topic/schema.js";

describe("TopicSpec", () => {
  it("accepts a minimal valid topic", () => {
    const ok = parseTopic({
      id: "rag-eval",
      title: "RAG eval",
      sources: [{ type: "seed-urls", urls: ["https://example.com"] }],
    });
    expect(ok.id).toBe("rag-eval");
  });

  it("rejects invalid id slug", () => {
    expect(() => parseTopic({ id: "RAG Eval!", title: "", sources: [] }))
      .toThrow(/id/);
  });

  it("discriminates source types", () => {
    const t = parseTopic({
      id: "x", title: "x",
      sources: [
        { type: "web-search", queries: ["foo"] },
        { type: "arxiv", queries: ["bar"], categories: ["cs.CL"] },
        { type: "rss", feeds: ["https://e.com/rss"] },
        { type: "from-document", path: "./b.md", mode: "seeds-only" },
      ],
    });
    expect(t.sources).toHaveLength(4);
  });

  it("supplies budget defaults", () => {
    const t = parseTopic({ id: "x", title: "x", sources: [] });
    expect(t.budget.max_new_urls).toBe(100);
    expect(t.budget.max_total_bytes).toBe(50_000_000);
    expect(t.budget.max_llm_cost_usd).toBe(0.5);
  });
});
