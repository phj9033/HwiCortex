import { basename, join } from "path";
import { existsSync, readFileSync, statSync } from "fs";
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import type { Store } from "../store.js";
import { createStore, getStoreCollections, searchFTS } from "../store.js";
import { listWikiPages, parseFrontmatter } from "../wiki.js";

// ============================================================================
// Alert Detection
// ============================================================================

export type Alert = {
  severity: "warn" | "info";
  code: string;
  message: string;
  hint?: string;
  items?: string[];
};

function detectOverlaps(collections: Array<{ name: string; path: string }>): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < collections.length; i++) {
    for (let j = i + 1; j < collections.length; j++) {
      const a = collections[i]?.path ?? "", b = collections[j]?.path ?? "";
      if (a && b && (a === b || a.startsWith(b + "/") || b.startsWith(a + "/"))) {
        pairs.push([collections[i]?.name ?? "", collections[j]?.name ?? ""]);
      }
    }
  }
  return pairs;
}

export function detectAlerts(store: Store, vaultDir: string): Alert[] {
  const alerts: Alert[] = [];
  const db = store.db;
  const collections = getStoreCollections(db);

  // 1. overlap (per pair) — flag when one path is a prefix of another
  for (const [nameA, nameB] of detectOverlaps(collections)) {
    alerts.push({
      severity: "warn",
      code: "overlap",
      message: `Collections '${nameA}' and '${nameB}' index overlapping paths`,
      hint: `Consider 'hwicortex collection rm' on one of them`,
    });
  }

  // 2. no-context (per collection) — flag collections with no context entries
  for (const c of collections) {
    const ctx = c.context as Record<string, string> | undefined;
    if (!ctx || Object.keys(ctx).length === 0) {
      alerts.push({
        severity: "info",
        code: "no-context",
        message: `Collection '${c.name}' has no context — search ranking quality reduced`,
        hint: `hwicortex context add qmd://${c.name}/ "<description>"`,
      });
    }
  }

  // 3. empty (per collection) — flag collections with zero active documents
  for (const c of collections) {
    const n = (
      db
        .prepare("SELECT COUNT(*) AS n FROM documents WHERE collection=? AND active=1")
        .get(c.name) as { n: number }
    ).n;
    if (n === 0) {
      alerts.push({
        severity: "warn",
        code: "empty",
        message: `Collection '${c.name}' is empty — path may be wrong or files missing`,
        hint: `Configured path: ${c.path}`,
      });
    }
  }

  // 4. no-embedding (aggregated) — active docs without content_vectors rows
  // The content_vectors table always exists (created in initializeDatabase), so no guard needed.
  const missing = (
    db
      .prepare(`
        SELECT COUNT(DISTINCT d.id) AS n FROM documents d
        WHERE d.active=1 AND NOT EXISTS (
          SELECT 1 FROM content_vectors v WHERE v.hash = d.hash
        )
      `)
      .get() as { n: number }
  ).n;
  if (missing > 0) {
    alerts.push({
      severity: "warn",
      code: "no-embedding",
      message: `${missing} document${missing === 1 ? "" : "s"} missing embeddings — vector search incomplete`,
      hint: `hwicortex embed --collection <name>`,
    });
  }

  // 5. stale (aggregated, items list slugs) — wiki pages never hit and older than 30 days
  const wiki = listWikiPages(vaultDir);
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const staleItems = wiki
    .filter(
      (w) =>
        (w.hit_count ?? 0) === 0 &&
        typeof w.created === "string" &&
        w.created.length > 0 &&
        w.created < cutoff
    )
    .map(
      (w) =>
        `${w.project}/${basename(w.filePath).replace(/\.md$/, "").toLowerCase()}`
    );
  if (staleItems.length > 0) {
    alerts.push({
      severity: "info",
      code: "stale",
      message: `${staleItems.length} wiki page${staleItems.length === 1 ? "" : "s"} have never been hit (created >30d ago)`,
      items: staleItems,
    });
  }

  return alerts;
}

export type DashboardOptions = { port: number; open: boolean };

export async function runDashboard(opts: DashboardOptions): Promise<void> {
  const vaultDir = process.env.QMD_VAULT_DIR;
  if (!vaultDir) {
    console.error("Error: QMD_VAULT_DIR not set.");
    process.exit(1);
  }
  if (!existsSync(vaultDir)) {
    console.error(`Error: Vault path not found: ${vaultDir}`);
    process.exit(1);
  }

  let store: Store;
  try {
    store = createStore();
  } catch {
    console.error("Error: Index DB not found. Run 'hwicortex collection add ...' first.");
    process.exit(1);
    return; // unreachable, but TS needs it
  }

  let server: ServerHandle;
  try {
    server = await startServer({ port: opts.port, store, vaultDir });
  } catch (e: any) {
    if (String(e?.message ?? e).match(/EADDRINUSE|in use/i)) {
      console.error(`Error: Port ${opts.port} in use. Try --port <n>.`);
      process.exit(1);
    }
    throw e;
  }

  const url = `http://127.0.0.1:${server.port}`;
  console.log(`HwiCortex dashboard: ${url}`);
  if (opts.open) {
    try { spawnOpen(url); } catch { /* swallow — URL already printed */ }
  }

  process.on("SIGINT", () => { server.stop(); process.exit(0); });
  await new Promise(() => { /* keep alive until SIGINT */ });
}

function spawnOpen(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
}

// ============================================================================
// HTTP Server
// ============================================================================

export type ServerHandle = { port: number; stop: () => void };

export async function startServer(opts: {
  port: number;
  store: Store;
  vaultDir: string;
}): Promise<ServerHandle> {
  const { port, store, vaultDir } = opts;

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const rawUrl = req.url ?? "/";
    const url = new URL(rawUrl, `http://127.0.0.1`);

    const sendJson = (data: unknown, status = 200) => {
      const body = JSON.stringify(data);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(body);
    };
    const sendText = (text: string, status = 200, ct = "text/plain") => {
      res.writeHead(status, { "content-type": ct });
      res.end(text);
    };

    try {
      if (url.pathname === "/") {
        sendText(renderHtml(), 200, "text/html; charset=utf-8");
        return;
      }
      if (url.pathname === "/api/overview") {
        sendJson(getOverview(store, vaultDir));
        return;
      }
      if (url.pathname === "/api/tags") {
        sendJson(getTags(store, vaultDir));
        return;
      }
      if (url.pathname === "/api/search") {
        const q = url.searchParams.get("q") ?? "";
        const coll = url.searchParams.get("collection") ?? undefined;
        const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") ?? 20) || 20));
        const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);
        sendJson(await searchDashboard(store, q, coll, limit, offset));
        return;
      }
      const cm = url.pathname.match(/^\/api\/collection\/([^/]+)$/);
      if (cm && cm[1]) {
        const name = decodeURIComponent(cm[1]);
        if (name.includes("..") || name.includes("/")) {
          sendText("Not found", 404);
          return;
        }
        const detail = getCollectionDetail(store, name);
        if (detail) {
          sendJson(detail);
        } else {
          sendJson({ error: "Collection not found" }, 404);
        }
        return;
      }
      const wm = url.pathname.match(/^\/api\/wiki\/([^/]+)\/([^/]+)$/);
      if (wm && wm[1] && wm[2]) {
        const project = decodeURIComponent(wm[1]);
        const slug = decodeURIComponent(wm[2]);
        if (
          [project, slug].some(
            (s) => !s || s.includes("..") || s.includes("/") || s.includes("\\")
          )
        ) {
          sendText("Not found", 404);
          return;
        }
        const detail = getWikiPageDetail(store, vaultDir, project, slug);
        if (detail) {
          sendJson(detail);
        } else {
          sendJson({ error: "Wiki page not found" }, 404);
        }
        return;
      }
      sendText("Not found", 404);
    } catch (err) {
      console.error("[dashboard]", err);
      sendJson({ error: (err as Error).message }, 500);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(port, "127.0.0.1", () => resolve());
    server.once("error", reject);
  });
  // Prevent post-startup 'error' events from crashing the process.
  server.on("error", (err) => console.error("[dashboard] server error:", err));

  const actualPort = (server.address() as { port: number }).port;

  return {
    port: actualPort,
    stop: () => server.close(),
  };
}

function renderHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>HwiCortex Dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: #1a1a1a;
  background: #f5f5f5;
}

/* ---- Layout ---- */
.container { max-width: 1200px; margin: 0 auto; padding: 0 16px; }

/* ---- Header ---- */
header {
  position: sticky;
  top: 0;
  z-index: 100;
  background: #fff;
  border-bottom: 1px solid #e0e0e0;
  padding: 0 16px;
}
.header-inner {
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  gap: 16px;
  height: 52px;
}
.header-title {
  font-size: 16px;
  font-weight: 600;
  color: #111;
  white-space: nowrap;
  margin-right: 8px;
}
.tabs { display: flex; gap: 4px; }
.tab {
  display: inline-block;
  padding: 6px 14px;
  border-radius: 6px;
  text-decoration: none;
  color: #555;
  font-weight: 500;
  transition: background 0.12s, color 0.12s;
}
.tab:hover { background: #f0f0f0; color: #111; }
.tab.active { background: #e8f0fe; color: #1a56db; }
.spacer { flex: 1; }
.btn-refresh {
  padding: 6px 14px;
  border: 1px solid #d0d0d0;
  border-radius: 6px;
  background: #fff;
  color: #444;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  transition: background 0.12s;
}
.btn-refresh:hover { background: #f0f0f0; }

/* ---- Search bar ---- */
#search-bar {
  background: #fff;
  border-bottom: 1px solid #e8e8e8;
  padding: 10px 16px;
}
.search-inner {
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  gap: 8px;
}
#search-input {
  flex: 0 0 70%;
  padding: 7px 12px;
  border: 1px solid #ccc;
  border-radius: 6px;
  font-size: 14px;
  outline: none;
  transition: border-color 0.12s;
}
#search-input:focus { border-color: #1a56db; }
#collection-select {
  flex: 0 0 25%;
  padding: 7px 10px;
  border: 1px solid #ccc;
  border-radius: 6px;
  font-size: 14px;
  background: #fff;
  cursor: pointer;
}
#search-btn {
  flex: 1;
  padding: 7px 14px;
  background: #1a56db;
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
}
#search-btn:hover { background: #1447b0; }

/* ---- Main view ---- */
#view {
  max-width: 1200px;
  margin: 0 auto;
  padding: 16px;
}

/* ---- Cards ---- */
.card {
  background: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 12px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}
.card-title {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 8px;
  color: #111;
}

/* ---- Badges ---- */
.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 500;
}
.badge-warn { background: #fff3cd; color: #856404; border: 1px solid #ffc107; }
.badge-info { background: #e9ecef; color: #495057; border: 1px solid #ced4da; }

/* ---- Modal ---- */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.45);
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
}
.modal-overlay.hidden { display: none; }
.modal-card {
  background: #fff;
  border-radius: 10px;
  padding: 24px;
  max-width: 560px;
  width: 90%;
  max-height: 80vh;
  overflow-y: auto;
  position: relative;
  box-shadow: 0 8px 30px rgba(0,0,0,0.18);
}
.modal-close {
  position: absolute;
  top: 12px;
  right: 14px;
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: #888;
  line-height: 1;
}
.modal-close:hover { color: #111; }

/* ---- Search dropdown ---- */
#search-input-wrap { position: relative; flex: 0 0 70%; }
#search-input { width: 100%; flex: none; }
.search-dropdown { position: absolute; top: 100%; left: 0; right: 0; background: #fff;
  border: 1px solid #ccc; border-top: none; border-radius: 0 0 6px 6px;
  max-height: calc(6 * 44px); overflow-y: auto; z-index: 150; box-shadow: 0 4px 12px rgba(0,0,0,0.12); }
.dropdown-item { padding: 10px 12px; cursor: pointer; border-bottom: 1px solid #f0f0f0; font-size: 13px; }
.dropdown-item:hover, .dropdown-view-all:hover { background: #f0f4ff; }
.dropdown-item:last-child { border-bottom: none; }
.dropdown-view-all { color: #1a56db; font-size: 12px; padding: 8px 12px; text-align: center; cursor: pointer; }
/* ---- Search results page ---- */
.search-results { list-style: decimal; padding-left: 24px; margin-top: 12px; }
.search-results li { padding: 10px 0; border-bottom: 1px solid #f0f0f0; }
.search-results li:last-child { border-bottom: none; }
.search-results header { margin-bottom: 4px; }
.search-results a { color: #1a56db; text-decoration: none; font-weight: 500; }
.search-results a:hover { text-decoration: underline; }
.snippet { font-size: 12px; color: #555; margin: 0; }
.snippet mark { background: #fff3cd; padding: 0 2px; border-radius: 2px; }
/* ---- Pagination ---- */
.pagination { display: flex; align-items: center; gap: 12px; margin-top: 16px; font-size: 13px; }
.pagination button { padding: 5px 14px; border: 1px solid #d0d0d0; border-radius: 6px; background: #fff; cursor: pointer; font-size: 13px; }
.pagination button:disabled { opacity: 0.4; cursor: default; }
.pagination button:not(:disabled):hover { background: #f0f0f0; }

/* ---- Vault header ---- */
.vault-header { margin-bottom: 12px; }
.vault-header h2 { font-size: 15px; font-weight: 600; color: #111; margin-bottom: 2px; }
.vault-header .vault-meta { font-size: 13px; color: #666; }

/* ---- Collection grid ---- */
.coll-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  margin-bottom: 12px;
}
@media (max-width: 600px) { .coll-grid { grid-template-columns: 1fr; } }
.coll-card {
  background: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 14px;
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  transition: border-color 0.12s, box-shadow 0.12s;
}
.coll-card:hover { border-color: #1a56db; box-shadow: 0 2px 6px rgba(26,86,219,0.12); }
.coll-card-name { font-weight: 600; font-size: 14px; margin-bottom: 4px; }
.coll-card-meta { font-size: 12px; color: #666; margin-bottom: 6px; }
.coll-card-overlap { font-size: 12px; color: #856404; margin-top: 4px; }
.badge-ctx { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
.badge-noctx { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }

/* ---- Wiki activity 3-col ---- */
.wiki-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
@media (max-width: 700px) { .wiki-grid { grid-template-columns: 1fr; } }
.wiki-col h3 { font-size: 13px; font-weight: 600; color: #555; text-transform: uppercase;
  letter-spacing: 0.04em; margin-bottom: 8px; }
.wiki-col ul { list-style: none; }
.wiki-col li { padding: 3px 0; font-size: 13px; }
.wiki-col a { color: #1a56db; text-decoration: none; cursor: pointer; }
.wiki-col a:hover { text-decoration: underline; }

/* ---- Alerts ---- */
.alert-row { margin-bottom: 6px; font-size: 13px; }
.alert-row summary { cursor: pointer; list-style: none; display: flex; align-items: center; gap: 6px; }
.alert-row summary::-webkit-details-marker { display: none; }
.alert-hint { margin-top: 4px; margin-left: 4px; color: #555; font-size: 12px; }
.alert-items { margin-top: 4px; margin-left: 4px; font-size: 12px; color: #555; }

/* ---- Tags view ---- */
.tag-list { margin-top: 8px; }
.tag-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.tag-name { min-width: 120px; font-size: 13px; color: #1a56db; cursor: pointer; text-decoration: none; }
.tag-name:hover { text-decoration: underline; }
.tag-bar { height: 14px; background: #a8c4f8; border-radius: 3px; min-width: 2px; }
.tag-count { font-size: 12px; color: #666; }

/* ---- Collection detail ---- */
.meta { font-size: 13px; color: #555; margin-bottom: 12px; }
.file-list { width: 100%; border-collapse: collapse; font-size: 13px; }
.file-list th { text-align: left; padding: 6px 10px; background: #f5f5f5;
  border-bottom: 2px solid #e0e0e0; font-weight: 600; }
.file-list td { padding: 6px 10px; border-bottom: 1px solid #f0f0f0; word-break: break-all; }
.file-list tbody tr:hover { background: #f5f7ff; }

/* ---- Wiki page detail ---- */
.wiki-body { max-width: 720px; line-height: 1.7; font-size: 14px; margin-top: 12px; }
.wiki-body h1,.wiki-body h2,.wiki-body h3 { margin: 1em 0 0.4em; }
.wiki-body p { margin-bottom: 0.8em; }
.wiki-body pre { background: #f5f5f5; padding: 10px; border-radius: 4px; overflow-x: auto; }
.wiki-body code { font-size: 12px; }
.backlinks { margin-top: 24px; padding: 12px 16px; background: #fafafa;
  border: 1px solid #e8e8e8; border-radius: 6px; }
.backlinks h3 { font-size: 13px; font-weight: 600; margin-bottom: 6px; color: #555; }
.backlinks ul { list-style: none; font-size: 13px; }
.backlinks li { padding: 2px 0; }
.backlinks a { color: #1a56db; text-decoration: none; }
.backlinks a:hover { text-decoration: underline; }

/* ---- Split Overview layout ---- */
.split-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-top: 16px;
}
@media (max-width: 900px) {
  .split-grid { grid-template-columns: 1fr; }
}
.coll-panel .coll-grid { grid-template-columns: 1fr; gap: 8px; }
.wiki-panel .wiki-grid { margin-top: 12px; }
.wiki-summary { color: #666; font-size: 13px; margin-bottom: 10px; }
.wiki-subhead { font-size: 13px; font-weight: 600; color: #555; margin: 8px 0 4px; }
.wiki-projects { list-style: none; padding: 0; margin: 0 0 12px; font-size: 13px; }
.wiki-projects li { padding: 2px 0; }
.wiki-projects a { color: #1a56db; cursor: pointer; text-decoration: none; }
.wiki-projects a:hover { text-decoration: underline; }
.wiki-project-count { color: #999; font-size: 12px; }

/* ---- Help tab ---- */
.help-section { margin-bottom: 16px; }
.help-section h2 { font-size: 18px; margin-bottom: 10px; }
.help-section h3 { font-size: 14px; font-weight: 600; margin: 12px 0 6px; color: #444; }
.help-section p  { margin-bottom: 8px; }
.help-table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 6px; }
.help-table th, .help-table td { padding: 6px 8px; border: 1px solid #e0e0e0; text-align: left; vertical-align: top; }
.help-table thead th { background: #fafafa; font-weight: 600; }
.help-table tbody th { width: 80px; background: #fafafa; }
.help-dl { margin: 4px 0; }
.help-dl dt { font-weight: 600; margin-top: 8px; }
.help-dl dd { margin: 2px 0 4px 16px; color: #444; }
.help-pre { background: #f5f5f5; padding: 10px; border-radius: 4px; font-size: 12px; overflow-x: auto; }
.help-list { list-style: disc; padding-left: 20px; }
.help-list li { margin: 4px 0; }
</style>
</head>
<body>

<header>
  <div class="header-inner">
    <span class="header-title">HwiCortex</span>
    <nav class="tabs">
      <a href="#overview" class="tab" id="tab-overview">Overview</a>
      <a href="#tags" class="tab" id="tab-tags">Tags</a>
      <a href="#help" class="tab" id="tab-help">Help</a>
    </nav>
    <div class="spacer"></div>
    <button class="btn-refresh" id="btn-refresh">Refresh</button>
  </div>
</header>

<section id="search-bar">
  <div class="search-inner">
    <div id="search-input-wrap">
      <input id="search-input" type="search" placeholder="Search documents…" autocomplete="off">
      <div class="search-dropdown" id="search-dropdown" style="display:none"></div>
    </div>
    <select id="collection-select">
      <option value="">All collections</option>
    </select>
    <button id="search-btn">Search</button>
  </div>
</section>

<main id="view">
  <p>Loading…</p>
</main>

<div class="modal-overlay hidden" id="modal-overlay" role="dialog" aria-modal="true">
  <div class="modal-card" id="modal-card">
    <button class="modal-close" id="modal-close" aria-label="Close">&#x2715;</button>
    <div id="modal-body"></div>
  </div>
</div>

<script>
// ---- fetchJson -------------------------------------------------------
async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error("HTTP " + res.status + (text ? ": " + text.slice(0, 200) : ""));
  }
  return res.json();
}

function renderError(msg) {
  document.getElementById("view").innerHTML =
    '<div class="card"><p style="color:#c00">Failed to load: ' + escHtml(msg) +
    '</p><button class="btn-refresh" onclick="route()" style="margin-top:8px">Retry</button></div>';
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---- Hash router -----------------------------------------------------
function parseHash() {
  const hash = location.hash.replace(/^#/, "");
  if (!hash) return { view: "overview", params: {} };

  if (hash === "overview") return { view: "overview", params: {} };
  if (hash === "tags") return { view: "tags", params: {} };
  if (hash === "help") return { view: "help", params: {} };

  const collMatch = hash.match(/^collection\\/(.+)$/);
  if (collMatch) return { view: "collection", params: { name: decodeURIComponent(collMatch[1]) } };

  const wikiMatch = hash.match(/^wiki\\/([^\\/]+)\\/([^\\/]+)$/);
  if (wikiMatch) return {
    view: "wiki",
    params: { project: decodeURIComponent(wikiMatch[1]), slug: decodeURIComponent(wikiMatch[2]) }
  };

  if (hash.startsWith("search")) {
    const qStr = hash.replace(/^search\\??/, "");
    const sp = new URLSearchParams(qStr);
    const pageVal = parseInt(sp.get("page") || "0", 10);
    return { view: "search", params: { q: sp.get("q") || "", collection: sp.get("collection") || "", page: isNaN(pageVal) || pageVal < 0 ? 0 : pageVal } };
  }

  return { view: "overview", params: {} };
}

function setActiveTab(view) {
  document.querySelectorAll(".tab").forEach(function(el) { el.classList.remove("active"); });
  if (view === "overview") document.getElementById("tab-overview").classList.add("active");
  if (view === "tags")     document.getElementById("tab-tags").classList.add("active");
  if (view === "help")     document.getElementById("tab-help").classList.add("active");
}

function route() {
  const { view, params } = parseHash();
  setActiveTab(view);
  try {
    if (view === "overview") { renderOverview(); return; }
    if (view === "tags")     { renderTags();    return; }
    if (view === "help")     { renderHelp();    return; }
    if (view === "collection") { renderCollection(params.name); return; }
    if (view === "wiki")     { renderWiki(params.project, params.slug); return; }
    if (view === "search")   { renderSearch(params.q, params.collection, params.page || 0); return; }
    renderOverview();
  } catch(e) {
    renderError(e.message || String(e));
  }
}

// ---- Helpers ---------------------------------------------------------
function relTime(iso) {
  if (!iso) return "never";
  var now = Date.now();
  var then = new Date(iso).getTime();
  if (isNaN(then)) return "unknown";
  var diff = Math.floor((now - then) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return Math.floor(diff / 60) + "m ago";
  if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
  return Math.floor(diff / 86400) + "d ago";
}

// ---- View renderers --------------------------------------------------
function renderOverview() {
  var view = document.getElementById("view");
  view.innerHTML = "<p>Loading…</p>";
  fetchJson("/api/overview").then(function(data) {
    var html = "";

    // Widget A — Vault Header
    var v = data.vault || {};
    html += '<div class="vault-header card">';
    html += '<h2>HwiCortex Vault: ' + escHtml(v.path || "") + '</h2>';
    html += '<div class="vault-meta">';
    html += escHtml(String(v.totalCollections || 0)) + " collection" + (v.totalCollections === 1 ? "" : "s") + " &middot; ";
    html += escHtml(String(v.totalWikiProjects || 0)) + " " + (v.totalWikiProjects === 1 ? "wiki project" : "wiki projects") + " &middot; ";
    html += escHtml(String(v.totalWikiPages || 0)) + " wiki page" + (v.totalWikiPages === 1 ? "" : "s") + " &middot; ";
    html += escHtml(String(v.totalDocs || 0)) + " doc" + (v.totalDocs === 1 ? "" : "s") + " &middot; ";
    html += "Last updated " + escHtml(relTime(v.lastUpdate));
    html += "</div></div>";

    // Widget F — Health Alerts (only if non-empty)
    var alerts = data.alerts || [];
    if (alerts.length > 0) {
      html += '<div class="card">';
      html += '<div class="card-title">Health Alerts</div>';
      for (var i = 0; i < alerts.length; i++) {
        var a = alerts[i];
        html += '<details class="alert-row">';
        html += '<summary>';
        html += '<span class="badge badge-' + escHtml(a.severity || "info") + '">' + escHtml(a.severity || "info") + '</span> ';
        html += '<strong>' + escHtml(a.code || "") + '</strong>: ' + escHtml(a.message || "");
        html += '</summary>';
        if (a.hint) {
          html += '<div class="alert-hint">' + escHtml(a.hint) + '</div>';
        }
        if (a.items && a.items.length > 0) {
          html += '<ul class="alert-items">';
          for (var j = 0; j < a.items.length; j++) {
            html += '<li>' + escHtml(a.items[j]) + '</li>';
          }
          html += '</ul>';
        }
        html += '</details>';
      }
      html += '</div>';
    }

    // Widget B/C — Two-panel Collections | Wiki layout
    var colls = data.collections || [];
    var wiki = data.wiki || {};
    var projects = wiki.projects || [];
    var recent = wiki.recent || [];
    var topHits = wiki.topHits || [];
    var highImp = wiki.highImportance || [];

    var noWiki = recent.length === 0 && topHits.length === 0 && highImp.length === 0 && projects.length === 0;
    var noColls = colls.length === 0;

    if (noColls && noWiki) {
      html += '<div class="card"><h2 style="margin-bottom:10px">Welcome to HwiCortex Dashboard</h2>';
      html += '<p style="margin-bottom:8px">No collections or wiki pages found. Get started:</p>';
      html += '<pre style="background:#f5f5f5;padding:10px;border-radius:6px;font-size:13px">';
      html += 'hwicortex collection add &lt;path&gt;\nhwicortex embed --collection &lt;name&gt;\nhwicortex wiki create &lt;project&gt; &lt;title&gt;</pre></div>';
    } else {
      html += '<div class="split-grid">';

      // Left: Collections panel
      html += '<section class="coll-panel card">';
      html += '<div class="card-title">Collections</div>';
      if (colls.length === 0) {
        html += '<p style="color:#666">No real collections yet. Run <code>hwicortex collection add &lt;path&gt;</code></p>';
      } else {
        html += '<div class="coll-grid">';
        for (var ci = 0; ci < colls.length; ci++) {
          var c = colls[ci];
          var hasOverlap = c.overlapsWith && c.overlapsWith.length > 0;
          html += '<div class="coll-card" data-coll="' + escHtml(c.name || "") + '">';
          html += '<div class="coll-card-name">' + escHtml(c.name || "");
          if (hasOverlap) html += ' <span title="Overlapping paths">&#9888;</span>';
          html += '</div>';
          html += '<div class="coll-card-meta">' + escHtml(String(c.fileCount || 0)) + " files &middot; " + escHtml(relTime(c.lastUpdate)) + '</div>';
          html += '<span class="badge ' + (c.hasContext ? "badge-ctx" : "badge-noctx") + '">' + (c.hasContext ? "ctx" : "no context") + '</span>';
          if (hasOverlap) {
            html += '<div class="coll-card-overlap">overlaps with: ' + escHtml(c.overlapsWith.join(", ")) + '</div>';
          }
          html += '</div>';
        }
        html += '</div>';
      }
      html += '</section>';

      // Right: Wiki panel
      html += '<section class="wiki-panel card">';
      html += '<div class="card-title">Wiki</div>';
      var totalPages = (data.vault && data.vault.totalWikiPages) || 0;
      html += '<div class="wiki-summary">' + escHtml(String(projects.length)) + ' ' + (projects.length === 1 ? 'wiki project' : 'wiki projects') + ' &middot; ' + escHtml(String(totalPages)) + ' page' + (totalPages === 1 ? '' : 's') + '</div>';

      // Project list (clickable → search filter by project name)
      if (projects.length > 0) {
        html += '<h3 class="wiki-subhead">Projects</h3><ul class="wiki-projects">';
        for (var pi = 0; pi < projects.length; pi++) {
          var p = projects[pi];
          html += '<li><a onclick="location.hash=\'#search?q=' + encodeURIComponent(p.name) + '\'">' + escHtml(p.name) + '</a> <span class="wiki-project-count">(' + escHtml(String(p.pageCount)) + ')</span></li>';
        }
        html += '</ul>';
      }

      // Recent / Top Hits / High Importance triple
      html += '<div class="wiki-grid">';

      html += '<div class="wiki-col"><h3>Recent</h3><ul>';
      if (recent.length === 0) {
        html += '<li style="color:#999">—</li>';
      } else {
        for (var ri = 0; ri < recent.length; ri++) {
          var rw = recent[ri];
          html += '<li><a onclick="location.hash=\'#wiki/' + encodeURIComponent(rw.project || "") + '/' + encodeURIComponent(rw.slug || "") + '\'">' + escHtml(rw.title || rw.slug || "") + '</a></li>';
        }
      }
      html += '</ul></div>';

      html += '<div class="wiki-col"><h3>Top Hits</h3><ul>';
      if (topHits.length === 0) {
        html += '<li style="color:#999">—</li>';
      } else {
        for (var ti = 0; ti < topHits.length; ti++) {
          var tw = topHits[ti];
          html += '<li>' + (ti + 1) + '. <a onclick="location.hash=\'#wiki/' + encodeURIComponent(tw.project || "") + '/' + encodeURIComponent(tw.slug || "") + '\'">' + escHtml(tw.title || tw.slug || "") + '</a> (' + escHtml(String(tw.hit_count || 0)) + ')</li>';
        }
      }
      html += '</ul></div>';

      html += '<div class="wiki-col"><h3>High Importance</h3><ul>';
      if (highImp.length === 0) {
        html += '<li style="color:#999">—</li>';
      } else {
        for (var ii = 0; ii < highImp.length; ii++) {
          var iw = highImp[ii];
          html += '<li>&#9733; <a onclick="location.hash=\'#wiki/' + encodeURIComponent(iw.project || "") + '/' + encodeURIComponent(iw.slug || "") + '\'">' + escHtml(iw.title || iw.slug || "") + '</a></li>';
        }
      }
      html += '</ul></div>';
      html += '</div>'; // .wiki-grid

      html += '</section>'; // .wiki-panel
      html += '</div>'; // .split-grid
    }

    view.innerHTML = html;

    // Attach click handlers for collection cards
    view.querySelectorAll(".coll-card").forEach(function(el) {
      el.addEventListener("click", function() {
        location.hash = "#collection/" + encodeURIComponent(el.getAttribute("data-coll") || "");
      });
    });
  }).catch(function(err) {
    renderError(err.message || String(err));
  });
}

function renderTags() {
  var view = document.getElementById("view");
  view.innerHTML = "<p>Loading…</p>";
  fetchJson("/api/tags").then(function(data) {
    var tags = data.tags || [];
    var html = "<h2 style='margin-bottom:12px'>Tags <small style='font-weight:normal;color:#666'>Click a tag to search for pages containing it</small></h2>";
    if (tags.length === 0) {
      html += "<p style='color:#666'>No tags found in wiki frontmatter.</p>";
    } else {
      var maxCount = Math.max.apply(null, tags.map(function(t) { return t.count; }));
      var scale = 200 / Math.max(maxCount, 1);
      html += '<div class="tag-list">';
      for (var i = 0; i < tags.length; i++) {
        var t = tags[i];
        var barW = Math.round(t.count * scale);
        html += '<div class="tag-row">';
        html += '<a class="tag-name" onclick="location.hash=\'#search?q=' + encodeURIComponent(t.name) + '\'">' + escHtml(t.name) + '</a>';
        html += '<div class="tag-bar" style="width:' + barW + 'px"></div>';
        html += '<span class="tag-count">' + escHtml(String(t.count)) + '</span>';
        html += '</div>';
      }
      html += '</div>';
    }
    view.innerHTML = html;
  }).catch(function(err) { renderError(err.message || String(err)); });
}

function renderHelp() {
  var view = document.getElementById("view");
  var html = '';

  // Section 1: Collection vs Wiki
  html += '<section class="card help-section">';
  html += '<h2>Collection vs Wiki</h2>';
  html += '<p>HwiCortex는 두 가지 형태의 문서 저장소를 다룹니다.</p>';
  html += '<table class="help-table"><thead><tr><th></th><th>Collection</th><th>Wiki</th></tr></thead><tbody>';
  html += '<tr><th>등록</th><td><code>hwicortex collection add &lt;path&gt;</code> 로 사용자가 직접 등록</td><td>볼트 디렉터리(<code>QMD_VAULT_DIR/wiki/</code>) 아래 파일이 자동 인덱싱됨</td></tr>';
  html += '<tr><th>위치</th><td>임의의 경로 (<code>~/projects/foo</code> 등)</td><td>볼트 안 <code>wiki/&lt;project&gt;/</code></td></tr>';
  html += '<tr><th>메타</th><td>YAML <code>context</code>로 컬렉션 단위 설명 추가</td><td>페이지 frontmatter (<code>title</code>, <code>tags</code>, <code>importance</code>, <code>hit_count</code> 등)</td></tr>';
  html += '<tr><th>용도</th><td>외부 코드/문서 검색 인덱싱</td><td>대화형 지식&middot;노트 누적, 검색 시 자동 hit 카운트 업데이트</td></tr>';
  html += '</tbody></table>';
  html += '</section>';

  // Section 2: Health Alerts
  html += '<section class="card help-section">';
  html += '<h2>Health Alerts</h2>';
  html += '<p>Overview 상단에 표시되는 5가지 코드의 의미와 대응 명령:</p>';
  html += '<dl class="help-dl">';
  html += '<dt><code>overlap</code></dt><dd>두 컬렉션 경로가 한쪽이 다른 쪽의 prefix인 경우. 한쪽을 <code>hwicortex collection rm</code> 으로 정리하세요.</dd>';
  html += '<dt><code>no-context</code></dt><dd>컬렉션에 컨텍스트 설명이 없어서 검색 랭킹 품질이 낮음. <code>hwicortex context add qmd://&lt;name&gt;/ "&lt;설명&gt;"</code></dd>';
  html += '<dt><code>empty</code></dt><dd>컬렉션이 비었음 (경로 오타이거나 파일이 사라졌을 수 있음). 등록 경로를 확인하세요.</dd>';
  html += '<dt><code>no-embedding</code></dt><dd>일부 문서에 임베딩이 없어서 벡터 검색이 누락됨. <code>hwicortex embed --collection &lt;name&gt;</code></dd>';
  html += '<dt><code>stale</code></dt><dd>30일 넘게 한 번도 hit되지 않은 위키 페이지 목록. 정리 후보입니다.</dd>';
  html += '</dl>';
  html += '</section>';

  // Section 3: CLI quick reference
  html += '<section class="card help-section">';
  html += '<h2>CLI 빠른 참조</h2>';
  html += '<h3>Collection</h3>';
  html += '<pre class="help-pre">hwicortex collection add &lt;path&gt;     # 컬렉션 등록\nhwicortex collection list             # 등록된 컬렉션 보기\nhwicortex collection rm &lt;name&gt;        # 제거</pre>';
  html += '<h3>Wiki</h3>';
  html += '<pre class="help-pre">hwicortex wiki create &lt;title&gt; --project &lt;name&gt; [--tags t1,t2]\nhwicortex wiki list [--project &lt;name&gt;] [--tag &lt;tag&gt;]\nhwicortex wiki show &lt;title&gt; --project &lt;name&gt;</pre>';
  html += '<h3>Indexing &amp; Search</h3>';
  html += '<pre class="help-pre">hwicortex update              # 변경 파일 재인덱싱\nhwicortex embed [--collection &lt;name&gt;]\nhwicortex search &lt;query&gt;\nhwicortex query &lt;query&gt;       # LLM 응답</pre>';
  html += '</section>';

  // Section 4: Dashboard usage
  html += '<section class="card help-section">';
  html += '<h2>대시보드 사용법</h2>';
  html += '<ul class="help-list">';
  html += '<li><strong>탭</strong>: Overview / Tags / Help. URL 해시(<code>#overview</code>)로 직접 이동 가능.</li>';
  html += '<li><strong>검색바</strong>: 입력 시 200ms 디바운스 드롭다운 추천. Enter로 전체 결과 페이지로 이동.</li>';
  html += '<li><strong>카드/태그 클릭</strong>: 해당 컬렉션/태그로 검색 필터링.</li>';
  html += '<li><strong>Refresh 버튼</strong>: 현재 뷰만 다시 로드 (전체 새로고침 없이).</li>';
  html += '<li><strong>키보드</strong>: ESC로 모달/드롭다운 닫기.</li>';
  html += '</ul>';
  html += '</section>';

  view.innerHTML = html;
}

function renderCollection(name) {
  var view = document.getElementById("view");
  view.innerHTML = "<p>Loading…</p>";
  fetchJson("/api/collection/" + encodeURIComponent(name)).then(function(data) {
    if (data.error) {
      view.innerHTML = '<div class="card"><p style="color:#c00">' + escHtml(data.error) + '</p>' +
        '<a href="#overview" style="color:#1a56db;font-size:13px">← Back to Overview</a></div>';
      return;
    }
    var html = '<h2 style="margin-bottom:10px"><a href="#overview" style="color:#1a56db;text-decoration:none">←</a> ' + escHtml(data.name || "") + '</h2>';
    var ctx = data.context ? escHtml(data.context) : "(none)";
    html += '<div class="meta">Path: ' + escHtml(data.path || "") +
      ' &middot; Pattern: ' + escHtml(data.pattern || "") +
      ' &middot; ' + escHtml(String((data.files || []).length)) + ' files' +
      ' &middot; Context: ' + ctx + '</div>';
    var files = data.files || [];
    if (files.length === 0) {
      html += '<div class="card"><p style="color:#666">Empty collection — no active files indexed.</p></div>';
    } else {
      html += '<table class="file-list"><thead><tr><th>Path</th><th>Title</th><th>Size</th><th>Modified</th></tr></thead><tbody>';
      for (var i = 0; i < files.length; i++) {
        var f = files[i];
        var sizeKb = f.size ? (f.size / 1024).toFixed(1) + " KB" : "—";
        var mod = f.modified ? relTime(f.modified) : "—";
        // NOTE(v1): raw file content modal deferred — adding a click handler for file preview
        // would require a new /api/file/:path endpoint; defer until requested (YAGNI).
        html += '<tr><td>' + escHtml(f.path || "") + '</td><td>' + escHtml(f.title || "—") +
          '</td><td>' + escHtml(sizeKb) + '</td><td>' + escHtml(mod) + '</td></tr>';
      }
      html += '</tbody></table>';
    }
    view.innerHTML = html;
  }).catch(function(err) {
    if (err.message && err.message.includes("404")) {
      view.innerHTML = '<div class="card"><p style="color:#c00">Collection not found: ' + escHtml(name || "") + '</p>' +
        '<a href="#overview" style="color:#1a56db;font-size:13px">← Back to Overview</a></div>';
    } else {
      renderError(err.message || String(err));
    }
  });
}

function renderWiki(project, slug) {
  var view = document.getElementById("view");
  view.innerHTML = "<p>Loading…</p>";
  fetchJson("/api/wiki/" + encodeURIComponent(project) + "/" + encodeURIComponent(slug)).then(function(data) {
    if (data.error) {
      view.innerHTML = '<div class="card"><p style="color:#c00">' + escHtml(data.error) + '</p>' +
        '<a href="#overview" style="color:#1a56db;font-size:13px">← Back to Overview</a></div>';
      return;
    }
    var m = data.meta || {};
    var tagBadges = (m.tags || []).map(function(tg) {
      return '<span class="badge badge-info">' + escHtml(tg) + '</span>';
    }).join(" ");
    var html = '<h2 style="margin-bottom:10px"><a href="#overview" style="color:#1a56db;text-decoration:none">←</a> ' + escHtml(m.title || slug) + '</h2>';
    html += '<div class="meta">Project: ' + escHtml(m.project || project) +
      ' &middot; Tags: ' + (tagBadges || '<span style="color:#999">none</span>') +
      ' &middot; Importance: ' + escHtml(String(m.importance || 0)) +
      ' &middot; Hits: ' + escHtml(String(m.hit_count || 0)) + '</div>';
    html += '<article class="wiki-body" id="wiki-article"></article>';
    var backlinks = data.backlinks || [];
    html += '<aside class="backlinks"><h3>Backlinks (' + escHtml(String(backlinks.length)) + ')</h3><ul>';
    if (backlinks.length === 0) {
      html += '<li style="color:#999">No backlinks found.</li>';
    } else {
      for (var i = 0; i < backlinks.length; i++) {
        var bl = backlinks[i];
        html += '<li>← <a href="#wiki/' + encodeURIComponent(m.project || project) + '/' + encodeURIComponent(bl.slug) + '">' + escHtml(bl.title) + '</a></li>';
      }
    }
    html += '</ul></aside>';
    view.innerHTML = html;
    var article = document.getElementById("wiki-article");
    if (typeof window.marked !== "undefined") {
      article.innerHTML = window.marked.parse(data.body || "");
    } else {
      article.innerHTML = "<pre>" + escHtml(data.body || "") + "</pre>";
    }
  }).catch(function(err) {
    if (err.message && err.message.includes("404")) {
      view.innerHTML = '<div class="card"><p style="color:#c00">Wiki page not found: ' + escHtml(project + "/" + slug) + '</p>' +
        '<a href="#overview" style="color:#1a56db;font-size:13px">← Back to Overview</a></div>';
    } else {
      renderError(err.message || String(err));
    }
  });
}

function renderSearch(q, coll, page) {
  page = page || 0;
  var view = document.getElementById("view");
  view.innerHTML = "<p>Loading…</p>";
  var limit = 20;
  var offset = page * limit;
  var collLabel = coll ? escHtml(coll) : "All collections";
  var url = "/api/search?q=" + encodeURIComponent(q) + (coll ? "&collection=" + encodeURIComponent(coll) : "") + "&limit=" + limit + "&offset=" + offset;
  fetchJson(url).then(function(data) {
    var total = data.total || 0;
    var results = data.results || [];
    var totalPages = Math.ceil(total / limit) || 1;
    var html = '<h2><a href="#overview" style="color:#1a56db;text-decoration:none">&#8592;</a> Search: &ldquo;' + escHtml(q) + '&rdquo; <small style="font-weight:normal;color:#666">in ' + collLabel + ', ' + escHtml(String(total)) + ' result' + (total === 1 ? "" : "s") + '</small></h2>';
    if (total === 0) {
      html += '<p style="margin-top:16px;color:#555">No results for &ldquo;' + escHtml(q) + '&rdquo;.</p>';
    } else {
      html += '<ol class="search-results">';
      for (var i = 0; i < results.length; i++) {
        var r = results[i];
        var target = (r.collection === "wiki")
          ? "#wiki/" + encodeURIComponent((r.path || "").split("/").slice(-2, -1)[0] || "") + "/" + encodeURIComponent((r.path || "").split("/").slice(-1)[0] || "").replace(/\\.md$/, "")
          : "#collection/" + encodeURIComponent(r.collection || "");
        html += '<li>';
        html += '<header><a href="' + target + '">' + escHtml(r.title || r.path || "") + '</a>';
        html += ' <small style="color:#888">' + escHtml(r.collection || "") + ' &middot; score ' + escHtml((r.score || 0).toFixed(3)) + '</small></header>';
        html += '<p class="snippet"></p>';
        html += '</li>';
      }
      html += '</ol>';
      // Pagination
      var prevDisabled = page === 0;
      var nextDisabled = (page + 1) * limit >= total;
      html += '<nav class="pagination">';
      html += '<button id="pg-prev"' + (prevDisabled ? ' disabled' : '') + '>&#8592; Prev</button>';
      html += '<span>Page ' + escHtml(String(page + 1)) + ' / ' + escHtml(String(totalPages)) + '</span>';
      html += '<button id="pg-next"' + (nextDisabled ? ' disabled' : '') + '>Next &#8594;</button>';
      html += '</nav>';
    }
    view.innerHTML = html;
    // Inject snippets via innerHTML to preserve <mark> tags
    var snippetEls = view.querySelectorAll(".snippet");
    for (var si = 0; si < results.length && si < snippetEls.length; si++) {
      snippetEls[si].innerHTML = results[si].snippet || "";
    }
    // Pagination click handlers
    var prevBtn = document.getElementById("pg-prev");
    var nextBtn = document.getElementById("pg-next");
    if (prevBtn) {
      prevBtn.addEventListener("click", function() {
        var qs = "q=" + encodeURIComponent(q) + (coll ? "&collection=" + encodeURIComponent(coll) : "") + "&page=" + (page - 1);
        location.hash = "search?" + qs;
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener("click", function() {
        var qs = "q=" + encodeURIComponent(q) + (coll ? "&collection=" + encodeURIComponent(coll) : "") + "&page=" + (page + 1);
        location.hash = "search?" + qs;
      });
    }
  }).catch(function(err) { renderError(err.message || String(err)); });
}

// ---- Search dropdown -----------------------------------------------
var searchInput = document.getElementById("search-input");
var searchDropdown = document.getElementById("search-dropdown");
var searchBar = document.getElementById("search-bar");
var debounceId = 0;

function closeDropdown() {
  searchDropdown.style.display = "none";
  searchDropdown.innerHTML = "";
}

function navigateToResult(r) {
  if (r.collection === "wiki") {
    var parts = (r.path || "").split("/");
    var project = parts.slice(-2, -1)[0] || "";
    var slug = (parts.slice(-1)[0] || "").replace(/\\.md$/, "");
    location.hash = "#wiki/" + encodeURIComponent(project) + "/" + encodeURIComponent(slug);
  } else {
    location.hash = "#collection/" + encodeURIComponent(r.collection || "");
  }
  closeDropdown();
}

function runDropdownSearch() {
  var q = searchInput.value.trim();
  if (!q) { closeDropdown(); return; }
  var coll = document.getElementById("collection-select").value;
  var url = "/api/search?q=" + encodeURIComponent(q) + (coll ? "&collection=" + encodeURIComponent(coll) : "") + "&limit=5";
  fetchJson(url).then(function(data) {
    var results = data.results || [];
    var total = data.total || 0;
    if (results.length === 0) { closeDropdown(); return; }
    var html = "";
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      html += '<div class="dropdown-item" data-idx="' + i + '">' +
        escHtml(r.title || r.path || "") +
        ' <small style="color:#888">' + escHtml(r.collection || "") + '</small></div>';
    }
    if (total > 5) {
      html += '<div class="dropdown-item dropdown-view-all" data-viewall="1">View all ' + escHtml(String(total)) + ' results</div>';
    }
    searchDropdown.innerHTML = html;
    searchDropdown.style.display = "block";
    // Attach click handlers
    searchDropdown.querySelectorAll(".dropdown-item[data-idx]").forEach(function(el) {
      var idx = parseInt(el.getAttribute("data-idx"), 10);
      el.addEventListener("click", function(e) {
        e.stopPropagation();
        navigateToResult(results[idx]);
      });
    });
    var viewAllEl = searchDropdown.querySelector("[data-viewall]");
    if (viewAllEl) {
      viewAllEl.addEventListener("click", function(e) {
        e.stopPropagation();
        var qs = "q=" + encodeURIComponent(q) + (coll ? "&collection=" + encodeURIComponent(coll) : "");
        location.hash = "search?" + qs;
        closeDropdown();
      });
    }
  }).catch(function() { closeDropdown(); });
}

searchInput.addEventListener("input", function() {
  clearTimeout(debounceId);
  debounceId = setTimeout(runDropdownSearch, 200);
});

// ---- Search bar ------------------------------------------------------
function doSearch() {
  const q = document.getElementById("search-input").value.trim();
  const coll = document.getElementById("collection-select").value;
  if (!q) return;
  const qs = "q=" + encodeURIComponent(q) + (coll ? "&collection=" + encodeURIComponent(coll) : "");
  location.hash = "search?" + qs;
  closeDropdown();
}

document.getElementById("search-btn").addEventListener("click", doSearch);
searchInput.addEventListener("keydown", function(e) {
  if (e.key === "Enter") { closeDropdown(); doSearch(); }
  if (e.key === "Escape") { closeDropdown(); searchInput.value = ""; }
});

document.addEventListener("click", function(e) {
  if (!searchBar.contains(e.target)) closeDropdown();
});

// Populate collection dropdown
fetchJson("/api/overview").then(function(data) {
  var sel = document.getElementById("collection-select");
  (data.collections || []).forEach(function(c) {
    var opt = document.createElement("option");
    opt.value = c.name;
    opt.textContent = c.name;
    sel.appendChild(opt);
  });
}).catch(function() { /* ignore dropdown population failure */ });

// ---- Refresh button --------------------------------------------------
document.getElementById("btn-refresh").addEventListener("click", function() { route(); });

// ---- Modal -----------------------------------------------------------
function openModal(html) {
  document.getElementById("modal-body").innerHTML = html;
  document.getElementById("modal-overlay").classList.remove("hidden");
}
function closeModal() {
  document.getElementById("modal-overlay").classList.add("hidden");
  document.getElementById("modal-body").innerHTML = "";
}
document.getElementById("modal-close").addEventListener("click", closeModal);
document.getElementById("modal-overlay").addEventListener("click", function(e) {
  if (e.target === this) closeModal();
});
document.addEventListener("keydown", function(e) {
  if (e.key === "Escape") closeModal();
});

// ---- Bootstrap -------------------------------------------------------
window.addEventListener("hashchange", route);
route();
</script>
</body>
</html>`;
}

export type WikiPageMeta = {
  title: string;
  project: string;
  slug: string;
  tags: string[];
  importance: number;
  hit_count: number;
  updated: string;
};

export type Overview = {
  vault: {
    path: string;
    totalDocs: number;
    totalCollections: number;
    totalWikiProjects: number;
    totalWikiPages: number;
    lastUpdate: string | null;
  };
  alerts: Alert[];
  collections: Array<{
    name: string;
    path: string;
    pattern: string;
    fileCount: number;
    lastUpdate: string | null;
    hasContext: boolean;
    overlapsWith: string[];
  }>;
  wiki: {
    projects: Array<{ name: string; pageCount: number }>;
    recent: WikiPageMeta[];
    topHits: WikiPageMeta[];
    highImportance: WikiPageMeta[];
  };
};

export function getOverview(store: Store, vaultDir: string): Overview {
  const db = store.db;
  const collections = getStoreCollections(db);
  const wikiPages = listWikiPages(vaultDir);

  const totalDocs = (
    db.prepare("SELECT COUNT(*) AS n FROM documents WHERE active=1").get() as { n: number }
  ).n;
  const lastUpdate = (
    db.prepare("SELECT MAX(modified_at) AS t FROM documents WHERE active=1").get() as {
      t: string | null;
    }
  ).t;

  // listWikiPages returns WikiMeta & { filePath: string } — fields are directly on the object
  const wikiMeta: WikiPageMeta[] = wikiPages.map((w) => ({
    title: w.title,
    project: w.project,
    slug: basename(w.filePath).replace(/\.md$/, "").toLowerCase(),
    tags: w.tags ?? [],
    importance: w.importance ?? 0,
    hit_count: w.hit_count ?? 0,
    updated: w.updated ?? "",
  }));

  const realCollections = collections.filter((c) => c.name !== "wiki");
  const collectionRows = realCollections.map((c) => {
    const fileCount = (
      db
        .prepare("SELECT COUNT(*) AS n FROM documents WHERE collection=? AND active=1")
        .get(c.name) as { n: number }
    ).n;
    const lu = (
      db
        .prepare("SELECT MAX(modified_at) AS t FROM documents WHERE collection=? AND active=1")
        .get(c.name) as { t: string | null }
    ).t;
    return {
      name: c.name,
      path: c.path,
      pattern: c.pattern ?? "**/*.md",
      fileCount,
      lastUpdate: lu,
      hasContext: Boolean(c.context && Object.keys(c.context).length > 0),
      overlapsWith: [] as string[],
    };
  });

  const alerts = detectAlerts(store, vaultDir);

  // Populate overlapsWith on each collection card using detectOverlaps directly
  const overlapPairs = detectOverlaps(collections);
  for (const card of collectionRows) {
    const overlapPartners: string[] = [];
    for (const [nameA, nameB] of overlapPairs) {
      if (nameA === card.name) overlapPartners.push(nameB);
      if (nameB === card.name) overlapPartners.push(nameA);
    }
    card.overlapsWith = overlapPartners;
  }

  const projectCounts = new Map<string, number>();
  for (const w of wikiMeta) {
    projectCounts.set(w.project, (projectCounts.get(w.project) ?? 0) + 1);
  }
  const wikiProjects = [...projectCounts.entries()]
    .map(([name, pageCount]) => ({ name, pageCount }))
    .sort((a, b) => b.pageCount - a.pageCount);

  return {
    vault: {
      path: vaultDir,
      totalDocs,
      totalCollections: realCollections.length,
      totalWikiProjects: projectCounts.size,
      totalWikiPages: wikiPages.length,
      lastUpdate,
    },
    alerts,
    collections: collectionRows,
    wiki: {
      projects: wikiProjects,
      recent: [...wikiMeta]
        .sort((a, b) => (b.updated ?? "").localeCompare(a.updated ?? ""))
        .slice(0, 5),
      topHits: [...wikiMeta].sort((a, b) => b.hit_count - a.hit_count).slice(0, 10),
      highImportance: wikiMeta.filter((w) => w.importance >= 5).slice(0, 5),
    },
  };
}

export function getTags(_store: Store, vaultDir: string): { tags: Array<{ name: string; count: number; projects: string[] }> } {
  const wiki = listWikiPages(vaultDir);
  const map = new Map<string, { count: number; projects: Set<string> }>();
  for (const w of wiki) {
    for (const tag of w.tags ?? []) {  // flat access — w.tags, NOT w.meta.tags
      const e = map.get(tag) ?? { count: 0, projects: new Set() };
      e.count++; e.projects.add(w.project);  // flat access — w.project, NOT w.meta.project
      map.set(tag, e);
    }
  }
  return {
    tags: [...map.entries()]
      .map(([name, v]) => ({ name, count: v.count, projects: [...v.projects].sort() }))
      .sort((a, b) => b.count - a.count),
  };
}

// ============================================================================
// Detail helpers
// ============================================================================

export type CollectionDetail = {
  name: string;
  path: string;
  pattern: string;
  context: string | null;
  files: Array<{ path: string; title: string | null; size: number; modified: string }>;
};

/**
 * Returns full detail for a named collection, or null if not found.
 * File size comes from the filesystem (defaults to 0 if unreadable).
 */
export function getCollectionDetail(store: Store, name: string): CollectionDetail | null {
  const db = store.db;
  const collections = getStoreCollections(db);
  const coll = collections.find((c) => c.name === name);
  if (!coll) return null;

  const rows = db
    .prepare("SELECT path, title, modified_at FROM documents WHERE collection=? AND active=1")
    .all(coll.name) as Array<{ path: string; title: string; modified_at: string }>;

  const files = rows.map((row) => {
    let size = 0;
    try {
      const stat = statSync(row.path);
      size = stat.size;
    } catch {
      // File not reachable — default size 0
    }
    return {
      path: row.path,
      title: row.title ?? null,
      size,
      modified: row.modified_at,
    };
  });

  const ctx = coll.context as Record<string, string> | undefined;
  return {
    name: coll.name,
    path: coll.path,
    pattern: coll.pattern ?? "**/*.md",
    context: ctx?.["/"] ?? ctx?.[""] ?? null,
    files,
  };
}

export type WikiPageDetail = {
  meta: {
    title: string;
    project: string;
    tags: string[];
    importance: number;
    hit_count: number;
    sources: string[];
    created: string | undefined;
    updated: string | undefined;
  };
  body: string;
  backlinks: Array<{ title: string; slug: string }>;
};

/**
 * Returns detail for a wiki page identified by project + slug, or null if not found.
 * Backlinks are computed by scanning all other pages in the same project for [[<title>]] refs.
 */
export function getWikiPageDetail(
  _store: Store,
  vaultDir: string,
  project: string,
  slug: string
): WikiPageDetail | null {
  const filePath = join(vaultDir, "wiki", project, `${slug}.md`);
  if (!existsSync(filePath)) return null;

  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  const { meta, body } = parseFrontmatter(content);

  // Compute backlinks: scan same-project pages for [[<meta.title>]]
  const allPages = listWikiPages(vaultDir, { project });
  const targetTitle = meta.title;
  const backlinkPattern = new RegExp(`\\[\\[${targetTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]\\]`);

  const backlinks: Array<{ title: string; slug: string }> = [];
  for (const page of allPages) {
    // Skip the target page itself
    if (basename(page.filePath).replace(/\.md$/, "").toLowerCase() === slug) continue;
    try {
      const pageContent = readFileSync(page.filePath, "utf-8");
      const { body: pageBody } = parseFrontmatter(pageContent);
      if (backlinkPattern.test(pageBody)) {
        backlinks.push({
          title: page.title,
          slug: basename(page.filePath).replace(/\.md$/, "").toLowerCase(),
        });
      }
    } catch {
      // Skip unreadable pages
    }
  }

  return {
    meta: {
      title: meta.title,
      project: meta.project,
      tags: meta.tags ?? [],
      importance: meta.importance ?? 0,
      hit_count: meta.hit_count ?? 0,
      sources: meta.sources ?? [],
      created: meta.created,
      updated: meta.updated,
    },
    body,
    backlinks,
  };
}

// ============================================================================
// FTS Search
// ============================================================================

export type SearchDashboardResult = {
  query: string;
  total: number;
  results: Array<{
    collection: string;
    path: string;
    title: string | null;
    snippet: string;
    score: number;
  }>;
};

export async function searchDashboard(
  store: Store,
  q: string,
  collection?: string,
  limit = 20,
  offset = 0,
): Promise<SearchDashboardResult> {
  const trimmed = q.trim();
  if (trimmed.length === 0) return { query: q, total: 0, results: [] };

  // Escape embedded double-quotes and wrap as an FTS5 phrase query.
  const phrase = `"${trimmed.replace(/"/g, '""')}"`;

  // Fetch a generous pool to compute true total. 1000 is more than the dashboard
  // will ever paginate through; if a query exceeds this, the count is capped (acceptable).
  const POOL_LIMIT = 1000;
  const raw = await searchFTS(store.db, phrase, POOL_LIMIT, collection);
  const sliced = raw.slice(offset, offset + limit);

  return {
    query: q,
    total: raw.length,
    results: sliced.map(r => ({
      collection: r.collectionName,
      path: r.displayPath,
      title: r.title ?? null,
      snippet: r.body?.slice(0, 200) ?? "",
      score: r.score,
    })),
  };
}
