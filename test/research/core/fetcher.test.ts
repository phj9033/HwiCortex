import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fetchUrl, FetchError } from "../../../src/research/core/fetcher.js";
import { DomainRateLimiter } from "../../../src/research/core/rate-limit.js";
import { FetchCache } from "../../../src/research/core/cache.js";
import { _resetRobotsCacheForTests } from "../../../src/research/core/robots.js";

const server = setupServer(
  http.get("https://e.com/robots.txt", () =>
    HttpResponse.text("User-agent: *\nAllow: /\n"),
  ),
  http.get("https://e.com/a", () =>
    HttpResponse.html("<html><body>hi</body></html>", {
      headers: { etag: "W/abc" },
    }),
  ),
  http.get("https://forbid.com/robots.txt", () =>
    HttpResponse.text("User-agent: *\nDisallow: /\n"),
  ),
  http.get("https://forbid.com/x", () => HttpResponse.text("nope")),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

let vault: string;
beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "v-"));
  mkdirSync(join(vault, "research", "_staging", "t1"), { recursive: true });
  _resetRobotsCacheForTests();
});
afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

function makeCfg(v: string) {
  return {
    user_agent: "test/0.1",
    timeout_ms: 1000,
    max_redirects: 5,
    rate_limiter: new DomainRateLimiter(100),
    cache: new FetchCache(v, "t1"),
  };
}

describe("fetchUrl", () => {
  it("fetches an allowed URL and caches the body", async () => {
    const doc = await fetchUrl("https://e.com/a", makeCfg(vault));
    expect(doc.status).toBe(200);
    expect(doc.content_type).toBe("html");
    expect(doc.body_bytes.toString()).toContain("hi");
  });

  it("rejects URLs disallowed by robots.txt", async () => {
    await expect(fetchUrl("https://forbid.com/x", makeCfg(vault))).rejects.toThrow(
      FetchError,
    );
  });
});
