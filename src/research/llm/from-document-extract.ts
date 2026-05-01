import { z } from "zod";
import type { LlmClient } from "./client.js";

const Schema = z.array(
  z.object({
    url: z.string().url(),
    title: z.string().nullable().optional(),
    summary: z.string().min(1),
    excerpts: z.array(z.string()).default([]),
  }),
);

export type ExtractedItem = z.infer<typeof Schema>[number];

const SYSTEM = `You extract { url, title?, summary, excerpts? } tuples from a user's research document.
Return JSON ONLY: an array of objects. Skip items without a URL. Do NOT invent information.`;

export async function extractCardsFromDocument(
  client: LlmClient,
  documentText: string,
  model: string,
): Promise<{ items: ExtractedItem[]; cost_usd: number; reason?: string }> {
  let res;
  try {
    res = await client.call({
      model,
      system: SYSTEM,
      max_tokens: 2000,
      temperature: 0.0,
      messages: [{ role: "user", content: documentText.slice(0, 30000) }],
    });
  } catch (e: any) {
    return { items: [], cost_usd: 0, reason: "llm_error: " + (e?.message ?? "?") };
  }

  try {
    const m = res.text.match(/\[[\s\S]*\]/);
    const json = m ? m[0] : res.text;
    return { items: Schema.parse(JSON.parse(json)), cost_usd: res.cost_usd };
  } catch {
    return { items: [], cost_usd: res.cost_usd, reason: "schema_error" };
  }
}
