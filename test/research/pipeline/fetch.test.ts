import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { mkdtempSync, readFileSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fetchTopic } from "../../../src/research/pipeline/fetch.js";
import { parseTopic } from "../../../src/research/topic/schema.js";
import { _resetRobotsCacheForTests } from "../../../src/research/core/robots.js";

const longBody = "lorem ipsum ".repeat(100);
const HTML = `<html><head><title>T</title></head><body><article><h1>Title</h1><p>${longBody}</p></article></body></html>`;

const server = setupServer(
  http.get("https://e.com/robots.txt", () =>
    HttpResponse.text("User-agent: *\nAllow: /\n"),
  ),
  http.get("https://e.com/a", () => HttpResponse.html(HTML)),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

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
  },
};

let vault: string;
beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "v-"));
  mkdirSync(join(vault, "research"), { recursive: true });
  _resetRobotsCacheForTests();
});
afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

describe("fetchTopic", () => {
  it("fetches a seed URL and writes a RawRecord", async () => {
    const topic = parseTopic({
      id: "t1",
      title: "t1",
      sources: [{ type: "seed-urls", urls: ["https://e.com/a"] }],
    });
    const r = await fetchTopic({ topic, vault, config: cfg });
    expect(r.records_added).toBe(1);
    expect(r.fetched).toBe(1);
    const raw = readFileSync(
      join(vault, "research", "_staging", "t1", "raw.jsonl"),
      "utf-8",
    );
    expect(raw).toContain('"canonical_url":"https://e.com/a"');
  });

  it("skips already-staged URLs on a second run", async () => {
    const topic = parseTopic({
      id: "t1",
      title: "t1",
      sources: [{ type: "seed-urls", urls: ["https://e.com/a"] }],
    });
    await fetchTopic({ topic, vault, config: cfg });
    const r = await fetchTopic({ topic, vault, config: cfg });
    expect(r.records_added).toBe(0);
    expect(r.skipped).toBe(1);
  });

  it("dryRun discovers without writing", async () => {
    const topic = parseTopic({
      id: "t1",
      title: "t1",
      sources: [{ type: "seed-urls", urls: ["https://e.com/a"] }],
    });
    const r = await fetchTopic({ topic, vault, config: cfg, dryRun: true });
    expect(r.records_added).toBe(0);
    expect(r.fetched).toBe(1);
  });

  it("halts when max_new_urls reached (via opts.maxNew)", async () => {
    const topic = parseTopic({
      id: "t1",
      title: "t1",
      sources: [{ type: "seed-urls", urls: ["https://e.com/a"] }],
    });
    const r = await fetchTopic({ topic, vault, config: cfg, maxNew: 0 });
    expect(r.records_added).toBe(0);
    expect(r.fetched).toBe(0);
  });
});
