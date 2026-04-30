import type { LlmClient, LlmCallOptions, LlmCallResult } from "../../../src/research/llm/client.js";

export function mockLlm(scripted: Array<string | ((opts: LlmCallOptions) => string)>): LlmClient {
  let i = 0;
  return {
    async call(opts) {
      const next = scripted[i++ % scripted.length];
      const text = typeof next === "function" ? next(opts) : next;
      return {
        text,
        usage: { input_tokens: 100, output_tokens: 50 },
        cost_usd: 0.001,
        model: opts.model,
      } satisfies LlmCallResult;
    },
  };
}
