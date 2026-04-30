import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { parse as parseYaml } from "yaml";
import { createHash } from "crypto";
import { TopicSpec, parseTopic } from "./schema.js";
import { topicYamlPath } from "./paths.js";

export async function loadTopic(id: string, vaultPath: string): Promise<TopicSpec> {
  const path = topicYamlPath(vaultPath, id);
  if (!existsSync(path)) {
    throw new Error(`topic not found: ${id} (expected at ${path})`);
  }
  const raw = await readFile(path, "utf-8");
  return parseTopic(parseYaml(raw));
}

export function adhocTopicFromPrompt(prompt: string): TopicSpec {
  const slug = slugify(prompt) + "-" + createHash("sha256").update(prompt).digest("hex").slice(0, 6);
  return parseTopic({
    id: slug,
    title: prompt,
    sources: [{ type: "web-search", queries: [prompt] }],
  });
}

function slugify(s: string): string {
  return s.toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/^-+|-+$/g, "")
    .replace(/[^a-z0-9-]/g, "x") || "topic";
}
