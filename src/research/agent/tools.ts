import type Anthropic from "@anthropic-ai/sdk";
import { fetchTopic, type ResearchConfig } from "../pipeline/fetch.js";
import { searchTopic, type SearchTopicResult } from "../pipeline/draft.js";
import { computeStatus } from "../pipeline/status.js";
import { loadTopic, adhocTopicFromPrompt } from "../topic/loader.js";
import { listTopicIds } from "../topic/scaffold.js";
import type { SourceSpec } from "../topic/schema.js";

/**
 * Anthropic tool-use definitions for the slimmed-down research pipeline.
 *
 * IMPORTANT: hwicortex no longer drives an LLM in-process. These tools
 * cover only the data-plumbing primitives that an external agent
 * composes. Synthesis and draft writing are NOT exposed as tools — the
 * agent does that work in its own context using the cards markdown
 * (read directly) and the `research_search` hits as RAG context.
 */
export const researchTools: Anthropic.Tool[] = [
  {
    name: "research_fetch",
    description:
      "Discover + HTTP-fetch sources for a topic, write extracted records to research/_staging/<id>/raw.jsonl. No LLM call.",
    input_schema: {
      type: "object",
      properties: {
        topic_id: { type: "string" },
        max_new: { type: "integer", minimum: 1 },
        refresh: { type: "boolean" },
        dry_run: { type: "boolean" },
        source: {
          type: "string",
          enum: ["web-search", "arxiv", "rss", "seed-urls", "from-document"],
        },
      },
      required: ["topic_id"],
    },
  },
  {
    name: "research_search",
    description:
      "Build (or reuse) a per-topic SDK store and return RAG hits + a source-id-keyed context array. No LLM call. The agent uses the returned context to compose a draft body itself.",
    input_schema: {
      type: "object",
      properties: {
        topic_id: { type: "string" },
        query: { type: "string" },
        top_k: { type: "integer", minimum: 1 },
        include_vault: { type: "boolean" },
      },
      required: ["topic_id", "query"],
    },
  },
  {
    name: "research_topic_show",
    description: "Show a topic spec.",
    input_schema: {
      type: "object",
      properties: { topic_id: { type: "string" } },
      required: ["topic_id"],
    },
  },
  {
    name: "research_topic_list",
    description: "List topic ids.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "research_status",
    description: "Show topic status (raw count, cards, notes, drafts, run-log tail).",
    input_schema: {
      type: "object",
      properties: { topic_id: { type: "string" } },
      required: ["topic_id"],
    },
  },
];

export type AgentCtx = {
  vault: string;
  config: ResearchConfig;
};

type ToolInput = Record<string, unknown>;

export async function executeResearchTool(
  name: string,
  input: ToolInput,
  ctx: AgentCtx,
): Promise<{ content: string }> {
  switch (name) {
    case "research_fetch": {
      const topic = await tryLoadTopic(asString(input.topic_id), ctx.vault);
      const r = await fetchTopic({
        topic,
        vault: ctx.vault,
        config: ctx.config,
        refresh: asBool(input.refresh),
        maxNew: asNum(input.max_new),
        source: input.source as SourceSpec["type"] | undefined,
        dryRun: asBool(input.dry_run),
      });
      return { content: JSON.stringify(r) };
    }
    case "research_search": {
      const topic = await loadTopic(asString(input.topic_id), ctx.vault);
      const r: SearchTopicResult = await searchTopic({
        topic,
        vault: ctx.vault,
        query: asString(input.query),
        topK: asNum(input.top_k),
        includeVault: asBool(input.include_vault),
      });
      // Agents care about the source-id-keyed context, not the verbose
      // HybridQueryResult fields. Return only context for token economy.
      return { content: JSON.stringify({ context: r.context }) };
    }
    case "research_topic_show": {
      const t = await loadTopic(asString(input.topic_id), ctx.vault);
      return { content: JSON.stringify(t) };
    }
    case "research_topic_list": {
      return { content: JSON.stringify(listTopicIds(ctx.vault)) };
    }
    case "research_status": {
      return { content: JSON.stringify(computeStatus(ctx.vault, asString(input.topic_id))) };
    }
    default:
      throw new Error("unknown tool: " + name);
  }
}

async function tryLoadTopic(idOrPrompt: string, vault: string) {
  try {
    return await loadTopic(idOrPrompt, vault);
  } catch {
    return adhocTopicFromPrompt(idOrPrompt);
  }
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function asBool(v: unknown): boolean {
  return v === true;
}
function asNum(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}
