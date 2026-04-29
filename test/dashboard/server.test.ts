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
});
