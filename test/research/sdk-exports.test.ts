import { describe, it, expect } from "vitest";
import * as hwicortex from "../../src/index.js";
import * as research from "../../src/research/index.js";

describe("SDK research namespace", () => {
  it("hwicortex.research re-exports the research module", () => {
    expect(hwicortex.research).toBeDefined();
    expect(hwicortex.research.fetchTopic).toBe(research.fetchTopic);
    expect(hwicortex.research.searchTopic).toBe(research.searchTopic);
    expect(hwicortex.research.computeStatus).toBe(research.computeStatus);
  });

  it("includes only the data-plumbing primitives — no LLM helpers", () => {
    // Pipeline + topic + status
    expect(typeof research.fetchTopic).toBe("function");
    expect(typeof research.searchTopic).toBe("function");
    expect(typeof research.computeStatus).toBe("function");
    expect(typeof research.loadTopic).toBe("function");
    expect(typeof research.scaffoldTopic).toBe("function");
    expect(typeof research.listTopicIds).toBe("function");

    // File IO writers — agent calls these directly with content it has generated
    expect(typeof research.writeCard).toBe("function");
    expect(typeof research.writeSynthesis).toBe("function");
    expect(typeof research.writeDraftFile).toBe("function");
    expect(typeof research.readCardFrontmatter).toBe("function");

    // Agent tool surface
    expect(typeof research.executeResearchTool).toBe("function");
    expect(Array.isArray(research.researchTools)).toBe(true);

    // No LLM-driven helpers should be exported
    expect((research as any).synthesize).toBeUndefined();
    expect((research as any).draft).toBeUndefined();
    expect((research as any).buildCard).toBeUndefined();
    expect((research as any).writeDraft).toBeUndefined();
    expect((research as any).planClusters).toBeUndefined();
  });
});
