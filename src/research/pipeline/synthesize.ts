import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { parse as yamlParse } from "yaml";
import { sourcesDir } from "../topic/paths.js";
import { Budget } from "../core/budget.js";
import { RunLog } from "../store/log.js";
import { writeSynthesis, synthesisPath } from "../store/synthesis.js";
import { planClusters, writeSubtopicNote } from "../llm/synthesize.js";
import { createAnthropicClient, type LlmClient } from "../llm/client.js";
import type { Card } from "../core/types.js";
import type { TopicSpec } from "../topic/schema.js";

export type SynthOptions = {
  topic: TopicSpec;
  vault: string;
  config: { models: { synth: string } };
  subtopic?: string;
  refresh?: boolean;
  /** Test seam: inject a custom LLM client. Unset = production Anthropic client. */
  _llmClient?: LlmClient;
};

export type SynthResult = {
  notes_written: string[];
  cost_usd: number;
};

export async function synthesize(opts: SynthOptions): Promise<SynthResult> {
  const { topic, vault } = opts;
  const cards = loadCards(vault, topic.id);
  if (cards.length === 0) return { notes_written: [], cost_usd: 0 };

  const llm = opts._llmClient ?? createAnthropicClient();
  const log = new RunLog(vault, topic.id);
  const budget = new Budget(topic.budget);
  const written: string[] = [];
  const model = opts.config.models.synth;

  type Target = { subtopic: string; title: string; cards: Card[] };
  const targets: Target[] = [];

  if (opts.subtopic) {
    targets.push({ subtopic: opts.subtopic, title: opts.subtopic, cards });
  } else {
    const plan = await planClusters(llm, cards, model);
    if (plan.cost_usd > 0 && !budget.tryAddCost(model, plan.cost_usd)) {
      log.emit({ kind: "budget_halt", reason: "max_llm_cost_usd" });
      return { notes_written: written, cost_usd: budget.report().cost_usd_total };
    }
    if (plan.reason) {
      log.emit({ kind: "card_skip", source_id: "_plan", reason: plan.reason });
    }
    for (const c of plan.plan.clusters) {
      const sub = cards.filter(card => c.source_ids.includes(card.source_id));
      if (sub.length) targets.push({ subtopic: c.subtopic, title: c.title, cards: sub });
    }
    targets.unshift({ subtopic: "overview", title: "Overview", cards });
  }

  for (const t of targets) {
    if (!opts.refresh && existsSync(synthesisPath(vault, topic.id, t.subtopic))) continue;
    const out = await writeSubtopicNote(llm, t.title, t.cards, model);
    if (out.cost_usd > 0 && !budget.tryAddCost(model, out.cost_usd)) {
      log.emit({ kind: "budget_halt", reason: "max_llm_cost_usd" });
      break;
    }
    if (!out.body_md) {
      log.emit({ kind: "card_skip", source_id: t.subtopic, reason: out.reason ?? "empty" });
      continue;
    }
    writeSynthesis(vault, {
      topic_id: topic.id,
      subtopic: t.subtopic,
      generated_at: new Date().toISOString(),
      model: out.model,
      source_cards: out.cited,
      body_md: out.body_md,
    });
    written.push(synthesisPath(vault, topic.id, t.subtopic));
    log.emit({ kind: "synth_ok", subtopic: t.subtopic, cost_usd: out.cost_usd });
  }
  return { notes_written: written, cost_usd: budget.report().cost_usd_total };
}

function loadCards(vault: string, topicId: string): Card[] {
  const dir = sourcesDir(vault, topicId);
  if (!existsSync(dir)) return [];
  const out: Card[] = [];
  for (const f of readdirSync(dir).filter(n => n.endsWith(".md"))) {
    const txt = readFileSync(join(dir, f), "utf-8");
    const fmMatch = txt.match(/^---\n([\s\S]*?)\n---/);
    const bodyMatch = txt.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
    if (!fmMatch || fmMatch[1] === undefined) continue;
    const body = bodyMatch?.[1] ?? "";
    let meta: any;
    try {
      meta = yamlParse(fmMatch[1]);
    } catch {
      continue;
    }
    if (!meta?.source_id) continue;
    out.push({
      source_id: meta.source_id,
      topic_id: meta.topic,
      url: meta.url,
      title: meta.title,
      author: meta.author ?? null,
      published: meta.published ?? null,
      fetched: meta.fetched,
      language: meta.language ?? null,
      tags: meta.tags ?? [],
      body_hash: meta.body_hash,
      tldr: extractBullets(body, "## TL;DR"),
      excerpts: extractQuotes(body, "## 핵심 발췌"),
    });
  }
  return out;
}

function extractBullets(body: string, heading: string): string[] {
  const seg = body.split(heading)[1]?.split(/\n## /)[0] ?? "";
  return seg
    .split("\n")
    .filter(l => l.startsWith("- "))
    .map(l => l.slice(2).trim());
}

function extractQuotes(body: string, heading: string): string[] {
  const seg = body.split(heading)[1]?.split(/\n## /)[0] ?? "";
  return seg
    .split("\n")
    .filter(l => l.startsWith("> "))
    .map(l => l.slice(2).trim());
}
