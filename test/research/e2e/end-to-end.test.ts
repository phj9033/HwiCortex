import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  readdirSync,
  existsSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fetchTopic } from "../../../src/research/pipeline/fetch.js";
import { synthesize } from "../../../src/research/pipeline/synthesize.js";
import { draft } from "../../../src/research/pipeline/draft.js";
import { computeStatus } from "../../../src/research/pipeline/status.js";
import { parseTopic } from "../../../src/research/topic/schema.js";
import { _resetRobotsCacheForTests } from "../../../src/research/core/robots.js";
import { mockLlm } from "../_helpers/anthropic-mock.js";
import { sourcesDir, notesDir } from "../../../src/research/topic/paths.js";
import type { QMDStore } from "../../../src/index.js";

// Two seed URLs, both serving an HTML article that passes the quality filter.
const longBody = "lorem ipsum dolor sit amet ".repeat(80);
const HTML_A = `<html><head><title>RAG Survey</title></head><body><article><h1>RAG Survey</h1><p>${longBody}</p><p>RAG combines retrieval and generation.</p></article></body></html>`;
const HTML_B = `<html><head><title>Hybrid Search</title></head><body><article><h1>Hybrid Search</h1><p>${longBody}</p><p>BM25 plus dense vector retrieval improves recall.</p></article></body></html>`;

const server = setupServer(
  http.get("https://e2e.example/robots.txt", () =>
    HttpResponse.text("User-agent: *\nAllow: /\n"),
  ),
  http.get("https://e2e.example/a", () => HttpResponse.html(HTML_A)),
  http.get("https://e2e.example/b", () => HttpResponse.html(HTML_B)),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

let vault: string;
beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "v-"));
  mkdirSync(join(vault, "research"), { recursive: true });
  _resetRobotsCacheForTests();
});
afterEach(() => rmSync(vault, { recursive: true, force: true }));

const cfg = {
  fetch: {
    user_agent: "test/0.1",
    rate_limit_per_domain_qps: 100,
    timeout_ms: 1000,
    max_redirects: 5,
  },
  budget: {
    max_new_urls: 10,
    max_total_bytes: 10_000_000,
    max_llm_cost_usd: 1,
  },
  models: {
    card: "claude-haiku-4-5",
    synth: "claude-sonnet-4-6",
    draft: "claude-sonnet-4-6",
  },
};

describe("end-to-end pipeline", () => {
  it("fetch → synthesize → draft writes all artefacts and run-log entries", async () => {
    const topic = parseTopic({
      id: "e2e",
      title: "End-to-end smoke",
      sources: [
        { type: "seed-urls", urls: ["https://e2e.example/a", "https://e2e.example/b"] },
      ],
    });

    // Phase 1: fetch (writes 2 raw records + 2 cards via mock Haiku)
    const cardLlm = mockLlm([
      JSON.stringify({
        tldr: ["RAG survey overview.", "Defines RAG.", "Lists challenges."],
        excerpts: ["RAG combines retrieval and generation."],
        tags: ["rag"],
      }),
      JSON.stringify({
        tldr: ["Hybrid search.", "BM25+dense.", "Recall up."],
        excerpts: ["BM25 plus dense vector retrieval improves recall."],
        tags: ["hybrid"],
      }),
    ]);
    const fr = await fetchTopic({ topic, vault, config: cfg, _llmClient: cardLlm });
    expect(fr.records_added).toBe(2);
    expect(readdirSync(sourcesDir(vault, "e2e")).filter(f => f.endsWith(".md")).length).toBe(2);

    // Phase 2: synthesize (writes overview + 1 cluster note via mock Sonnet)
    const synthLlm = mockLlm([
      // planClusters response
      JSON.stringify({
        clusters: [
          {
            subtopic: "retrieval",
            title: "Retrieval",
            source_ids: readdirSync(sourcesDir(vault, "e2e"))
              .filter(f => f.endsWith(".md"))
              .map(f => f.slice(0, -3)),
          },
        ],
      }),
      // overview note
      "# Overview\n\nRAG with retrieval[^" +
        readdirSync(sourcesDir(vault, "e2e")).filter(f => f.endsWith(".md"))[0].slice(0, -3) +
        "].",
      // retrieval note
      "# Retrieval\n\nBM25+dense[^" +
        readdirSync(sourcesDir(vault, "e2e")).filter(f => f.endsWith(".md"))[1].slice(0, -3) +
        "].",
    ]);
    const sr = await synthesize({
      topic,
      vault,
      config: { models: { synth: cfg.models.synth } },
      _llmClient: synthLlm,
    });
    expect(sr.notes_written.length).toBe(2);
    expect(existsSync(join(notesDir(vault, "e2e"), "overview.md"))).toBe(true);
    expect(existsSync(join(notesDir(vault, "e2e"), "retrieval.md"))).toBe(true);

    // Phase 3: draft (mock store + mock Sonnet)
    const sourceIds = readdirSync(sourcesDir(vault, "e2e"))
      .filter(f => f.endsWith(".md"))
      .map(f => f.slice(0, -3));
    const fakeStore = {
      async search() {
        return sourceIds.map((sid, i) => ({
          file: `qmd://research-e2e/research/notes/e2e/sources/${sid}.md`,
          displayPath: `research/notes/e2e/sources/${sid}.md`,
          title: i === 0 ? "RAG Survey" : "Hybrid Search",
          body: "body",
          bestChunk: i === 0 ? "RAG combines retrieval and generation." : "BM25 plus dense.",
          bestChunkPos: 0,
          score: 0.9 - i * 0.1,
          context: null,
          docid: sid.slice(0, 6),
        }));
      },
      async close() {},
    } as unknown as QMDStore;
    const draftLlm = mockLlm([
      `# RAG Today\n\nRAG combines retrieval and generation[^${sourceIds[0]}]. ` +
        `Hybrid search expands recall[^${sourceIds[1]}].\n\n[^${sourceIds[0]}]: ref\n[^${sourceIds[1]}]: ref`,
    ]);
    const dr = await draft({
      topic,
      vault,
      prompt: "Brief survey of RAG today",
      model: cfg.models.draft,
      _llmClient: draftLlm,
      _store: fakeStore,
    });
    expect(dr.cited.sort()).toEqual([...sourceIds].sort());
    expect(existsSync(dr.path)).toBe(true);
    const draftTxt = readFileSync(dr.path, "utf-8");
    expect(draftTxt).toContain("type: research-draft");
    expect(draftTxt).toContain("# RAG Today");

    // Status reflects the full pipeline run
    const status = computeStatus(vault, "e2e");
    expect(status.raw_records).toBe(2);
    expect(status.cards).toBe(2);
    expect(status.synthesis_notes).toBe(2);
    expect(status.drafts).toBe(1);
    // run-log has fetch_ok, card_ok, synth_ok events
    const events = status.recent_events.map(e => (e as any).kind);
    expect(events).toContain("fetch_ok");
    expect(events).toContain("card_ok");
    expect(events).toContain("synth_ok");
  });
});
