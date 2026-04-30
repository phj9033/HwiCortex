import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startServer, type ServerHandle } from "../../src/cli/dashboard.js";
import { makeTempStore, makeTempVault } from "./fixtures.js";

let server: ServerHandle;
let baseUrl: string;
let cleanup: () => void;

beforeAll(async () => {
  const { store, cleanup: c } = makeTempStore(); cleanup = c;
  const vault = makeTempVault();
  server = await startServer({ port: 0, store, vaultDir: vault });
  baseUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(() => { server.stop(); cleanup(); });

describe("runDashboard", () => {
  it("is a function", async () => {
    const { runDashboard } = await import("../../src/cli/dashboard.js");
    expect(typeof runDashboard).toBe("function");
  });
});

describe("HTTP routes", () => {
  it("GET / returns HTML", async () => {
    const r = await fetch(baseUrl + "/");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/html/);
  });

  it("GET /api/overview returns JSON with vault key", async () => {
    const r = await fetch(baseUrl + "/api/overview");
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.vault).toBeDefined();
    expect(body.collections).toBeDefined();
  });

  it("GET /api/tags returns JSON with tags array", async () => {
    const r = await fetch(baseUrl + "/api/tags");
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body.tags)).toBe(true);
  });

  it("GET /api/collection/<missing> returns 404", async () => {
    const r = await fetch(baseUrl + "/api/collection/does-not-exist");
    expect(r.status).toBe(404);
  });

  it("rejects path traversal in /api/wiki/", async () => {
    const r = await fetch(baseUrl + "/api/wiki/foo/..%2Fetc");
    expect(r.status).toBe(404);
  });

  it("GET /api/search?q= returns 200 with empty results", async () => {
    const r = await fetch(baseUrl + "/api/search?q=");
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.results).toEqual([]);
  });

  it("survives a handler exception and continues serving", async () => {
    // Trigger a malformed request, then verify a normal request still succeeds
    await fetch(baseUrl + "/api/wiki//");
    const r = await fetch(baseUrl + "/api/overview");
    expect(r.status).toBe(200);
  });

  it("clamps invalid limit/offset to safe defaults", async () => {
    const r = await fetch(baseUrl + "/api/search?q=&limit=abc&offset=xyz");
    expect(r.status).toBe(200);
    const body = await r.json();
    // empty query → empty results regardless, but the route shouldn't 500
    expect(body.results).toEqual([]);
  });

  it("GET / returns a non-trivial HTML shell", async () => {
    const r = await fetch(baseUrl + "/");
    expect(r.status).toBe(200);
    const body = await r.text();
    expect(body).toContain("<header");
    expect(body).toContain('id="view"');
    expect(body).toContain("hashchange");
    expect(body).toContain("Overview");
  });

  it("HTML shell includes overview rendering helpers", async () => {
    const r = await fetch(baseUrl + "/");
    const body = await r.text();
    expect(body).toContain("renderOverview");
    expect(body).toContain("relTime");
    expect(body).toContain("Health Alerts");
    expect(body).toContain("/api/overview");
  });

  it("HTML shell includes drill-down rendering helpers", async () => {
    const r = await fetch(baseUrl + "/");
    const body = await r.text();
    expect(body).toContain("renderTags");
    expect(body).toContain("renderCollection");
    expect(body).toContain("renderWiki");
    expect(body).toContain("marked"); // CDN script
    expect(body).toContain("backlinks");
  });

  it("HTML shell includes search dropdown and pagination logic", async () => {
    const r = await fetch(baseUrl + "/");
    const body = await r.text();
    expect(body).toContain("search-dropdown");
    expect(body).toContain("debounce");
    expect(body).toContain("pagination");
    expect(body).toContain("renderSearch");
  });

  it("GET /api/search?q=&limit=5 returns 200 with empty results", async () => {
    const r = await fetch(baseUrl + "/api/search?q=&limit=5");
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.results).toEqual([]);
  });

  it("HTML shell includes split Overview layout markers", async () => {
    const r = await fetch(baseUrl + "/");
    const body = await r.text();
    // Two-panel layout class
    expect(body).toContain("split-grid");
    // Wiki panel summary copy
    expect(body).toContain("wiki project");
    // Vault header now mentions "wiki projects" not just "wiki pages"
    expect(body).toContain("wiki projects");
  });

  it("HTML shell includes Help tab and Help content sections", async () => {
    const r = await fetch(baseUrl + "/");
    const body = await r.text();
    // Tab and route
    expect(body).toContain('id="tab-help"');
    expect(body).toContain('href="#help"');
    expect(body).toContain('renderHelp');
    // Korean section headings (hardcoded copy)
    expect(body).toContain('Collection vs Wiki');
    expect(body).toContain('Health Alerts');
    expect(body).toContain('CLI');
    // 5 alert codes are documented somewhere in the Help body
    for (const code of ['overlap', 'no-context', 'empty', 'no-embedding', 'stale']) {
      expect(body).toContain(code);
    }
  });

  it("inline <script> body parses as valid JavaScript", async () => {
    // Regression guard: when JS string literals inside the renderHtml()
    // template literal use a single backslash for `\n` or `\'`, the template
    // literal collapses them to real newlines / apostrophes, producing
    // multi-line single-quoted strings or prematurely-closed strings in the
    // browser-side script. The whole <script> then fails to parse and the
    // dashboard hangs at "Loading…". Use double-backslash (`\\n`, `\\'`) so
    // the served JS contains the escape sequence the browser needs.
    const r = await fetch(baseUrl + "/");
    const body = await r.text();
    const m = body.match(/<script>([\s\S]*?)<\/script>/g);
    expect(m).toBeTruthy();
    // The first <script> is the marked.min.js external loader (empty body);
    // the inline dashboard JS is the next one with substantive content.
    const inline = m!.map(s => s.replace(/^<script[^>]*>|<\/script>$/g, "")).find(s => s.length > 1000);
    expect(inline).toBeTruthy();
    expect(() => new Function(inline!)).not.toThrow();
  });
});
