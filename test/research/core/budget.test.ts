import { describe, it, expect } from "vitest";
import { Budget } from "../../../src/research/core/budget.js";

describe("Budget", () => {
  it("tracks URLs and stops at max_new_urls", () => {
    const b = new Budget({ max_new_urls: 2, max_total_bytes: 1000, max_llm_cost_usd: 1.0 });
    expect(b.tryAddUrl()).toBe(true);
    expect(b.tryAddUrl()).toBe(true);
    expect(b.tryAddUrl()).toBe(false);
  });

  it("tracks bytes and rejects when over", () => {
    const b = new Budget({ max_new_urls: 100, max_total_bytes: 1000, max_llm_cost_usd: 1.0 });
    expect(b.tryAddBytes(800)).toBe(true);
    expect(b.tryAddBytes(300)).toBe(false);
  });

  it("buckets cost by model", () => {
    const b = new Budget({ max_new_urls: 100, max_total_bytes: 1, max_llm_cost_usd: 0.10 });
    expect(b.tryAddCost("claude-haiku-4-5", 0.05)).toBe(true);
    expect(b.tryAddCost("claude-sonnet-4-6", 0.04)).toBe(true);
    expect(b.tryAddCost("claude-haiku-4-5", 0.02)).toBe(false);
    const r = b.report();
    expect(r.cost_usd_total).toBeCloseTo(0.09);
    expect(r.cost_usd_by_model["claude-haiku-4-5"]).toBeCloseTo(0.05);
    expect(r.cost_usd_by_model["claude-sonnet-4-6"]).toBeCloseTo(0.04);
  });

  it("report exposes urls and bytes counters", () => {
    const b = new Budget({ max_new_urls: 5, max_total_bytes: 5000, max_llm_cost_usd: 1.0 });
    b.tryAddUrl();
    b.tryAddUrl();
    b.tryAddBytes(1024);
    const r = b.report();
    expect(r.urls).toBe(2);
    expect(r.bytes).toBe(1024);
  });
});
