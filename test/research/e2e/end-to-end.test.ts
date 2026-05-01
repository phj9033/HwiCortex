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
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fetchTopic } from "../../../src/research/pipeline/fetch.js";
import { searchTopic } from "../../../src/research/pipeline/draft.js";
import { computeStatus } from "../../../src/research/pipeline/status.js";
import { writeCard } from "../../../src/research/store/cards.js";
import { writeSynthesis } from "../../../src/research/store/synthesis.js";
import { writeDraftFile } from "../../../src/research/store/drafts.js";
import { parseTopic } from "../../../src/research/topic/schema.js";
import { _resetRobotsCacheForTests } from "../../../src/research/core/robots.js";
import type { QMDStore } from "../../../src/index.js";

// Hermetic E2E: walks through the full agent-driven shape without any
// real LLM call. hwicortex covers fetch + search + status + file IO; the
// "agent" steps (cards / synthesis / draft) are simulated by the test
// directly calling the SDK writers with hand-built content.

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
  budget: { max_new_urls: 10, max_total_bytes: 10_000_000 },
};

describe("end-to-end pipeline (agent-driven)", () => {
  it("fetch → (agent writes cards/synth/draft via SDK writers) → search → status reflects everything", async () => {
    const topic = parseTopic({
      id: "e2e",
      title: "End-to-end smoke",
      sources: [
        { type: "seed-urls", urls: ["https://e2e.example/a", "https://e2e.example/b"] },
      ],
    });

    const fr = await fetchTopic({ topic, vault, config: cfg });
    expect(fr.records_added).toBe(2);

    const raw = readFileSync(
      join(vault, "research", "_staging", "e2e", "raw.jsonl"),
      "utf-8",
    );
    const records = raw.split("\n").filter(Boolean).map(line => JSON.parse(line));
    expect(records).toHaveLength(2);

    for (const rec of records) {
      const excerpt = rec.body_md.includes("RAG combines retrieval and generation.")
        ? "RAG combines retrieval and generation."
        : "BM25 plus dense vector retrieval improves recall.";
      writeCard(vault, {
        source_id: rec.id,
        topic_id: rec.topic_id,
        url: rec.canonical_url,
        title: rec.title ?? "(untitled)",
        author: rec.author,
        published: rec.published_at,
        fetched: rec.fetched_at,
        language: rec.language,
        tags: ["rag"],
        body_hash: rec.body_hash,
        tldr: ["Overview.", "Approach.", "Result."],
        excerpts: [excerpt],
      });
    }

    writeSynthesis(vault, {
      topic_id: "e2e",
      subtopic: "overview",
      generated_at: new Date().toISOString(),
      model: "test-agent",
      source_cards: records.map(r => r.id),
      body_md: `# Overview\n\nRAG[^${records[0].id}]. Hybrid[^${records[1].id}].`,
    });

    const fakeStore = {
      async search() {
        return records.map((rec: any, i: number) => ({
          file: `qmd://research-e2e/research/notes/e2e/sources/${rec.id}.md`,
          displayPath: `research/notes/e2e/sources/${rec.id}.md`,
          title: rec.title,
          body: "body",
          bestChunk: i === 0
            ? "RAG combines retrieval and generation."
            : "BM25 plus dense.",
          bestChunkPos: 0,
          score: 0.9 - i * 0.1,
          context: null,
          docid: rec.id.slice(0, 6),
        }));
      },
      async close() {},
    } as unknown as QMDStore;

    const { context } = await searchTopic({
      topic,
      vault,
      query: "Brief survey of RAG today",
      _store: fakeStore,
    });
    expect(context).toHaveLength(2);
    expect(context.map(c => c.source_id).sort()).toEqual(records.map(r => r.id).sort());

    const path = writeDraftFile(vault, {
      topic_id: "e2e",
      slug: "rag-today",
      prompt: "Brief survey of RAG today",
      generated_at: new Date().toISOString(),
      model: "test-agent",
      context_sources: context.map(c => c.path),
      include_vault: false,
      body_md: `# RAG Today\n\nRAG[^${records[0].id}]. Hybrid[^${records[1].id}].`,
    });

    const status = computeStatus(vault, "e2e");
    expect(status.raw_records).toBe(2);
    expect(status.cards).toBe(2);
    expect(status.synthesis_notes).toBe(1);
    expect(status.drafts).toBe(1);
    const events = status.recent_events.map(e => (e as any).kind);
    expect(events).toContain("fetch_ok");

    const draftTxt = readFileSync(path, "utf-8");
    expect(draftTxt).toContain("type: research-draft");
    expect(draftTxt).toContain("# RAG Today");
  });
});
