/**
 * extractor.ts - LLM-based knowledge extraction from session markdown
 *
 * Preprocesses session markdown (removing tool call details), sends it to an
 * LLM provider for structured extraction, and handles chunking for large sessions.
 */

import { LlmProvider } from "./llm-provider";

// =============================================================================
// Types
// =============================================================================

export interface ExtractedKnowledge {
  title: string;
  summary: string;
  keyInsights: string[];
  tags: string[];
  relatedTopics: string[];
}

// =============================================================================
// KnowledgeExtractor
// =============================================================================

const DEFAULT_MAX_TOKENS = 50000;

const EXTRACTION_PROMPT = `You are a knowledge extraction assistant. Analyze the following session transcript and extract structured knowledge.

Return ONLY a JSON object with these fields (no markdown fences, no explanation):
{
  "title": "concise title describing the main topic",
  "summary": "1-3 sentence summary of key conclusions",
  "keyInsights": ["insight1", "insight2", ...],
  "tags": ["tag1", "tag2", ...],
  "relatedTopics": ["topic1", "topic2", ...]
}

Session:
`;

export class KnowledgeExtractor {
  private maxTokens: number;

  constructor(
    private provider: LlmProvider,
    private options?: { maxTokens?: number },
  ) {
    this.maxTokens = options?.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  /**
   * Preprocess session: summarize/remove tool call details to save tokens.
   * Removes content inside <details> blocks but keeps the <summary> line.
   */
  preprocessSession(sessionMarkdown: string): string {
    // Replace <details>...<summary>X</summary>...content...</details>
    // with just "[Tool call: X]"
    return sessionMarkdown.replace(
      /<details>\s*\n\s*<summary>(.*?)<\/summary>[\s\S]*?<\/details>/g,
      (_match, summary) => `[Tool call: ${summary.trim()}]`,
    );
  }

  /**
   * Extract knowledge from session markdown.
   * Preprocesses, chunks if needed, sends to LLM, parses JSON response.
   */
  async extract(sessionMarkdown: string): Promise<ExtractedKnowledge> {
    const preprocessed = this.preprocessSession(sessionMarkdown);
    const tokenCount = this.provider.estimateTokens(preprocessed);

    if (tokenCount <= this.maxTokens) {
      return this.extractSingle(preprocessed);
    }

    // Chunk and extract
    const chunks = this.chunkSession(preprocessed);
    const results: ExtractedKnowledge[] = [];

    for (const chunk of chunks) {
      const result = await this.extractSingle(chunk);
      results.push(result);
    }

    return this.mergeResults(results);
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  private async extractSingle(text: string): Promise<ExtractedKnowledge> {
    const prompt = EXTRACTION_PROMPT + text;
    const response = await this.provider.complete(prompt);
    return this.parseResponse(response);
  }

  /**
   * Split session on ### User / ### Assistant boundaries into roughly equal chunks.
   */
  private chunkSession(text: string): string[] {
    // Split on turn boundaries (### User or ### Assistant)
    const turnPattern = /(?=^### (?:User|Assistant))/m;
    const turns = text.split(turnPattern).filter((t) => t.trim().length > 0);

    if (turns.length <= 1) {
      return [text];
    }

    // Group turns into pairs to keep context
    const chunks: string[] = [];
    // Each chunk gets roughly half the turns (minimum 1 turn per chunk)
    const midpoint = Math.ceil(turns.length / 2);

    chunks.push(turns.slice(0, midpoint).join(""));
    chunks.push(turns.slice(midpoint).join(""));

    return chunks.filter((c) => c.trim().length > 0);
  }

  private parseResponse(response: string): ExtractedKnowledge {
    // Try to extract JSON from the response (handle markdown fences)
    let jsonStr = response.trim();

    // Remove markdown code fences if present
    const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1].trim();
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      throw new Error(
        `Failed to parse JSON from LLM response. Response was: ${response.slice(0, 200)}`,
      );
    }

    if (!parsed || typeof parsed !== "object") {
      throw new Error(
        `LLM response is not a JSON object. Response was: ${response.slice(0, 200)}`,
      );
    }

    const obj = parsed as Record<string, unknown>;

    return {
      title: String(obj.title ?? ""),
      summary: String(obj.summary ?? ""),
      keyInsights: toStringArray(obj.keyInsights),
      tags: toStringArray(obj.tags),
      relatedTopics: toStringArray(obj.relatedTopics),
    };
  }

  /**
   * Merge multiple extraction results into one, deduplicating arrays.
   * Uses the first result's title, concatenates summaries.
   */
  private mergeResults(results: ExtractedKnowledge[]): ExtractedKnowledge {
    if (results.length === 0) {
      return {
        title: "",
        summary: "",
        keyInsights: [],
        tags: [],
        relatedTopics: [],
      };
    }

    if (results.length === 1) {
      return results[0];
    }

    const title = results[0].title;
    const summary = results.map((r) => r.summary).join(" ");
    const keyInsights = dedupe(results.flatMap((r) => r.keyInsights));
    const tags = dedupe(results.flatMap((r) => r.tags));
    const relatedTopics = dedupe(results.flatMap((r) => r.relatedTopics));

    return { title, summary, keyInsights, tags, relatedTopics };
  }
}

// =============================================================================
// Utilities
// =============================================================================

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(String);
}

function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}
