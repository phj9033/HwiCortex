import { join } from "path";
import { createStore, type QMDStore, type HybridQueryResult } from "../../index.js";
import { notesDir } from "../topic/paths.js";
import type { TopicSpec } from "../topic/schema.js";

export type DraftContext = {
  source_id: string;
  title: string;
  snippet: string;
  path: string;
};

export type SearchTopicOptions = {
  topic: TopicSpec;
  vault: string;
  query: string;
  topK?: number;
  includeVault?: boolean;
  /** SQLite path for the per-topic RAG index. Defaults under _staging. */
  dbPath?: string;
  /** Test seam: inject a pre-built store (skips createStore + update + embed). */
  _store?: QMDStore;
};

export type SearchTopicResult = {
  hits: HybridQueryResult[];
  context: DraftContext[];
};

export function defaultDraftDbPath(vault: string, topicId: string): string {
  return join(vault, "research", "_staging", topicId, "draft-rag.sqlite");
}

/**
 * Build (or reuse) a per-topic SDK store and return RAG hits + a
 * source-id-keyed DraftContext array suitable for handing to an external
 * agent that will compose the draft body itself.
 *
 * No LLM call. Indexing/embedding/rerank are local llama-cpp; HTTP and
 * Anthropic are NOT involved.
 */
export async function searchTopic(opts: SearchTopicOptions): Promise<SearchTopicResult> {
  const { topic, vault, query } = opts;
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
      query,
      collections: [collectionName],
      limit: opts.topK ?? 12,
      rerank: true,
    });

    const context: DraftContext[] = hits
      .map(h => ({
        source_id: extractSourceId(h.displayPath ?? h.file) ?? "",
        title: h.title || h.displayPath || h.file,
        snippet: h.bestChunk || (h.body ? h.body.slice(0, 800) : ""),
        path: h.displayPath ?? h.file,
      }))
      .filter(c => c.source_id);

    return { hits, context };
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
