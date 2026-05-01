import { mkdirSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { stringify as yamlStringify } from "yaml";
import { draftsDir } from "../topic/paths.js";
import type { Draft } from "../core/types.js";

export function draftPath(vault: string, topicId: string, dateSlug: string): string {
  return join(draftsDir(vault, topicId), `${dateSlug}.md`);
}

export function writeDraftFile(vault: string, d: Draft): string {
  const dir = draftsDir(vault, d.topic_id);
  mkdirSync(dir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  let n = 1;
  let path = draftPath(vault, d.topic_id, `${today}-${d.slug}`);
  while (existsSync(path)) {
    n += 1;
    path = draftPath(vault, d.topic_id, `${today}-${d.slug}-${n}`);
  }
  const fm = {
    type: "research-draft",
    topic: d.topic_id,
    slug: d.slug,
    prompt: d.prompt,
    generated_at: d.generated_at,
    model: d.model,
    context_sources: d.context_sources,
    include_vault: d.include_vault,
    hwicortex_index: false,
  };
  writeFileSync(path, `---\n${yamlStringify(fm).trimEnd()}\n---\n\n${d.body_md}\n`);
  return path;
}
