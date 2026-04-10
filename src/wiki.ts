/**
 * wiki.ts — Core wiki library for HwiCortex.
 */

import { toFileName } from "./knowledge/classifier.js";
import { existsSync, readFileSync, unlinkSync, readdirSync, statSync } from "fs";
import { join, basename } from "path";
import { createHash } from "crypto";
import { atomicWrite } from "./knowledge/vault-writer.js";
import type { Store } from "./store.js";
import { insertDocument, insertContent, getDocumentId, upsertFTS, deactivateDocument, upsertStoreCollection } from "./store.js";

// ============================================================================
// Slug generation
// ============================================================================

/**
 * Convert a wiki page title to a filename slug.
 * Reuses classifier.ts toFileName() — preserves Unicode letters (\p{L}).
 * Returns slug without .md extension.
 */
export function toWikiSlug(title: string): string {
  const filename = toFileName(title); // returns "slug.md"
  return filename.replace(/\.md$/, "");
}

// ============================================================================
// Frontmatter
// ============================================================================

export type WikiMeta = {
  title: string;
  project: string;
  tags: string[];
  sources: string[];
  related: string[];
  count_show: number;
  count_append: number;
  count_update: number;
  count_link: number;
  count_merge: number;
  count_search_hit: number;
  count_query_hit: number;
  importance: number;
  hit_count: number;
  last_accessed: string;
  created?: string;
  updated?: string;
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Build YAML frontmatter string from metadata.
 */
export function buildFrontmatter(meta: Omit<WikiMeta, "created" | "updated"> & { created?: string; updated?: string }): string {
  const created = meta.created || today();
  const updated = meta.updated || today();
  const tags = meta.tags.length > 0 ? `[${meta.tags.join(", ")}]` : "[]";
  const sources = meta.sources.length > 0 ? `[${meta.sources.join(", ")}]` : "[]";
  const related = meta.related.length > 0 ? `[${meta.related.join(", ")}]` : "[]";

  const lines = [
    "---",
    `title: ${meta.title}`,
    `project: ${meta.project}`,
    `tags: ${tags}`,
    `sources: ${sources}`,
    `related: ${related}`,
  ];

  // Only emit count fields if any count is non-zero
  const hasAnyCounts = meta.count_show || meta.count_append || meta.count_update ||
    meta.count_link || meta.count_merge || meta.count_search_hit || meta.count_query_hit;

  if (hasAnyCounts) {
    lines.push(`count_show: ${meta.count_show}`);
    lines.push(`count_append: ${meta.count_append}`);
    lines.push(`count_update: ${meta.count_update}`);
    lines.push(`count_link: ${meta.count_link}`);
    lines.push(`count_merge: ${meta.count_merge}`);
    lines.push(`count_search_hit: ${meta.count_search_hit}`);
    lines.push(`count_query_hit: ${meta.count_query_hit}`);
    lines.push(`importance: ${meta.importance}`);
    lines.push(`hit_count: ${meta.hit_count}`);
  }

  if (meta.last_accessed) {
    lines.push(`last_accessed: ${meta.last_accessed}`);
  }

  lines.push(`created: ${created}`);
  lines.push(`updated: ${updated}`);
  lines.push("---");

  return lines.join("\n");
}

/**
 * Parse YAML frontmatter and body from a wiki markdown file.
 * Simple parser — does not depend on a YAML library.
 */
export function parseFrontmatter(content: string): { meta: WikiMeta; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    throw new Error("Invalid wiki page: missing frontmatter");
  }

  const yamlBlock = match[1]!;
  const body = match[2] ?? "";

  const get = (key: string): string => {
    const m = yamlBlock.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
    return m ? m[1]!.trim() : "";
  };

  const getArray = (key: string): string[] => {
    const raw = get(key);
    if (!raw || raw === "[]") return [];
    const inner = raw.replace(/^\[/, "").replace(/\]$/, "");
    return inner.split(",").map((s) => s.trim()).filter(Boolean);
  };

  const getInt = (key: string): number => {
    const raw = get(key);
    if (!raw) return 0;
    const n = parseInt(raw, 10);
    return isNaN(n) ? 0 : n;
  };

  return {
    meta: {
      title: get("title"),
      project: get("project"),
      tags: getArray("tags"),
      sources: getArray("sources"),
      related: getArray("related"),
      count_show: getInt("count_show"),
      count_append: getInt("count_append"),
      count_update: getInt("count_update"),
      count_link: getInt("count_link"),
      count_merge: getInt("count_merge"),
      count_search_hit: getInt("count_search_hit"),
      count_query_hit: getInt("count_query_hit"),
      importance: getInt("importance"),
      hit_count: getInt("hit_count"),
      last_accessed: get("last_accessed"),
      created: get("created"),
      updated: get("updated"),
    },
    body,
  };
}

// ============================================================================
// Path resolution
// ============================================================================

export function resolveWikiPath(vaultDir: string, title: string, project: string): string {
  const slug = toWikiSlug(title);
  return join(vaultDir, "wiki", project, `${slug}.md`);
}

// ============================================================================
// FTS Indexing helpers
// ============================================================================

const WIKI_COLLECTION = "wiki";

/**
 * Ensure the "wiki" collection exists in the store_collections table.
 * Uses upsertStoreCollection so it's safe to call repeatedly.
 */
export function ensureWikiCollection(store: Store, vaultDir: string): void {
  upsertStoreCollection(store.db, WIKI_COLLECTION, {
    path: join(vaultDir, "wiki"),
    pattern: "**/*.md",
    type: "static",
  });
}

/**
 * Compute a content hash (first 12 hex chars of SHA-256).
 */
function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

/**
 * Index a wiki page into the documents table and FTS5.
 * Safe to call on both create and update (insertDocument does upsert).
 */
async function indexWikiPage(
  store: Store,
  project: string,
  filename: string,
  title: string,
  content: string,
): Promise<void> {
  const db = store.db;
  const now = new Date().toISOString();
  const hash = contentHash(content);
  const docPath = `${project}/${filename}`;

  insertContent(db, hash, content, now);
  insertDocument(db, WIKI_COLLECTION, docPath, title, hash, now, now, {
    source_type: "wiki",
    project,
  });

  const docId = getDocumentId(db, WIKI_COLLECTION, docPath);
  if (docId) {
    await upsertFTS(db, docId, `${WIKI_COLLECTION}/${docPath}`, title, content);
  }
}

/**
 * Deactivate a wiki page in the documents table (marks active=0).
 */
function deindexWikiPage(store: Store, project: string, filename: string): void {
  const docPath = `${project}/${filename}`;
  deactivateDocument(store.db, WIKI_COLLECTION, docPath);
}

// ============================================================================
// CRUD
// ============================================================================

export type CreateOpts = {
  title: string;
  project: string;
  tags?: string[];
  sources?: string[];
  body?: string;
  store?: Store;
};

export async function createWikiPage(vaultDir: string, opts: CreateOpts): Promise<string> {
  const filePath = resolveWikiPath(vaultDir, opts.title, opts.project);

  if (existsSync(filePath)) {
    throw new Error(
      `Wiki page "${opts.title}" already exists at ${filePath}. Use 'hwicortex wiki update' instead.`
    );
  }

  const fm = buildFrontmatter({
    title: opts.title,
    project: opts.project,
    tags: opts.tags ?? [],
    sources: opts.sources ?? [],
    related: [],
    count_show: 0,
    count_append: 0,
    count_update: 0,
    count_link: 0,
    count_merge: 0,
    count_search_hit: 0,
    count_query_hit: 0,
    importance: 0,
    hit_count: 0,
    last_accessed: "",
  });

  const content = opts.body ? `${fm}\n\n${opts.body}\n` : `${fm}\n`;
  atomicWrite(filePath, content);

  if (opts.store) {
    ensureWikiCollection(opts.store, vaultDir);
    const slug = toWikiSlug(opts.title);
    await indexWikiPage(opts.store, opts.project, `${slug}.md`, opts.title, content);
  }

  return filePath;
}

export type WikiPage = { meta: WikiMeta; body: string; filePath: string };

export function getWikiPage(vaultDir: string, title: string, project: string): WikiPage {
  const filePath = resolveWikiPath(vaultDir, title, project);
  if (!existsSync(filePath)) {
    throw new Error(`Wiki page "${title}" not found at ${filePath}`);
  }
  const content = readFileSync(filePath, "utf-8");
  const { meta, body } = parseFrontmatter(content);
  return { meta, body, filePath };
}

export type WikiPageMeta = WikiMeta & { filePath: string };

export function listWikiPages(
  vaultDir: string,
  filter?: { project?: string; tag?: string }
): WikiPageMeta[] {
  const wikiDir = join(vaultDir, "wiki");
  if (!existsSync(wikiDir)) return [];

  const results: WikiPageMeta[] = [];
  const projects = filter?.project
    ? [filter.project]
    : readdirSync(wikiDir).filter((d) => statSync(join(wikiDir, d)).isDirectory());

  for (const proj of projects) {
    const projDir = join(wikiDir, proj);
    if (!existsSync(projDir)) continue;

    for (const file of readdirSync(projDir)) {
      if (!file.endsWith(".md") || file.startsWith("_")) continue;
      const filePath = join(projDir, file);
      try {
        const content = readFileSync(filePath, "utf-8");
        const { meta } = parseFrontmatter(content);
        if (filter?.tag && !meta.tags.includes(filter.tag)) continue;
        results.push({ ...meta, filePath });
      } catch {
        // Skip files with invalid frontmatter
      }
    }
  }

  return results;
}

export type UpdateOpts = {
  append?: string;
  body?: string;
  tags?: string[];
  addSource?: string;
  store?: Store;
};

export async function updateWikiPage(
  vaultDir: string,
  title: string,
  project: string,
  opts: UpdateOpts
): Promise<void> {
  const page = getWikiPage(vaultDir, title, project);
  const meta = { ...page.meta };
  let body = page.body;

  if (opts.tags) meta.tags = opts.tags;
  if (opts.addSource && !meta.sources.includes(opts.addSource)) {
    meta.sources = [...meta.sources, opts.addSource];
  }
  meta.updated = new Date().toISOString().slice(0, 10);

  if (opts.body !== undefined) {
    body = "\n" + opts.body + "\n";
  } else if (opts.append) {
    body = body.trimEnd() + "\n\n" + opts.append + "\n";
  }

  const fm = buildFrontmatter(meta);
  const content = `${fm}\n${body}`;
  atomicWrite(page.filePath, content);

  if (opts.store) {
    ensureWikiCollection(opts.store, vaultDir);
    const slug = toWikiSlug(title);
    await indexWikiPage(opts.store, project, `${slug}.md`, title, content);
  }
}

export function removeWikiPage(vaultDir: string, title: string, project: string, store?: Store): void {
  const filePath = resolveWikiPath(vaultDir, title, project);
  if (!existsSync(filePath)) {
    throw new Error(`Wiki page "${title}" not found at ${filePath}`);
  }
  unlinkSync(filePath);

  if (store) {
    const slug = toWikiSlug(title);
    deindexWikiPage(store, project, `${slug}.md`);
  }
}

// ============================================================================
// Linking
// ============================================================================

/**
 * Sync the ## 관련 문서 section at end of file from frontmatter related:[].
 * Replaces everything from last "## 관련 문서" heading to EOF.
 */
export function syncRelatedSection(filePath: string): void {
  const content = readFileSync(filePath, "utf-8");
  const { meta, body } = parseFrontmatter(content);

  // Strip existing related section (last occurrence of ## 관련 문서 to EOF)
  const sectionRegex = /\n## 관련 문서\n[\s\S]*$/;
  const cleanBody = body.replace(sectionRegex, "").trimEnd();

  let newContent = `${buildFrontmatter(meta)}\n${cleanBody}\n`;

  if (meta.related.length > 0) {
    const links = meta.related.map((r) => `- [[${r}]]`).join("\n");
    newContent += `\n## 관련 문서\n${links}\n`;
  }

  atomicWrite(filePath, newContent);
}

export function linkPages(vaultDir: string, titleA: string, titleB: string, project: string): void {
  // Update A's related
  const pageA = getWikiPage(vaultDir, titleA, project);
  if (!pageA.meta.related.includes(titleB)) {
    pageA.meta.related.push(titleB);
    pageA.meta.updated = new Date().toISOString().slice(0, 10);
    const bodyA = pageA.body.replace(/\n## 관련 문서\n[\s\S]*$/, "").trimEnd();
    atomicWrite(pageA.filePath, `${buildFrontmatter(pageA.meta)}\n${bodyA}\n`);
    syncRelatedSection(pageA.filePath);
  }

  // Update B's related
  const pageB = getWikiPage(vaultDir, titleB, project);
  if (!pageB.meta.related.includes(titleA)) {
    pageB.meta.related.push(titleA);
    pageB.meta.updated = new Date().toISOString().slice(0, 10);
    const bodyB = pageB.body.replace(/\n## 관련 문서\n[\s\S]*$/, "").trimEnd();
    atomicWrite(pageB.filePath, `${buildFrontmatter(pageB.meta)}\n${bodyB}\n`);
    syncRelatedSection(pageB.filePath);
  }
}

export function unlinkPages(vaultDir: string, titleA: string, titleB: string, project: string): void {
  for (const [title, target] of [[titleA, titleB], [titleB, titleA]] as const) {
    const page = getWikiPage(vaultDir, title, project);
    page.meta.related = page.meta.related.filter((r) => r !== target);
    page.meta.updated = new Date().toISOString().slice(0, 10);
    const body = page.body.replace(/\n## 관련 문서\n[\s\S]*$/, "").trimEnd();
    atomicWrite(page.filePath, `${buildFrontmatter(page.meta)}\n${body}\n`);
    syncRelatedSection(page.filePath);
  }
}

export function getLinks(
  vaultDir: string,
  title: string,
  project: string
): { related: string[]; backlinks: string[] } {
  const page = getWikiPage(vaultDir, title, project);
  const related = page.meta.related;

  // Compute backlinks: scan all wiki pages for [[title]] in body
  const allPages = listWikiPages(vaultDir);
  const pattern = `[[${title}]]`;
  const backlinks = allPages
    .filter((p) => p.title !== title)
    .filter((p) => {
      const content = readFileSync(p.filePath, "utf-8");
      return content.includes(pattern);
    })
    .map((p) => p.title);

  return { related, backlinks };
}

// ============================================================================
// Index Generation
// ============================================================================

/**
 * Generate _index.md for a project, grouped by tags.
 * Returns the file path of the generated index.
 */
export function generateIndex(vaultDir: string, project: string): string {
  const pages = listWikiPages(vaultDir, { project });
  const indexPath = join(vaultDir, "wiki", project, "_index.md");

  // Group by tag
  const tagGroups = new Map<string, WikiPageMeta[]>();
  for (const page of pages) {
    const tags = page.tags.length > 0 ? page.tags : ["uncategorized"];
    for (const tag of tags) {
      if (!tagGroups.has(tag)) tagGroups.set(tag, []);
      tagGroups.get(tag)!.push(page);
    }
  }

  // Sort tags alphabetically
  const sortedTags = [...tagGroups.keys()].sort();

  const lines: string[] = [
    "---",
    `title: ${project} 위키 인덱스`,
    `generated: ${new Date().toISOString().slice(0, 10)}`,
    "---",
    "",
    `# ${project}`,
  ];

  for (const tag of sortedTags) {
    lines.push("", `## ${tag}`);
    const tagPages = tagGroups.get(tag)!.sort((a, b) => a.title.localeCompare(b.title));
    for (const page of tagPages) {
      const content = readFileSync(page.filePath, "utf-8");
      const { body } = parseFrontmatter(content);
      const firstLine = body.trim().split("\n")[0]?.trim() || "";
      const summary = firstLine.length > 60 ? firstLine.slice(0, 60) + "..." : firstLine;
      const suffix = summary ? ` — ${summary}` : "";
      lines.push(`- [[${page.title}]]${suffix}`);
    }
  }

  lines.push("");
  atomicWrite(indexPath, lines.join("\n"));
  return indexPath;
}
