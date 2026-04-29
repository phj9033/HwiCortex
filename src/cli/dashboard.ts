import { basename, join } from "path";
import { existsSync, readFileSync, statSync } from "fs";
import type { Store } from "../store.js";
import { getStoreCollections } from "../store.js";
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

export function detectAlerts(store: Store, vaultDir: string): Alert[] {
  const alerts: Alert[] = [];
  const db = store.db;
  const collections = getStoreCollections(db);

  // 1. overlap (per pair) — flag when one path is a prefix of another
  for (let i = 0; i < collections.length; i++) {
    for (let j = i + 1; j < collections.length; j++) {
      const a = collections[i].path;
      const b = collections[j].path;
      if (a === b || a.startsWith(b + "/") || b.startsWith(a + "/")) {
        alerts.push({
          severity: "warn",
          code: "overlap",
          message: `Collections '${collections[i].name}' and '${collections[j].name}' index overlapping paths`,
          hint: `Consider 'hwicortex collection rm' on one of them`,
        });
      }
    }
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

  // Populate overlapsWith on each collection card from overlap alerts
  for (const card of collectionRows) {
    const overlapPartners: string[] = [];
    for (const alert of alerts) {
      if (alert.code === "overlap") {
        // Parse the two names out of the message pattern: "Collections 'A' and 'B' index overlapping paths"
        const match = alert.message.match(/^Collections '(.+)' and '(.+)' index overlapping paths/);
        if (match) {
          const [, nameA, nameB] = match;
          if (nameA === card.name) overlapPartners.push(nameB);
          if (nameB === card.name) overlapPartners.push(nameA);
        }
      }
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

  return {
    name: coll.name,
    path: coll.path,
    pattern: coll.pattern ?? "**/*.md",
    context: (coll.context as Record<string, string> | undefined)?.[""] ?? null,
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
