import type { LlmClient } from "./client.js";

const SYSTEM = `You write a research-grounded draft (Markdown) for the user's prompt.
Use ONLY the provided context. Cite using [^source_id] footnotes when concrete claims come from a source.
Define footnotes at the bottom. Do not fabricate.`;

export type DraftStyle = "blog" | "report" | "qa";

export type DraftContext = {
  source_id: string;
  title: string;
  snippet: string;
  path: string;
};

export async function writeDraft(
  client: LlmClient,
  prompt: string,
  context: DraftContext[],
  model: string,
  style?: DraftStyle,
): Promise<{ body_md: string; cited: string[]; cost_usd: number; model: string; reason?: string }> {
  const styleHint =
    style === "blog"
      ? "Blog post tone (engaging, paragraphs, intro/outro)."
      : style === "qa"
        ? "Q&A format. Use ## question-style headings."
        : "Report-style: clear sections, factual tone.";
  const ctxStr = context
    .map(c => `### [${c.source_id}] ${c.title}\n${c.snippet}`)
    .join("\n\n");

  let res;
  try {
    res = await client.call({
      model,
      system: SYSTEM + "\n" + styleHint,
      max_tokens: 6000,
      temperature: 0.6,
      messages: [
        {
          role: "user",
          content: `User prompt:\n${prompt}\n\nContext:\n${ctxStr.slice(0, 80000)}`,
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
