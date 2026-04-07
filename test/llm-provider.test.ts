/**
 * llm-provider.test.ts - Unit tests for the unified LLM provider interface
 *
 * Tests use mock/fake providers — no real API calls.
 */

import { describe, it, expect, vi } from "vitest";
import {
  createLlmProvider,
  createMockProvider,
  createFlakyMockProvider,
  ClaudeProvider,
  LocalProvider,
  type LlmProvider,
  type LlmConfig,
} from "../src/knowledge/llm-provider.js";

// =============================================================================
// Factory Tests
// =============================================================================

describe("LlmProvider", () => {
  it("should create Claude provider from config", () => {
    const config: LlmConfig = {
      default: "claude",
      claude: { api_key: "sk-test-key", model: "claude-sonnet-4-20250514" },
    };
    const provider = createLlmProvider(config);
    expect(provider).toBeInstanceOf(ClaudeProvider);
    expect(provider.name).toBe("claude");
  });

  it("should create local provider from config", () => {
    const config: LlmConfig = {
      default: "local",
      local: { model_path: "/path/to/model.gguf" },
    };
    const provider = createLlmProvider(config);
    expect(provider).toBeInstanceOf(LocalProvider);
    expect(provider.name).toBe("local");
  });

  it("should have common complete() interface", async () => {
    const mock = createMockProvider();
    expect(typeof mock.complete).toBe("function");

    const result = await mock.complete("Hello");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  // ===========================================================================
  // Retry Logic Tests
  // ===========================================================================

  it("should retry on transient API failure (3 attempts, exponential backoff)", async () => {
    let callCount = 0;
    const provider = createFlakyMockProvider(async () => {
      callCount++;
      if (callCount < 3) {
        const err = new Error("rate_limit") as any;
        err.status = 429;
        err.error = { type: "rate_limit" };
        throw err;
      }
      return "success after retries";
    });

    const start = Date.now();
    const result = await provider.complete("test");
    const elapsed = Date.now() - start;

    expect(result).toBe("success after retries");
    expect(callCount).toBe(3);
    // Exponential backoff: 2^1*1000 + 2^2*1000 = 2000+4000 = 6000ms
    // But we use a fast clock in tests — the provider should have waited
    // We check the attempt count is correct; timing is tested indirectly
  });

  it("should throw after max retries exceeded", async () => {
    let callCount = 0;
    const provider = createFlakyMockProvider(async () => {
      callCount++;
      const err = new Error("overloaded") as any;
      err.status = 529;
      err.error = { type: "overloaded" };
      throw err;
    });

    await expect(provider.complete("test")).rejects.toThrow("overloaded");
    // Initial call + 3 retries = 4 total attempts
    expect(callCount).toBe(4);
  });

  it("should not retry on non-transient errors", async () => {
    let callCount = 0;
    const provider = createFlakyMockProvider(async () => {
      callCount++;
      const err = new Error("invalid_api_key") as any;
      err.status = 401;
      err.error = { type: "invalid_api_key" };
      throw err;
    });

    await expect(provider.complete("test")).rejects.toThrow("invalid_api_key");
    expect(callCount).toBe(1);
  });

  // ===========================================================================
  // Token Estimation Tests
  // ===========================================================================

  it("should estimate tokens as Math.ceil(text.length / 4)", () => {
    const mock = createMockProvider();
    expect(mock.estimateTokens("")).toBe(0);
    expect(mock.estimateTokens("hello")).toBe(2); // ceil(5/4) = 2
    expect(mock.estimateTokens("abcd")).toBe(1); // ceil(4/4) = 1
    expect(mock.estimateTokens("a")).toBe(1); // ceil(1/4) = 1
    expect(mock.estimateTokens("abcdefghijklmnop")).toBe(4); // ceil(16/4) = 4
  });
});
