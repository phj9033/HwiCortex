import { describe, it, expect } from "vitest";
import { extractCardsFromDocument } from "../../../src/research/llm/from-document-extract.js";
import { mockLlm } from "../_helpers/anthropic-mock.js";

describe("extractCardsFromDocument", () => {
  it("parses a JSON array of tuples", async () => {
    const llm = mockLlm([
      JSON.stringify([
        { url: "https://a.com/x", title: "A", summary: "Alpha", excerpts: ["q1"] },
        { url: "https://b.com/y", summary: "Beta" },
      ]),
    ]);
    const r = await extractCardsFromDocument(llm, "doc text", "claude-haiku-4-5");
    expect(r.items.length).toBe(2);
    expect(r.items[0]).toMatchObject({ url: "https://a.com/x", title: "A", summary: "Alpha" });
    expect(r.items[1].excerpts).toEqual([]);
    expect(r.cost_usd).toBeGreaterThan(0);
  });

  it("extracts the JSON array even when surrounded by chatter", async () => {
    const llm = mockLlm([
      "Here you go:\n[{\"url\":\"https://a.com\",\"summary\":\"x\"}]\nDone.",
    ]);
    const r = await extractCardsFromDocument(llm, "doc", "claude-haiku-4-5");
    expect(r.items.length).toBe(1);
    expect(r.reason).toBeUndefined();
  });

  it("returns schema_error on malformed output", async () => {
    const llm = mockLlm(["not an array"]);
    const r = await extractCardsFromDocument(llm, "doc", "claude-haiku-4-5");
    expect(r.items).toEqual([]);
    expect(r.reason).toBe("schema_error");
  });

  it("returns llm_error when the client throws", async () => {
    const llm = {
      async call() {
        throw new Error("boom");
      },
    };
    const r = await extractCardsFromDocument(llm, "doc", "claude-haiku-4-5");
    expect(r.items).toEqual([]);
    expect(r.reason).toMatch(/^llm_error:/);
    expect(r.cost_usd).toBe(0);
  });
});
