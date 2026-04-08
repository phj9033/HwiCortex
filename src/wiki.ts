/**
 * wiki.ts — Core wiki library for HwiCortex.
 */

import { toFileName } from "./knowledge/classifier.js";

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
