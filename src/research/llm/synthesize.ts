import { z } from "zod";
import type { LlmClient } from "./client.js";
import type { Card } from "../core/types.js";

const ClusterPlan = z.object({
  clusters: z
    .array(
      z.object({
        subtopic: z.string().regex(/^[a-z0-9-]+$/),
        title: z.string().min(1),
        source_ids: z.array(z.string().min(1)).min(1),
      }),
    )
    .min(1),
});

export type ClusterPlanT = z.infer<typeof ClusterPlan>;

const PLAN_SYSTEM = `Group source cards into 3-7 coherent subtopics. For each subtopic:
- give a short slug (lowercase-hyphen)
- a short title
- the list of source_ids that belong.
Return JSON ONLY: {"clusters":[{"subtopic":"...","title":"...","source_ids":["..."]}]}`;

const SYNTH_SYSTEM = `Write a synthesis note in Markdown for one subtopic of a research topic.
Inputs: subtopic title and a list of cards (source_id, title, tldr, excerpts).
Rules:
- Use Markdown footnotes ([^source_id]) to cite. Define them at the bottom.
- Do not invent claims that are not in the cards.
- Section headings as appropriate. Mix Korean/English faithfully.
- Output ONLY the markdown body. No frontmatter.`;

export async function planClusters(
  client: LlmClient,
  cards: Card[],
  model: string,
): Promise<{ plan: ClusterPlanT; cost_usd: number; reason?: string }> {
  const cardSummaries = cards.map(c => ({
    source_id: c.source_id,
    title: c.title,
    tags: c.tags,
    tldr: c.tldr,
  }));
  let res;
  try {
    res = await client.call({
      model,
      system: PLAN_SYSTEM,
      max_tokens: 1500,
      temperature: 0.2,
      messages: [
        { role: "user", content: JSON.stringify(cardSummaries).slice(0, 30000) },
      ],
    });
  } catch (e: any) {
    return { plan: { clusters: [] } as any, cost_usd: 0, reason: "llm_error: " + (e?.message ?? "?") };
  }
  try {
    const m = res.text.match(/\{[\s\S]*\}/);
    return { plan: ClusterPlan.parse(JSON.parse(m ? m[0] : res.text)), cost_usd: res.cost_usd };
  } catch {
    return { plan: { clusters: [] } as any, cost_usd: res.cost_usd, reason: "schema_error" };
  }
}

export async function writeSubtopicNote(
  client: LlmClient,
  subtopicTitle: string,
  cards: Card[],
  model: string,
): Promise<{ body_md: string; cited: string[]; cost_usd: number; model: string; reason?: string }> {
  const lite = cards.map(c => ({
    source_id: c.source_id,
    title: c.title,
    tldr: c.tldr,
    excerpts: c.excerpts,
  }));
  let res;
  try {
    res = await client.call({
      model,
      system: SYNTH_SYSTEM,
      max_tokens: 4000,
      temperature: 0.4,
      messages: [
        {
          role: "user",
          content: `Subtopic title: ${subtopicTitle}\nCards:\n${JSON.stringify(lite).slice(0, 60000)}`,
        },
      ],
    });
  } catch (e: any) {
    return { body_md: "", cited: [], cost_usd: 0, model, reason: "llm_error: " + (e?.message ?? "?") };
  }
  const seen = new Set<string>();
  const cited: string[] = [];
  for (const m of res.text.matchAll(/\[\^([0-9a-f]{12})\]/g)) {
    const id = m[1];
    if (typeof id === "string" && !seen.has(id)) {
      seen.add(id);
      cited.push(id);
    }
  }
  return { body_md: res.text.trim(), cited, cost_usd: res.cost_usd, model };
}
