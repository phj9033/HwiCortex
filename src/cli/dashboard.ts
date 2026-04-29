import { basename, join } from "path";
import { existsSync, readFileSync, statSync } from "fs";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import type { Store } from "../store.js";
import { getStoreCollections, searchFTS } from "../store.js";
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
      const a = collections[i].path, b = collections[j].path;
      if (a === b || a.startsWith(b + "/") || b.startsWith(a + "/")) {
        pairs.push([collections[i].name, collections[j].name]);
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

export async function runDashboard(_opts: DashboardOptions): Promise<void> {
  throw new Error("not implemented");
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
      if (cm) {
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
      if (wm) {
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
.search-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: #fff;
  border: 1px solid #ccc;
  border-top: none;
  border-radius: 0 0 6px 6px;
  max-height: calc(5 * 44px);
  overflow-y: auto;
  z-index: 150;
}
.dropdown-item {
  padding: 10px 12px;
  cursor: pointer;
  border-bottom: 1px solid #f0f0f0;
}
.dropdown-item:hover { background: #f5f5f5; }
.dropdown-item:last-child { border-bottom: none; }

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
</style>
</head>
<body>

<header>
  <div class="header-inner">
    <span class="header-title">HwiCortex</span>
    <nav class="tabs">
      <a href="#overview" class="tab" id="tab-overview">Overview</a>
      <a href="#tags" class="tab" id="tab-tags">Tags</a>
    </nav>
    <div class="spacer"></div>
    <button class="btn-refresh" id="btn-refresh">Refresh</button>
  </div>
</header>

<section id="search-bar">
  <div class="search-inner">
    <input id="search-input" type="search" placeholder="Search documents…" autocomplete="off">
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
    return { view: "search", params: { q: sp.get("q") || "", collection: sp.get("collection") || "" } };
  }

  return { view: "overview", params: {} };
}

function setActiveTab(view) {
  document.querySelectorAll(".tab").forEach(function(el) { el.classList.remove("active"); });
  if (view === "overview") document.getElementById("tab-overview").classList.add("active");
  if (view === "tags")     document.getElementById("tab-tags").classList.add("active");
}

function route() {
  const { view, params } = parseHash();
  setActiveTab(view);
  try {
    if (view === "overview") { renderOverview(); return; }
    if (view === "tags")     { renderTags();    return; }
    if (view === "collection") { renderCollection(params.name); return; }
    if (view === "wiki")     { renderWiki(params.project, params.slug); return; }
    if (view === "search")   { renderSearch(params.q, params.collection); return; }
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

// ---- Render stubs (replaced by Tasks 10-12) --------------------------
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
    html += escHtml(String(v.totalDocs || 0)) + " doc" + (v.totalDocs === 1 ? "" : "s") + " &middot; ";
    html += escHtml(String(v.totalWikiPages || 0)) + " wiki page" + (v.totalWikiPages === 1 ? "" : "s") + " &middot; ";
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

    // Widget B — Collection Cards
    var colls = data.collections || [];
    if (colls.length === 0) {
      html += '<div class="card"><p>No collections yet. Run <code>hwicortex collection add &lt;path&gt;</code></p></div>';
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

    // Widget C — Wiki Activity
    var wiki = data.wiki || {};
    var recent = wiki.recent || [];
    var topHits = wiki.topHits || [];
    var highImp = wiki.highImportance || [];

    var noWiki = recent.length === 0 && topHits.length === 0 && highImp.length === 0;
    var noColls = colls.length === 0;

    if (noWiki && noColls) {
      // Replace the collection empty-state with a combined welcome
      html = '<div class="card"><h2 style="margin-bottom:10px">Welcome to HwiCortex Dashboard</h2>';
      html += '<p style="margin-bottom:8px">No collections or wiki pages found. Get started:</p>';
      html += '<pre style="background:#f5f5f5;padding:10px;border-radius:6px;font-size:13px">';
      html += 'hwicortex collection add &lt;path&gt;\nhwicortex embed --collection &lt;name&gt;\nhwicortex wiki create &lt;project&gt; &lt;title&gt;</pre></div>';
    } else if (!noWiki) {
      html += '<div class="card">';
      html += '<div class="card-title">Wiki Activity</div>';
      html += '<div class="wiki-grid">';

      // Recent
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

      // Top hits
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

      // High importance
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

      html += '</div></div>';
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
  document.getElementById("view").innerHTML = "<p>Stub: Tags</p>";
}

function renderCollection(name) {
  document.getElementById("view").innerHTML = "<p>Stub: Collection " + escHtml(name || "") + "</p>";
}

function renderWiki(project, slug) {
  document.getElementById("view").innerHTML =
    "<p>Stub: Wiki " + escHtml(project || "") + "/" + escHtml(slug || "") + "</p>";
}

function renderSearch(q, coll) {
  document.getElementById("view").innerHTML =
    "<p>Stub: Search q=" + escHtml(q || "") + " collection=" + escHtml(coll || "") + "</p>";
}

// ---- Search bar ------------------------------------------------------
function doSearch() {
  const q = document.getElementById("search-input").value.trim();
  const coll = document.getElementById("collection-select").value;
  if (!q) return;
  const qs = "q=" + encodeURIComponent(q) + (coll ? "&collection=" + encodeURIComponent(coll) : "");
  location.hash = "search?" + qs;
}

document.getElementById("search-btn").addEventListener("click", doSearch);
document.getElementById("search-input").addEventListener("keydown", function(e) {
  if (e.key === "Enter") doSearch();
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

  const collectionRows = collections.map((c) => {
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

  return {
    vault: {
      path: vaultDir,
      totalDocs,
      totalCollections: collections.length,
      totalWikiPages: wikiPages.length,
      lastUpdate,
    },
    alerts,
    collections: collectionRows,
    wiki: {
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
