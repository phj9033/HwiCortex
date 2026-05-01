import Anthropic from "@anthropic-ai/sdk";

export type LlmCallOptions = {
  model: string;
  system?: string;
  messages: { role: "user" | "assistant"; content: string }[];
  max_tokens?: number;
  temperature?: number;
};

export type LlmCallResult = {
  text: string;
  usage: { input_tokens: number; output_tokens: number };
  cost_usd: number;
  model: string;
};

// Pricing (USD per million tokens) — keep in code; revisit if pricing changes.
const PRICING: Record<string, { in: number; out: number }> = {
  "claude-haiku-4-5":   { in: 1.0,  out: 5.0  },
  "claude-sonnet-4-6":  { in: 3.0,  out: 15.0 },
};

export interface LlmClient {
  call(opts: LlmCallOptions): Promise<LlmCallResult>;
}

export function createAnthropicClient(): LlmClient {
  const client = new Anthropic();
  return {
    async call(opts) {
      const r = await client.messages.create({
        model: opts.model,
        system: opts.system,
        max_tokens: opts.max_tokens ?? 1024,
        temperature: opts.temperature ?? 0.2,
        messages: opts.messages,
      });
      const text = r.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
      const p = PRICING[opts.model] ?? { in: 0, out: 0 };
      const cost =
        (r.usage.input_tokens * p.in) / 1_000_000 +
        (r.usage.output_tokens * p.out) / 1_000_000;
      return { text, usage: r.usage, cost_usd: cost, model: opts.model };
    },
  };
}
