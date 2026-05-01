import { describe, it, expect } from "vitest";
import { Budget } from "../../../src/research/core/budget.js";

describe("Budget", () => {
  it("tracks URLs and stops at max_new_urls", () => {
    const b = new Budget({ max_new_urls: 2, max_total_bytes: 1000 });
    expect(b.tryAddUrl()).toBe(true);
    expect(b.tryAddUrl()).toBe(true);
    expect(b.tryAddUrl()).toBe(false);
  });

  it("tracks bytes and rejects when over", () => {
    const b = new Budget({ max_new_urls: 100, max_total_bytes: 1000 });
    expect(b.tryAddBytes(800)).toBe(true);
    expect(b.tryAddBytes(300)).toBe(false);
  });

  it("report exposes urls and bytes counters", () => {
    const b = new Budget({ max_new_urls: 5, max_total_bytes: 5000 });
    b.tryAddUrl();
    b.tryAddUrl();
    b.tryAddBytes(1024);
    const r = b.report();
    expect(r.urls).toBe(2);
    expect(r.bytes).toBe(1024);
  });
});
