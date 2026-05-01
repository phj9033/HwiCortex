import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { synthesize } from "../../../src/research/pipeline/synthesize.js";
import { writeCard } from "../../../src/research/store/cards.js";
import { synthesisPath } from "../../../src/research/store/synthesis.js";
import { parseTopic } from "../../../src/research/topic/schema.js";
import { mockLlm } from "../_helpers/anthropic-mock.js";
import type { Card } from "../../../src/research/core/types.js";

const cardA: Card = {
  source_id: "abcdef012345",
  topic_id: "t1",
  url: "https://x.com/a",
  title: "Survey",
  author: null,
  published: null,
  fetched: "2026-04-30",
  language: "en",
  tags: ["rag"],
  body_hash: "h1",
  tldr: ["RAG overview.", "Defines retrieval+gen.", "Surveys methods."],
  excerpts: ["RAG combines retrieval and generation."],
};

const cardB: Card = {
  source_id: "112233445566",
  topic_id: "t1",
  url: "https://x.com/b",
  title: "Hybrid",
  author: null,
  published: null,
  fetched: "2026-04-30",
  language: "en",
  tags: ["hybrid"],
  body_hash: "h2",
  tldr: ["BM25+dense.", "Better recall.", "Latency tradeoff."],
  excerpts: [],
};

let vault: string;
beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "v-"));
  mkdirSync(join(vault, "research", "notes", "t1", "sources"), { recursive: true });
  writeCard(vault, cardA);
  writeCard(vault, cardB);
});
afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

const topic = parseTopic({
  id: "t1",
  title: "Test topic",
  sources: [{ type: "seed-urls", urls: ["https://x.com/a"] }],
});
const cfg = { models: { synth: "claude-sonnet-4-6" } };

describe("synthesize", () => {
  it("plans clusters and writes overview + per-cluster notes", async () => {
    const llm = mockLlm([
      // planClusters
      JSON.stringify({
        clusters: [
          { subtopic: "intro", title: "Intro", source_ids: ["abcdef012345"] },
          { subtopic: "retrieval", title: "Retrieval", source_ids: ["112233445566"] },
        ],
      }),
      // writeSubtopicNote calls — overview, then intro, then retrieval
      "# Overview\n\nBody[^abcdef012345][^112233445566].",
      "# Intro\n\nBody[^abcdef012345].",
      "# Retrieval\n\nBody[^112233445566].",
    ]);

    const r = await synthesize({ topic, vault, config: cfg, _llmClient: llm });
    expect(r.notes_written).toHaveLength(3);
    expect(r.cost_usd).toBeGreaterThan(0);

    const overview = readFileSync(synthesisPath(vault, "t1", "overview"), "utf-8");
    expect(overview).toContain("# Overview");
    expect(overview).toMatch(/- "?abcdef012345"?/);
    expect(overview).toMatch(/- "?112233445566"?/);
  });

  it("with explicit subtopic, skips planClusters and writes one note", async () => {
    const llm = mockLlm(["# Single\n\nBody[^abcdef012345]."]);
    const r = await synthesize({
      topic,
      vault,
      config: cfg,
      subtopic: "single-shot",
      _llmClient: llm,
    });
    expect(r.notes_written).toHaveLength(1);
    expect(r.notes_written[0]).toContain("single-shot.md");
  });

  it("returns empty result when no cards exist", async () => {
    const empty = mkdtempSync(join(tmpdir(), "v-"));
    try {
      const r = await synthesize({
        topic,
        vault: empty,
        config: cfg,
        _llmClient: mockLlm([]),
      });
      expect(r.notes_written).toEqual([]);
      expect(r.cost_usd).toBe(0);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("skips existing subtopic files unless refresh is true", async () => {
    const llm1 = mockLlm([
      JSON.stringify({
        clusters: [{ subtopic: "intro", title: "Intro", source_ids: ["abcdef012345"] }],
      }),
      "# Overview\n\nbody",
      "# Intro\n\nbody",
    ]);
    const r1 = await synthesize({ topic, vault, config: cfg, _llmClient: llm1 });
    expect(r1.notes_written.length).toBe(2);

    // Second run with same vault but no refresh — both files exist, planner runs but writeSubtopicNote should be skipped
    const llm2 = mockLlm([
      JSON.stringify({
        clusters: [{ subtopic: "intro", title: "Intro", source_ids: ["abcdef012345"] }],
      }),
    ]);
    const r2 = await synthesize({ topic, vault, config: cfg, _llmClient: llm2 });
    expect(r2.notes_written).toEqual([]);
  });
});
