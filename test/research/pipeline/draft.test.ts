import { describe, it, expect } from "vitest";
import {
  searchTopic,
  defaultDraftDbPath,
  extractSourceId,
  slugFromPrompt,
} from "../../../src/research/pipeline/draft.js";
import { parseTopic } from "../../../src/research/topic/schema.js";
import type { QMDStore } from "../../../src/index.js";

const topic = parseTopic({ id: "t1", title: "Test" });

function fakeStore(hits: any[]): QMDStore {
  return {
    async search() {
      return hits;
    },
    async close() {},
  } as any;
}

describe("searchTopic", () => {
  it("returns hits + a source-id-keyed context array", async () => {
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

    const r = await searchTopic({
      topic,
      vault: "/tmp/vault",
      query: "Explain RAG",
      _store: store,
    });

    expect(r.hits).toHaveLength(1);
    expect(r.context).toEqual([
      {
        source_id: "abcdef012345",
        title: "RAG Survey",
        snippet: "RAG combines retrieval and generation.",
        path: "research/notes/t1/sources/abcdef012345.md",
      },
    ]);
  });

  it("filters out hits whose path does not encode a 12-hex source_id", async () => {
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

    const r = await searchTopic({
      topic,
      vault: "/tmp/vault",
      query: "Q",
      _store: store,
    });
    expect(r.context).toEqual([]);
    expect(r.hits).toHaveLength(1);
  });

  it("falls back to body slice when bestChunk is empty", async () => {
    const store = fakeStore([
      {
        file: "qmd://research-t1/research/notes/t1/sources/abcdef012345.md",
        displayPath: "research/notes/t1/sources/abcdef012345.md",
        title: "T",
        body: "x".repeat(2000),
        bestChunk: "",
        bestChunkPos: 0,
        score: 0.5,
        context: null,
        docid: "abcdef",
      },
    ]);
    const r = await searchTopic({
      topic,
      vault: "/tmp/vault",
      query: "Q",
      _store: store,
    });
    expect(r.context[0].snippet.length).toBe(800);
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
