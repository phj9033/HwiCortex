/**
 * llm-provider.ts - Unified LLM interface with retry logic
 *
 * Provides a common interface for different LLM backends (Claude API, local models)
 * with built-in retry and exponential backoff for transient errors.
 */

import Anthropic from "@anthropic-ai/sdk";

// =============================================================================
// Types
// =============================================================================

export interface LlmConfig {
  default: "claude" | "local";
  claude?: { api_key: string; model: string };
  local?: { model_path: string };
}

export interface LlmProvider {
  readonly name: string;
  complete(prompt: string, options?: { maxTokens?: number }): Promise<string>;
  estimateTokens(text: string): number;
}

// =============================================================================
// Retry Logic
// =============================================================================

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

/** Error types considered transient and eligible for retry. */
const TRANSIENT_ERROR_TYPES = new Set([
  "rate_limit",
  "overloaded",
  "timeout",
]);

/** Network-level error codes considered transient. */
const TRANSIENT_ERROR_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
]);

function isTransientError(err: unknown): boolean {
  if (err && typeof err === "object") {
    const e = err as Record<string, any>;

    // Check Anthropic API error type
    if (e.error?.type && TRANSIENT_ERROR_TYPES.has(e.error.type)) {
      return true;
    }

    // Check HTTP status codes for transient errors
    if (typeof e.status === "number") {
      // 429 = rate limit, 529 = overloaded, 408 = timeout, 5xx = server error
      if (e.status === 429 || e.status === 529 || e.status === 408) {
        return true;
      }
      if (e.status >= 500 && e.status < 600) {
        return true;
      }
    }

    // Check Node.js network error codes
    if (typeof e.code === "string" && TRANSIENT_ERROR_CODES.has(e.code)) {
      return true;
    }
  }
  return false;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(
  fn: () => Promise<T>,
  baseDelayMs: number = BASE_DELAY_MS,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isTransientError(err) || attempt === MAX_RETRIES) {
        throw err;
      }
      // Exponential backoff: 2^(attempt+1) * baseDelayMs
      const delay = Math.pow(2, attempt + 1) * baseDelayMs;
      if (delay > 0) await sleep(delay);
    }
  }
  throw lastError;
}

// =============================================================================
// Token Estimation
// =============================================================================

function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}

// =============================================================================
// Claude Provider
// =============================================================================

export class ClaudeProvider implements LlmProvider {
  readonly name = "claude";
  private client: Anthropic;
  private model: string;

  constructor(config: { api_key: string; model: string }) {
    this.client = new Anthropic({ apiKey: config.api_key });
    this.model = config.model;
  }

  async complete(prompt: string, options?: { maxTokens?: number }): Promise<string> {
    return withRetry(async () => {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: options?.maxTokens ?? 1024,
        messages: [{ role: "user", content: prompt }],
      });

      const textBlock = response.content.find((block) => block.type === "text");
      return textBlock ? textBlock.text : "";
    });
  }

  estimateTokens(text: string): number {
    return estimateTokens(text);
  }
}

// =============================================================================
// Local Provider (placeholder)
// =============================================================================

export class LocalProvider implements LlmProvider {
  readonly name = "local";
  private modelPath: string;

  constructor(config: { model_path: string }) {
    this.modelPath = config.model_path;
  }

  async complete(_prompt: string, _options?: { maxTokens?: number }): Promise<string> {
    throw new Error("Local LLM provider is not available yet");
  }

  estimateTokens(text: string): number {
    return estimateTokens(text);
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createLlmProvider(config: LlmConfig): LlmProvider {
  switch (config.default) {
    case "claude": {
      if (!config.claude) {
        throw new Error("Claude config is required when default is 'claude'");
      }
      return new ClaudeProvider(config.claude);
    }
    case "local": {
      const localConfig = config.local ?? { model_path: "" };
      return new LocalProvider(localConfig);
    }
    default:
      throw new Error(`Unknown LLM provider: ${(config as any).default}`);
  }
}

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Create a mock provider that always succeeds.
 */
export function createMockProvider(): LlmProvider {
  return {
    name: "mock",
    async complete(prompt: string, _options?: { maxTokens?: number }): Promise<string> {
      return `mock response to: ${prompt}`;
    },
    estimateTokens,
  };
}

/**
 * Create a flaky mock provider that delegates to a user-supplied function
 * with retry logic applied.
 */
export function createFlakyMockProvider(
  fn: (prompt: string) => Promise<string>,
): LlmProvider {
  return {
    name: "flaky-mock",
    async complete(prompt: string, _options?: { maxTokens?: number }): Promise<string> {
      // Use 0 delay for test speed — retry logic is exercised without waiting
      return withRetry(() => fn(prompt), /* baseDelayMs */ 0);
    },
    estimateTokens,
  };
}
