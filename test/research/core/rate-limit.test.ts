import { describe, it, expect } from "vitest";
import { DomainRateLimiter } from "../../../src/research/core/rate-limit.js";

describe("DomainRateLimiter", () => {
  it("enforces minimum gap per host", async () => {
    const rl = new DomainRateLimiter(10); // 100ms gap
    const t0 = Date.now();
    await rl.acquire("a.com");
    await rl.acquire("a.com");
    expect(Date.now() - t0).toBeGreaterThanOrEqual(95);
  });

  it("does not couple distinct hosts", async () => {
    const rl = new DomainRateLimiter(10);
    const t0 = Date.now();
    await rl.acquire("a.com");
    await rl.acquire("b.com");
    expect(Date.now() - t0).toBeLessThan(50);
  });
});
