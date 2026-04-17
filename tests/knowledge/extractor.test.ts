import { describe, it, expect } from "vitest";
import { KnowledgeExtractor, ExtractedKnowledge } from "../../src/knowledge/extractor";
import { LlmProvider } from "../../src/knowledge/llm-provider";

const validResponse: ExtractedKnowledge = {
  title: "팝업 중복 방지",
  summary: "isDuplicate 파라미터를 사용하면 된다",
  keyInsights: ["isDuplicate 파라미터 사용", "IsOpenOrInitializing() 확인"],
  tags: ["popup", "bugfix"],
  relatedTopics: ["PopupManager"],
};

const mockProvider: LlmProvider = {
  name: "mock",
  complete: async () => JSON.stringify(validResponse),
  estimateTokens: (t: string) => Math.ceil(t.length / 4),
};

const sampleSession = `# Session

### User
팝업이 중복으로 열리는 문제가 있어요.

### Assistant
isDuplicate 파라미터를 확인해보세요.

### Tool
<details>
<summary>read_file: popup-manager.ts</summary>

\`\`\`typescript
class PopupManager {
  private isOpen = false;
  open() {
    if (this.isOpen) return;
    this.isOpen = true;
  }
}
\`\`\`
</details>

### Assistant
IsOpenOrInitializing() 메서드로 확인할 수 있습니다.
`;

describe("KnowledgeExtractor", () => {
  it("should extract structured knowledge from session markdown", async () => {
    const extractor = new KnowledgeExtractor(mockProvider);
    const result = await extractor.extract(sampleSession);

    expect(result.title).toBe("팝업 중복 방지");
    expect(result.summary).toBe("isDuplicate 파라미터를 사용하면 된다");
    expect(result.keyInsights).toEqual(["isDuplicate 파라미터 사용", "IsOpenOrInitializing() 확인"]);
    expect(result.tags).toEqual(["popup", "bugfix"]);
    expect(result.relatedTopics).toEqual(["PopupManager"]);
  });

  it("should chunk large sessions before extraction", async () => {
    let callCount = 0;
    const chunkingProvider: LlmProvider = {
      name: "chunking-mock",
      complete: async () => {
        callCount++;
        return JSON.stringify(validResponse);
      },
      // Return a very high token count so it triggers chunking
      estimateTokens: () => 60000,
    };

    const extractor = new KnowledgeExtractor(chunkingProvider, { maxTokens: 50000 });

    // Build a session with multiple User/Assistant turns so it can be chunked
    const bigSession = `# Session

### User
First question

### Assistant
First answer

### User
Second question

### Assistant
Second answer`;

    const result = await extractor.extract(bigSession);
    // Should have called complete more than once (chunked)
    expect(callCount).toBeGreaterThan(1);
    expect(result.title).toBeDefined();
  });

  it("should summarize tool calls to save tokens", () => {
    const extractor = new KnowledgeExtractor(mockProvider);
    const preprocessed = extractor.preprocessSession(sampleSession);

    // The <details> block content should be removed/summarized
    expect(preprocessed).not.toContain("class PopupManager");
    // But the summary line should remain or be referenced
    expect(preprocessed).toContain("read_file: popup-manager.ts");
  });

  it("should handle LLM returning invalid JSON gracefully", async () => {
    const badProvider: LlmProvider = {
      name: "bad-json-mock",
      complete: async () => "This is not JSON at all",
      estimateTokens: (t: string) => Math.ceil(t.length / 4),
    };

    const extractor = new KnowledgeExtractor(badProvider);
    await expect(extractor.extract(sampleSession)).rejects.toThrow(/JSON/i);
  });

  it("should merge results from chunked extraction", async () => {
    let callIndex = 0;
    const responses: ExtractedKnowledge[] = [
      {
        title: "첫 번째 주제",
        summary: "첫 번째 요약",
        keyInsights: ["인사이트 A"],
        tags: ["tag1"],
        relatedTopics: ["topic1"],
      },
      {
        title: "두 번째 주제",
        summary: "두 번째 요약",
        keyInsights: ["인사이트 B"],
        tags: ["tag1", "tag2"],
        relatedTopics: ["topic2"],
      },
    ];

    const mergingProvider: LlmProvider = {
      name: "merging-mock",
      complete: async () => {
        const resp = responses[callIndex] ?? responses[responses.length - 1];
        callIndex++;
        return JSON.stringify(resp);
      },
      estimateTokens: () => 60000,
    };

    const extractor = new KnowledgeExtractor(mergingProvider, { maxTokens: 50000 });

    const bigSession = `# Session

### User
First question

### Assistant
First answer

### User
Second question

### Assistant
Second answer`;

    const result = await extractor.extract(bigSession);

    // Merged insights should contain items from both chunks
    expect(result.keyInsights).toContain("인사이트 A");
    expect(result.keyInsights).toContain("인사이트 B");
    // Tags should be deduplicated
    expect(result.tags.filter((t) => t === "tag1").length).toBe(1);
    expect(result.tags).toContain("tag2");
    // Related topics merged
    expect(result.relatedTopics).toContain("topic1");
    expect(result.relatedTopics).toContain("topic2");
  });
});
