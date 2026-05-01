import type Anthropic from "@anthropic-ai/sdk";
import { join } from "path";
import { fetchTopic, type ResearchConfig } from "../pipeline/fetch.js";
import { synthesize } from "../pipeline/synthesize.js";
import { draft } from "../pipeline/draft.js";
import { computeStatus } from "../pipeline/status.js";
import { loadTopic, adhocTopicFromPrompt } from "../topic/loader.js";
import { listTopicIds } from "../topic/scaffold.js";
import { stagingDir } from "../topic/paths.js";
import type { SourceSpec } from "../topic/schema.js";
import type { DraftStyle } from "../llm/draft.js";

export const researchTools: Anthropic.Tool[] = [
  {
    name: "research_fetch",
    description: "Fetch sources for a topic and generate cards.",
    input_schema: {
      type: "object",
      properties: {
        topic_id: { type: "string" },
        max_new: { type: "integer", minimum: 1 },
        refresh: { type: "boolean" },
        no_cards: { type: "boolean" },
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
    name: "research_synthesize",
    description: "Build synthesis notes for a topic. Auto-clusters if subtopic omitted.",
    input_schema: {
      type: "object",
      properties: {
        topic_id: { type: "string" },
        subtopic: { type: "string" },
        refresh: { type: "boolean" },
      },
      required: ["topic_id"],
    },
  },
  {
    name: "research_draft",
    description: "Generate a draft from topic context.",
    input_schema: {
      type: "object",
      properties: {
        topic_id: { type: "string" },
        prompt: { type: "string" },
        slug: { type: "string" },
        include_vault: { type: "boolean" },
        style: { type: "string", enum: ["blog", "report", "qa"] },
        top_k: { type: "integer", minimum: 1 },
        require_context: { type: "boolean" },
      },
      required: ["topic_id", "prompt"],
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
    description: "List topics.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "research_status",
    description: "Show topic status (raw count, cards, costs).",
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
  /** Optional override for draft RAG db path. If omitted, uses
   *  <vault>/research/_staging/<topic>/draft-rag.sqlite. */
  dbPath?: string;
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
        cardsEnabled: !asBool(input.no_cards),
        source: input.source as SourceSpec["type"] | undefined,
        dryRun: asBool(input.dry_run),
      });
      return { content: JSON.stringify(r) };
    }
    case "research_synthesize": {
      const topic = await loadTopic(asString(input.topic_id), ctx.vault);
      const r = await synthesize({
        topic,
        vault: ctx.vault,
        config: ctx.config,
        subtopic: asString(input.subtopic) || undefined,
        refresh: asBool(input.refresh),
      });
      return { content: JSON.stringify(r) };
    }
    case "research_draft": {
      const topic = await loadTopic(asString(input.topic_id), ctx.vault);
      const dbPath = ctx.dbPath ?? join(stagingDir(ctx.vault, topic.id), "draft-rag.sqlite");
      const r = await draft({
        topic,
        vault: ctx.vault,
        prompt: asString(input.prompt),
        slug: asString(input.slug) || undefined,
        includeVault: asBool(input.include_vault),
        style: input.style as DraftStyle | undefined,
        topK: asNum(input.top_k),
        requireContext: asBool(input.require_context),
        model: ctx.config.models.draft,
        dbPath,
      });
      return { content: JSON.stringify(r) };
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
