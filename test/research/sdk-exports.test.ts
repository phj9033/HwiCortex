import { describe, it, expect } from "vitest";
import * as hwicortex from "../../src/index.js";
import * as research from "../../src/research/index.js";

describe("SDK research namespace", () => {
  it("hwicortex.research re-exports the research module", () => {
    expect(hwicortex.research).toBeDefined();
    expect(hwicortex.research.fetchTopic).toBe(research.fetchTopic);
    expect(hwicortex.research.synthesize).toBe(research.synthesize);
    expect(hwicortex.research.draft).toBe(research.draft);
  });

  it("includes pipeline + topic + agent surface", () => {
    expect(typeof research.fetchTopic).toBe("function");
    expect(typeof research.synthesize).toBe("function");
    expect(typeof research.draft).toBe("function");
    expect(typeof research.computeStatus).toBe("function");
    expect(typeof research.loadTopic).toBe("function");
    expect(typeof research.scaffoldTopic).toBe("function");
    expect(typeof research.listTopicIds).toBe("function");
    expect(typeof research.executeResearchTool).toBe("function");
    expect(Array.isArray(research.researchTools)).toBe(true);
  });
});
