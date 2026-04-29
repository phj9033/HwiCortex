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
});
