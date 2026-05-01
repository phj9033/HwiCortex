import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { stringify as yamlStringify } from "yaml";
import { notesDir } from "../topic/paths.js";
import type { SynthesisNote } from "../core/types.js";

export function synthesisPath(vault: string, topicId: string, subtopic: string): string {
  return join(notesDir(vault, topicId), `${subtopic}.md`);
}

export function writeSynthesis(vault: string, n: SynthesisNote): void {
  const dir = notesDir(vault, n.topic_id);
  mkdirSync(dir, { recursive: true });
  const fm = {
    type: "research-synthesis",
    topic: n.topic_id,
    subtopic: n.subtopic,
    generated_at: n.generated_at,
    model: n.model,
    source_cards: n.source_cards,
    hwicortex_index: true,
  };
  const md = `---\n${yamlStringify(fm).trimEnd()}\n---\n\n${n.body_md}\n`;
  writeFileSync(synthesisPath(vault, n.topic_id, n.subtopic), md);
}
