import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  BraveProvider,
  TavilyProvider,
  makeWebSearchDiscovery,
} from "../../../src/research/sources/web-search.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const braveJson = readFileSync(join(__dirname, "../fixtures/brave/q-rag-eval.json"), "utf-8");

const server = setupServer(
  http.get("https://api.search.brave.com/res/v1/web/search", ({ request }) => {
    const auth = request.headers.get("X-Subscription-Token");
    if (auth !== "brave-test-key") return new HttpResponse(null, { status: 401 });
    return HttpResponse.text(braveJson, {
      headers: { "content-type": "application/json" },
    });
  }),
  http.post("https://api.tavily.com/search", async ({ request }) => {
    const body = (await request.json()) as { api_key: string; query: string };
    if (body.api_key !== "tavily-test-key") return new HttpResponse(null, { status: 401 });
    return HttpResponse.json({
      results: [
        { url: "https://t.example/a", title: `Tavily result for ${body.query}` },
      ],
    });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

describe("BraveProvider", () => {
  it("maps Brave web.results to DiscoveryItems", async () => {
    const p = new BraveProvider("brave-test-key");
    const items = await p.search("RAG evaluation", {
      topK: 5,
      siteFilters: [],
    });
    expect(items.length).toBe(2);
    expect(items[0]).toMatchObject({
      url: "https://example.com/rag-eval-guide",
      hint_title: "Evaluating RAG: A Practical Guide",
      source_meta: { adapter: "web-search", provider: "brave", query: "RAG evaluation" },
    });
  });

  it("throws on auth failure", async () => {
    const p = new BraveProvider("wrong-key");
    await expect(
      p.search("RAG evaluation", { topK: 5, siteFilters: [] }),
    ).rejects.toThrow(/brave_search_failed/);
  });
});

describe("TavilyProvider", () => {
  it("posts query and api_key, maps results", async () => {
    const p = new TavilyProvider("tavily-test-key");
    const items = await p.search("vector db", {
      topK: 3,
      siteFilters: [],
    });
    expect(items).toEqual([
      {
        url: "https://t.example/a",
        hint_title: "Tavily result for vector db",
        source_meta: { adapter: "web-search", provider: "tavily", query: "vector db" },
      },
    ]);
  });
});

describe("makeWebSearchDiscovery", () => {
  it("iterates queries and yields each provider item", async () => {
    const fakeProvider = {
      async search(q: string) {
        return [
          { url: `https://x/${q}/1`, source_meta: { adapter: "web-search", provider: "fake", query: q } },
          { url: `https://x/${q}/2`, source_meta: { adapter: "web-search", provider: "fake", query: q } },
        ];
      },
    };
    const d = makeWebSearchDiscovery(fakeProvider);
    const items: any[] = [];
    for await (const it of d.discover(
      { type: "web-search", queries: ["a", "b"], site_filters: [], top_k_per_query: 5 } as any,
      { topic_id: "t", vault: "/tmp" },
    )) items.push(it);
    expect(items.map(i => i.url)).toEqual([
      "https://x/a/1",
      "https://x/a/2",
      "https://x/b/1",
      "https://x/b/2",
    ]);
  });

  it("yields nothing for non-web-search spec", async () => {
    const d = makeWebSearchDiscovery({ search: async () => [{ url: "https://x" }] });
    const items: any[] = [];
    for await (const it of d.discover(
      { type: "seed-urls", urls: ["https://x"] } as any,
      { topic_id: "t", vault: "/tmp" },
    )) items.push(it);
    expect(items).toEqual([]);
  });
});
