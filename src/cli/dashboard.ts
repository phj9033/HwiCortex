import { basename } from "path";
import type { Store } from "../store.js";
import { getStoreCollections } from "../store.js";
import { listWikiPages } from "../wiki.js";

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
  alerts: never[];
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

  return {
    vault: {
      path: vaultDir,
      totalDocs,
      totalCollections: collections.length,
      totalWikiPages: wikiPages.length,
      lastUpdate,
    },
    alerts: [],
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
      // Strip surrounding quotes that may come from JSON-formatted YAML
      const cleanTag = tag.replace(/^"(.*)"$/, '$1');
      const e = map.get(cleanTag) ?? { count: 0, projects: new Set() };
      e.count++; e.projects.add(w.project);  // flat access — w.project, NOT w.meta.project
      map.set(cleanTag, e);
    }
  }
  return {
    tags: [...map.entries()]
      .map(([name, v]) => ({ name, count: v.count, projects: [...v.projects].sort() }))
      .sort((a, b) => b.count - a.count),
  };
}
