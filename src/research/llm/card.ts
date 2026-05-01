import { z } from "zod";
import type { LlmClient } from "./client.js";
import type { RawRecord, Card } from "../core/types.js";

const CardOut = z.object({
  tldr: z.array(z.string().min(3)).min(3).max(7),
  excerpts: z.array(z.string().min(8)).max(5),
  tags: z.array(z.string().min(1)).max(8),
});

const SYSTEM = `You are an indexer that produces short, faithful "research cards" from web pages.
Rules:
- Output JSON ONLY, conforming to: {"tldr":[3..7 short bullets],"excerpts":[<=5 verbatim quotes from the body],"tags":[<=8 short tags]}.
- Each excerpt MUST appear verbatim (whitespace-normalized) in the body. If unsure, omit it.
- Cards are not analysis. No editorializing. Faithful to the source.
- Bullets are 1 line each.`;

export async function buildCard(
  client: LlmClient,
  rec: RawRecord,
  model: string,
): Promise<{ card: Card | null; cost_usd: number; reason?: string }> {
  const userPrompt = `URL: ${rec.canonical_url}
TITLE: ${rec.title ?? "(none)"}
LANGUAGE: ${rec.language ?? "?"}

BODY:
${rec.body_md.slice(0, 12000)}`;

  let res;
  try {
    res = await client.call({
      model,
      system: SYSTEM,
      messages: [{ role: "user", content: userPrompt }],
      max_tokens: 800,
      temperature: 0.0,
    });
  } catch (e: any) {
    return { card: null, cost_usd: 0, reason: "llm_error: " + (e?.message ?? "?") };
  }

  let parsed: z.infer<typeof CardOut>;
  try {
    parsed = CardOut.parse(JSON.parse(extractJson(res.text)));
  } catch {
    return { card: null, cost_usd: res.cost_usd, reason: "schema_error" };
  }

  const verifiedExcerpts = parsed.excerpts.filter(q =>
    substringMatchesNormalized(q, rec.body_md),
  );

  return {
    card: {
      source_id: rec.id,
      topic_id: rec.topic_id,
      url: rec.canonical_url,
      title: rec.title ?? "(untitled)",
      author: rec.author,
      published: rec.published_at,
      fetched: rec.fetched_at,
      language: rec.language,
      tags: parsed.tags.slice(0, 8),
      body_hash: rec.body_hash,
      tldr: parsed.tldr,
      excerpts: verifiedExcerpts,
    },
    cost_usd: res.cost_usd,
  };
}

function extractJson(s: string): string {
  const m = s.match(/\{[\s\S]*\}/);
  return m ? m[0] : s;
}

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim().normalize("NFC");
}

export function substringMatchesNormalized(q: string, body: string): boolean {
  return normalize(body).includes(normalize(q));
}
