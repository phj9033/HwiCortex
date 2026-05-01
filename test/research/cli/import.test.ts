import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fetchTopic } from "../../../src/research/pipeline/fetch.js";
import { parseTopic } from "../../../src/research/topic/schema.js";
import { _resetRobotsCacheForTests } from "../../../src/research/core/robots.js";

// The CLI's runImport is a thin wrapper around fetchTopic with an injected
// from-document source. We verify the underlying behavior here — that an
// in-memory augmented topic with a from-document source actually drives
// the fetch pipeline end-to-end. This keeps the test stable without
// touching process.argv.

const longBody = "lorem ipsum ".repeat(100);
const HTML = `<html><head><title>T</title></head><body><article><h1>Title</h1><p>${longBody}</p></article></body></html>`;

const server = setupServer(
  http.get("https://i.com/robots.txt", () => HttpResponse.text("User-agent: *\nAllow: /\n")),
  http.get("https://i.com/a", () => HttpResponse.html(HTML)),
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

describe("import (in-memory from-document source)", () => {
  it("extracts URLs from a doc and runs the fetch pipeline", async () => {
    const docPath = join(vault, "doc.md");
    writeFileSync(docPath, "Read https://i.com/a for context.");
    const topic = parseTopic({
      id: "imp",
      title: "Imported topic",
      sources: [
        { type: "from-document", path: docPath },
      ],
    });
    const r = await fetchTopic({
      topic,
      vault,
      config: cfg,
      source: "from-document",
    });
    expect(r.records_added).toBe(1);
    const raw = readFileSync(
      join(vault, "research", "_staging", "imp", "raw.jsonl"),
      "utf-8",
    );
    expect(raw).toContain('"canonical_url":"https://i.com/a"');
  });
});
