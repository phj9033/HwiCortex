import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  draft,
  defaultDraftDbPath,
  extractSourceId,
  slugFromPrompt,
} from "../../../src/research/pipeline/draft.js";
import { writeCard } from "../../../src/research/store/cards.js";
import { parseTopic } from "../../../src/research/topic/schema.js";
import { mockLlm } from "../_helpers/anthropic-mock.js";
import type { Card } from "../../../src/research/core/types.js";
import type { QMDStore } from "../../../src/index.js";

const cardA: Card = {
  source_id: "abcdef012345",
  topic_id: "t1",
  url: "https://x.com/a",
  title: "RAG Survey",
  author: null,
  published: null,
  fetched: "2026-04-30",
  language: "en",
  tags: ["rag"],
  body_hash: "h1",
  tldr: ["A.", "B.", "C."],
  excerpts: ["RAG combines retrieval and generation."],
};

let vault: string;
beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "v-"));
  mkdirSync(join(vault, "research", "notes", "t1", "sources"), { recursive: true });
  writeCard(vault, cardA);
});
afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

const topic = parseTopic({ id: "t1", title: "Test" });

function fakeStore(hits: any[]): QMDStore {
  return {
    async search() {
      return hits;
    },
    async close() {},
  } as any;
}

describe("draft pipeline", () => {
  it("uses RAG hits as context, runs LLM, writes a draft file", async () => {
    const store = fakeStore([
      {
        file: "qmd://research-t1/research/notes/t1/sources/abcdef012345.md",
        displayPath: "research/notes/t1/sources/abcdef012345.md",
        title: "RAG Survey",
        body: "RAG body content",
        bestChunk: "RAG combines retrieval and generation.",
        bestChunkPos: 0,
        score: 0.9,
        context: null,
        docid: "abcdef",
      },
    ]);
    const llm = mockLlm([
      "# RAG\n\nRAG combines retrieval and generation[^abcdef012345].\n\n[^abcdef012345]: ref",
    ]);

    const r = await draft({
      topic,
      vault,
      prompt: "Explain RAG",
      model: "claude-sonnet-4-6",
      _llmClient: llm,
      _store: store,
    });

    expect(r.path).toContain("research/drafts/t1/");
    expect(r.cited).toEqual(["abcdef012345"]);
    expect(r.cost_usd).toBeGreaterThan(0);
    const txt = readFileSync(r.path, "utf-8");
    expect(txt).toContain("type: research-draft");
    expect(txt).toContain("# RAG");
  });

  it("throws when requireContext is set and there are no hits", async () => {
    const store = fakeStore([]);
    const llm = mockLlm(["unused"]);
    await expect(
      draft({
        topic,
        vault,
        prompt: "What?",
        model: "claude-sonnet-4-6",
        requireContext: true,
        _llmClient: llm,
        _store: store,
      }),
    ).rejects.toThrow(/require_context/);
  });

  it("filters out hits whose path does not contain a 12-hex source_id", async () => {
    const store = fakeStore([
      {
        file: "qmd://research-t1/random/note.md",
        displayPath: "random/note.md",
        title: "Stray",
        body: "irrelevant",
        bestChunk: "irrelevant chunk",
        bestChunkPos: 0,
        score: 0.5,
        context: null,
        docid: "stray0",
      },
    ]);
    const captured: any[] = [];
    const llm = {
      async call(opts: any) {
        captured.push(opts);
        return {
          text: "no citations",
          usage: { input_tokens: 1, output_tokens: 1 },
          cost_usd: 0.001,
          model: opts.model,
        };
      },
    };
    const r = await draft({
      topic,
      vault,
      prompt: "Q",
      model: "claude-sonnet-4-6",
      _llmClient: llm,
      _store: store,
    });
    expect(r.cited).toEqual([]);
    // The user content should not include a "###" context block
    expect(captured[0].messages[0].content).not.toMatch(/###/);
  });
});

describe("helpers", () => {
  it("extractSourceId pulls 12-hex id from a sources path", () => {
    expect(
      extractSourceId("research/notes/t1/sources/abcdef012345.md"),
    ).toBe("abcdef012345");
    expect(extractSourceId("not-a-card.md")).toBeNull();
  });

  it("slugFromPrompt produces a hyphenated lowercase slug", () => {
    expect(slugFromPrompt("Explain RAG to me!")).toBe("explain-rag-to-me");
    expect(slugFromPrompt("")).toBe("draft");
  });

  it("defaultDraftDbPath builds <vault>/research/_staging/<topic>/draft-rag.sqlite", () => {
    expect(defaultDraftDbPath("/v", "t1")).toBe("/v/research/_staging/t1/draft-rag.sqlite");
  });
});
