import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { arxivDiscovery } from "../../../src/research/sources/arxiv.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const xml = readFileSync(join(__dirname, "../fixtures/arxiv/cs-cl.xml"), "utf-8");

const server = setupServer(
  http.get("https://export.arxiv.org/api/query", () => HttpResponse.text(xml)),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

describe("arxivDiscovery", () => {
  it("yields entries from atom XML with arxiv-id and pdf_url metadata", async () => {
    const items: any[] = [];
    for await (const it of arxivDiscovery.discover(
      { type: "arxiv", queries: ["RAG"], categories: ["cs.CL"], top_k: 5 } as any,
      { topic_id: "t", vault: "/tmp" },
    )) items.push(it);

    expect(items.length).toBe(3);
    expect(items[0].url).toBe("http://arxiv.org/abs/2401.12345v1");
    expect(items[0].source_meta.adapter).toBe("arxiv");
    expect(items[0].source_meta.arxiv_id).toBe("2401.12345v1");
    expect(items[0].source_meta.pdf_url).toBe("http://arxiv.org/pdf/2401.12345v1.pdf");
    expect(items[0].hint_title).toBe("Retrieval-Augmented Generation: A Survey");
    // Multi-line title is collapsed
    expect(items[1].hint_title).toBe("Improving RAG with hybrid search");
  });

  it("returns no items for non-arxiv spec", async () => {
    const items: any[] = [];
    for await (const it of arxivDiscovery.discover(
      { type: "seed-urls", urls: ["https://x"] } as any,
      { topic_id: "t", vault: "/tmp" },
    )) items.push(it);
    expect(items).toEqual([]);
  });
});
