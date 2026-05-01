import { mkdirSync, existsSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";
import { stringify as yamlStringify } from "yaml";
import { topicYamlPath } from "./paths.js";

export function scaffoldTopic(vault: string, id: string, fromPrompt?: string): string {
  if (!/^[a-z0-9-]+$/.test(id)) {
    throw new Error("topic id must match ^[a-z0-9-]+$");
  }
  const path = topicYamlPath(vault, id);
  if (existsSync(path)) throw new Error("topic already exists: " + path);
  mkdirSync(join(vault, "research", "topics"), { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const tpl = {
    id,
    title: fromPrompt ?? id,
    description: "",
    languages: ["ko", "en"],
    created_at: today,
    updated_at: today,
    sources: fromPrompt
      ? [{ type: "web-search", queries: [fromPrompt], top_k_per_query: 10 }]
      : [],
    filters: {
      min_words: 200,
      max_words: 50000,
      exclude_domains: [],
      require_lang: null,
    },
    budget: {
      max_new_urls: 100,
      max_total_bytes: 50000000,
    },
  };
  writeFileSync(path, yamlStringify(tpl));
  return path;
}

export function listTopicIds(vault: string): string[] {
  const dir = join(vault, "research", "topics");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith(".yml"))
    .map(f => f.slice(0, -4));
}
