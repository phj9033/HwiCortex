import type { AstRelation } from "./ast.js";

/**
 * Extract Obsidian-style wiki links from markdown content.
 * Ignores links inside fenced code blocks and inline code.
 */
export function extractWikiLinks(content: string): AstRelation[] {
  // Remove fenced code blocks
  const withoutFenced = content.replace(/```[\s\S]*?```/g, "");
  // Remove inline code
  const withoutCode = withoutFenced.replace(/`[^`]+`/g, "");

  const pattern = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  const seen = new Set<string>();
  const relations: AstRelation[] = [];

  for (const match of withoutCode.matchAll(pattern)) {
    const targetRef = match[1]?.trim();
    if (targetRef && !seen.has(targetRef)) {
      seen.add(targetRef);
      relations.push({ type: "wiki_link", targetRef });
    }
  }

  return relations;
}
