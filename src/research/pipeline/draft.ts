import { join } from "path";
import { createStore, type QMDStore } from "../../index.js";
import { notesDir } from "../topic/paths.js";
import { writeDraftFile } from "../store/drafts.js";
import { writeDraft, type DraftStyle } from "../llm/draft.js";
import { createAnthropicClient, type LlmClient } from "../llm/client.js";
import type { TopicSpec } from "../topic/schema.js";

export type DraftOptions = {
  topic: TopicSpec;
  vault: string;
  prompt: string;
  slug?: string;
  topK?: number;
  includeVault?: boolean;
  style?: DraftStyle;
  model: string;
  /** SQLite path for the per-topic RAG index (defaults under _staging). */
  dbPath?: string;
  requireContext?: boolean;
  /** Test seam: inject a custom LLM client. Unset = production Anthropic client. */
  _llmClient?: LlmClient;
  /** Test seam: inject a pre-built store (skips createStore + update + embed). */
  _store?: QMDStore;
};

export type DraftResult = {
  path: string;
  cost_usd: number;
  cited: string[];
};

export function defaultDraftDbPath(vault: string, topicId: string): string {
  return join(vault, "research", "_staging", topicId, "draft-rag.sqlite");
}

export async function draft(opts: DraftOptions): Promise<DraftResult> {
  const { topic, vault, prompt } = opts;
  const slug = opts.slug ?? slugFromPrompt(prompt);
  const collectionPath = opts.includeVault ? vault : notesDir(vault, topic.id);
  const collectionName = `research-${topic.id}`;

  let store: QMDStore;
  let ownsStore = false;
  if (opts._store) {
    store = opts._store;
  } else {
    store = await createStore({
      dbPath: opts.dbPath ?? defaultDraftDbPath(vault, topic.id),
      config: {
        collections: { [collectionName]: { path: collectionPath, pattern: "**/*.md" } },
      },
    });
    ownsStore = true;
    await store.update();
    await store.embed({});
  }

  try {
    const hits = await store.search({
      query: prompt,
      collections: [collectionName],
      limit: opts.topK ?? 12,
      rerank: true,
    });

    if (hits.length === 0 && opts.requireContext) {
      throw new Error("require_context: no RAG hits");
    }

    const context = hits
      .map(h => ({
        source_id: extractSourceId(h.displayPath ?? h.file) ?? "",
        title: h.title || h.displayPath || h.file,
        snippet: h.bestChunk || (h.body ? h.body.slice(0, 800) : ""),
        path: h.displayPath ?? h.file,
      }))
      .filter(c => c.source_id);

    const llm = opts._llmClient ?? createAnthropicClient();
    const out = await writeDraft(llm, prompt, context, opts.model, opts.style);
    const path = writeDraftFile(vault, {
      topic_id: topic.id,
      slug,
      prompt,
      generated_at: new Date().toISOString(),
      model: out.model,
      context_sources: context.map(c => c.path),
      include_vault: opts.includeVault ?? false,
      body_md: out.body_md,
    });
    return { path, cost_usd: out.cost_usd, cited: out.cited };
  } finally {
    if (ownsStore) await store.close();
  }
}

export function extractSourceId(path: string): string | null {
  const m = path.match(/sources\/([0-9a-f]{12})\.md/);
  return m && m[1] !== undefined ? m[1] : null;
}

export function slugFromPrompt(p: string): string {
  return (
    p
      .toLowerCase()
      .split(/\s+/)
      .slice(0, 6)
      .join("-")
      .replace(/[^a-z0-9-]/g, "")
      .slice(0, 40) || "draft"
  );
}
