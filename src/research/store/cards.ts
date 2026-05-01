import { mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { stringify as yamlStringify, parse as yamlParse } from "yaml";
import { sourcesDir } from "../topic/paths.js";
import type { Card } from "../core/types.js";

export function cardPath(vault: string, topicId: string, sourceId: string): string {
  return join(sourcesDir(vault, topicId), `${sourceId}.md`);
}

export function readCardFrontmatter(path: string): { body_hash?: string } | null {
  if (!existsSync(path)) return null;
  const txt = readFileSync(path, "utf-8");
  const m = txt.match(/^---\n([\s\S]*?)\n---/);
  if (!m || m[1] === undefined) return null;
  try {
    return yamlParse(m[1]);
  } catch {
    return null;
  }
}

export function writeCard(vault: string, c: Card): void {
  const dir = sourcesDir(vault, c.topic_id);
  mkdirSync(dir, { recursive: true });
  const fm = {
    type: "research-card",
    topic: c.topic_id,
    source_id: c.source_id,
    url: c.url,
    title: c.title,
    author: c.author,
    published: c.published,
    fetched: c.fetched,
    language: c.language,
    tags: c.tags,
    body_hash: c.body_hash,
    hwicortex_index: true,
  };
  const md = `---
${yamlStringify(fm).trimEnd()}
---

# ${c.title}

## TL;DR

${c.tldr.map(b => "- " + b).join("\n")}

## 핵심 발췌

${c.excerpts.length === 0 ? "_(none)_" : c.excerpts.map(q => "> " + q.replace(/\n/g, " ")).join("\n\n")}

## 메모

<!-- analysis lives in synthesis notes -->

[원문 링크](${c.url})
`;
  writeFileSync(cardPath(vault, c.topic_id, c.source_id), md);
}
