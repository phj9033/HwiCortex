import { describe, it, expect } from "vitest";
import { researchTools, executeResearchTool } from "../../../src/research/agent/tools.js";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { stringify as yamlStringify } from "yaml";
import type { ResearchConfig } from "../../../src/research/pipeline/fetch.js";

const cfg: ResearchConfig = {
  fetch: { user_agent: "x", rate_limit_per_domain_qps: 1, timeout_ms: 1000, max_redirects: 5 },
  budget: { max_new_urls: 1, max_total_bytes: 1 },
};

describe("researchTools array", () => {
  it("contains the data-plumbing primitives only — no LLM-driven tools", () => {
    const names = researchTools.map(t => t.name).sort();
    expect(names).toEqual([
      "research_fetch",
      "research_search",
      "research_status",
      "research_topic_list",
      "research_topic_show",
    ]);
  });

  it("research_fetch input schema declares topic_id as required", () => {
    const t = researchTools.find(t => t.name === "research_fetch")!;
    const schema = t.input_schema as { required: string[] };
    expect(schema.required).toContain("topic_id");
  });

  it("research_search requires topic_id and query", () => {
    const t = researchTools.find(t => t.name === "research_search")!;
    const schema = t.input_schema as { required: string[] };
    expect(schema.required.sort()).toEqual(["query", "topic_id"]);
  });
});

describe("executeResearchTool dispatch", () => {
  it("research_topic_list returns the listTopicIds output", async () => {
    const v = mkdtempSync(join(tmpdir(), "v-"));
    try {
      mkdirSync(join(v, "research", "topics"), { recursive: true });
      writeFileSync(join(v, "research", "topics", "alpha.yml"), "");
      writeFileSync(join(v, "research", "topics", "beta.yml"), "");
      const r = await executeResearchTool(
        "research_topic_list",
        {},
        { vault: v, config: cfg },
      );
      expect(JSON.parse(r.content).sort()).toEqual(["alpha", "beta"]);
    } finally {
      rmSync(v, { recursive: true, force: true });
    }
  });

  it("research_topic_show loads the YAML and returns the parsed topic", async () => {
    const v = mkdtempSync(join(tmpdir(), "v-"));
    try {
      mkdirSync(join(v, "research", "topics"), { recursive: true });
      writeFileSync(
        join(v, "research", "topics", "t1.yml"),
        yamlStringify({ id: "t1", title: "Test" }),
      );
      const r = await executeResearchTool(
        "research_topic_show",
        { topic_id: "t1" },
        { vault: v, config: cfg },
      );
      const parsed = JSON.parse(r.content);
      expect(parsed.id).toBe("t1");
    } finally {
      rmSync(v, { recursive: true, force: true });
    }
  });

  it("research_status returns the same shape computeStatus produces", async () => {
    const v = mkdtempSync(join(tmpdir(), "v-"));
    try {
      mkdirSync(join(v, "research", "_staging", "t1"), { recursive: true });
      const r = await executeResearchTool(
        "research_status",
        { topic_id: "t1" },
        { vault: v, config: cfg },
      );
      const s = JSON.parse(r.content);
      expect(s.topic_id).toBe("t1");
      expect(s.raw_records).toBe(0);
      expect(s.recent_events).toEqual([]);
    } finally {
      rmSync(v, { recursive: true, force: true });
    }
  });

  it("throws on unknown tool name", async () => {
    await expect(
      executeResearchTool("research_nope", {}, { vault: "/tmp", config: {} as any }),
    ).rejects.toThrow(/unknown tool/);
  });
});
