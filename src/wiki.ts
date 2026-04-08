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

  return [
    "---",
    `title: ${meta.title}`,
    `project: ${meta.project}`,
    `tags: ${tags}`,
    `sources: ${sources}`,
    `related: ${related}`,
    `created: ${created}`,
    `updated: ${updated}`,
    "---",
  ].join("\n");
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

  return {
    meta: {
      title: get("title"),
      project: get("project"),
      tags: getArray("tags"),
      sources: getArray("sources"),
      related: getArray("related"),
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
      `Wiki page "${opts.title}" already exists at ${filePath}. Use 'qmd wiki update' instead.`
    );
  }

  const fm = buildFrontmatter({
    title: opts.title,
    project: opts.project,
    tags: opts.tags ?? [],
    sources: opts.sources ?? [],
    related: [],
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
