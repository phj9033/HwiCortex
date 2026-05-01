import { describe, it, expect } from "vitest";
import { planClusters, writeSubtopicNote } from "../../../src/research/llm/synthesize.js";
import { mockLlm } from "../_helpers/anthropic-mock.js";
import type { Card } from "../../../src/research/core/types.js";

const cards: Card[] = [
  {
    source_id: "abcdef012345",
    topic_id: "t",
    url: "https://x.com/a",
    title: "Survey of RAG",
    author: null,
    published: null,
    fetched: "2026-04-30",
    language: "en",
    tags: ["rag"],
    body_hash: "h1",
    tldr: ["Surveys RAG.", "Defines retrieval+generation.", "Lists challenges."],
    excerpts: ["RAG combines retrieval and generation."],
  },
  {
    source_id: "112233445566",
    topic_id: "t",
    url: "https://x.com/b",
    title: "Hybrid search",
    author: null,
    published: null,
    fetched: "2026-04-30",
    language: "en",
    tags: ["hybrid"],
    body_hash: "h2",
    tldr: ["BM25+dense.", "Better recall.", "Latency tradeoff."],
    excerpts: [],
  },
];

describe("planClusters", () => {
  it("parses a valid cluster plan JSON", async () => {
    const llm = mockLlm([
      JSON.stringify({
        clusters: [
          { subtopic: "intro", title: "Intro", source_ids: ["abcdef012345"] },
          { subtopic: "retrieval", title: "Retrieval", source_ids: ["112233445566"] },
        ],
      }),
    ]);
    const r = await planClusters(llm, cards, "claude-sonnet-4-6");
    expect(r.plan.clusters).toHaveLength(2);
    expect(r.plan.clusters[0].subtopic).toBe("intro");
    expect(r.cost_usd).toBeGreaterThan(0);
    expect(r.reason).toBeUndefined();
  });

  it("extracts the JSON object even when wrapped in chatter", async () => {
    const llm = mockLlm([
      'Here you go!\n{"clusters":[{"subtopic":"only-one","title":"X","source_ids":["abcdef012345"]}]}\nDone.',
    ]);
    const r = await planClusters(llm, cards, "claude-sonnet-4-6");
    expect(r.reason).toBeUndefined();
    expect(r.plan.clusters[0].subtopic).toBe("only-one");
  });

  it("returns schema_error when subtopic slug is invalid", async () => {
    const llm = mockLlm([
      JSON.stringify({
        clusters: [{ subtopic: "Has Spaces", title: "X", source_ids: ["abcdef012345"] }],
      }),
    ]);
    const r = await planClusters(llm, cards, "claude-sonnet-4-6");
    expect(r.reason).toBe("schema_error");
  });

  it("returns llm_error when the client throws", async () => {
    const llm = {
      async call() {
        throw new Error("boom");
      },
    };
    const r = await planClusters(llm, cards, "claude-sonnet-4-6");
    expect(r.reason).toMatch(/^llm_error:/);
    expect(r.cost_usd).toBe(0);
  });
});

describe("writeSubtopicNote", () => {
  it("extracts unique 12-hex footnote source_ids", async () => {
    const md = `# Intro

This is good[^abcdef012345]. Hybrid is also nice[^112233445566][^abcdef012345].

[^abcdef012345]: <https://x.com/a>
[^112233445566]: <https://x.com/b>
`;
    const llm = mockLlm([md]);
    const r = await writeSubtopicNote(llm, "Intro", cards, "claude-sonnet-4-6");
    expect(r.cited.sort()).toEqual(["112233445566", "abcdef012345"]);
    expect(r.body_md).toContain("# Intro");
  });

  it("returns empty cited when no footnotes are present", async () => {
    const llm = mockLlm(["plain markdown no citations"]);
    const r = await writeSubtopicNote(llm, "Plain", cards, "claude-sonnet-4-6");
    expect(r.cited).toEqual([]);
  });

  it("returns llm_error when the client throws", async () => {
    const llm = {
      async call() {
        throw new Error("nope");
      },
    };
    const r = await writeSubtopicNote(llm, "X", cards, "claude-sonnet-4-6");
    expect(r.reason).toMatch(/^llm_error:/);
    expect(r.body_md).toBe("");
  });
});
