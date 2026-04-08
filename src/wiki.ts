/**
 * wiki.ts — Core wiki library for HwiCortex.
 */

import { toFileName } from "./knowledge/classifier.js";
import { existsSync, readFileSync, unlinkSync, readdirSync, statSync } from "fs";
import { join, basename } from "path";
import { atomicWrite } from "./knowledge/vault-writer.js";

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
// CRUD
// ============================================================================

export type CreateOpts = {
  title: string;
  project: string;
  tags?: string[];
  sources?: string[];
  body?: string;
};

export function createWikiPage(vaultDir: string, opts: CreateOpts): string {
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
};

export function updateWikiPage(
  vaultDir: string,
  title: string,
  project: string,
  opts: UpdateOpts
): void {
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
  atomicWrite(page.filePath, `${fm}\n${body}`);
}

export function removeWikiPage(vaultDir: string, title: string, project: string): void {
  const filePath = resolveWikiPath(vaultDir, title, project);
  if (!existsSync(filePath)) {
    throw new Error(`Wiki page "${title}" not found at ${filePath}`);
  }
  unlinkSync(filePath);
}
