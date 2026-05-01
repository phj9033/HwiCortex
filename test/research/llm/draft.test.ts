import { describe, it, expect } from "vitest";
import { writeDraft } from "../../../src/research/llm/draft.js";
import { mockLlm } from "../_helpers/anthropic-mock.js";

const ctx = [
  { source_id: "abcdef012345", title: "Survey", snippet: "RAG survey content.", path: "/v/.../abcdef012345.md" },
  { source_id: "112233445566", title: "Hybrid", snippet: "Hybrid search.", path: "/v/.../112233445566.md" },
];

describe("writeDraft", () => {
  it("calls the LLM and extracts unique cited 12-hex ids", async () => {
    const llm = mockLlm([
      "# Topic\n\nClaim A[^abcdef012345]. Claim B[^112233445566][^abcdef012345].\n\n[^abcdef012345]: ref\n[^112233445566]: ref",
    ]);
    const r = await writeDraft(llm, "What is RAG?", ctx, "claude-sonnet-4-6", "report");
    expect(r.cited.sort()).toEqual(["112233445566", "abcdef012345"]);
    expect(r.body_md).toContain("# Topic");
    expect(r.cost_usd).toBeGreaterThan(0);
    expect(r.reason).toBeUndefined();
  });

  it("supports blog/qa style hints (smoke check via mock)", async () => {
    const captured: any[] = [];
    const llm = {
      async call(opts: any) {
        captured.push(opts);
        return { text: "ok", usage: { input_tokens: 1, output_tokens: 1 }, cost_usd: 0.001, model: opts.model };
      },
    };
    await writeDraft(llm, "Q?", ctx, "claude-sonnet-4-6", "blog");
    await writeDraft(llm, "Q?", ctx, "claude-sonnet-4-6", "qa");
    expect(captured[0].system).toMatch(/Blog post tone/);
    expect(captured[1].system).toMatch(/Q&A format/);
  });

  it("returns llm_error when the client throws", async () => {
    const llm = {
      async call() {
        throw new Error("boom");
      },
    };
    const r = await writeDraft(llm, "p", ctx, "claude-sonnet-4-6");
    expect(r.reason).toMatch(/^llm_error:/);
    expect(r.body_md).toBe("");
    expect(r.cost_usd).toBe(0);
  });
});
