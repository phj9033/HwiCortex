import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { writeDraftFile, draftPath } from "../../../src/research/store/drafts.js";

describe("writeDraftFile", () => {
  it("writes a draft with type:research-draft, hwicortex_index:false, today's date prefix", () => {
    const v = mkdtempSync(join(tmpdir(), "v-"));
    try {
      const path = writeDraftFile(v, {
        topic_id: "t1",
        slug: "rag-overview",
        prompt: "Explain RAG",
        generated_at: "2026-04-30T00:00:00Z",
        model: "claude-sonnet-4-6",
        context_sources: ["/v/.../abcdef012345.md"],
        include_vault: false,
        body_md: "# Body",
      });
      expect(existsSync(path)).toBe(true);
      const txt = readFileSync(path, "utf-8");
      expect(txt).toContain("type: research-draft");
      expect(txt).toContain("hwicortex_index: false");
      expect(txt).toContain("# Body");
      // date-slug pattern: YYYY-MM-DD-<slug>.md
      const today = new Date().toISOString().slice(0, 10);
      expect(path.endsWith(`${today}-rag-overview.md`)).toBe(true);
    } finally {
      rmSync(v, { recursive: true, force: true });
    }
  });

  it("appends -2, -3 to the filename when same-slug drafts already exist that day", () => {
    const v = mkdtempSync(join(tmpdir(), "v-"));
    try {
      const today = new Date().toISOString().slice(0, 10);
      const base = (slug: string) => ({
        topic_id: "t1",
        slug,
        prompt: "p",
        generated_at: "2026-04-30T00:00:00Z",
        model: "m",
        context_sources: [],
        include_vault: false,
        body_md: "x",
      });
      const p1 = writeDraftFile(v, base("dup"));
      const p2 = writeDraftFile(v, base("dup"));
      const p3 = writeDraftFile(v, base("dup"));
      expect(p1.endsWith(`${today}-dup.md`)).toBe(true);
      expect(p2.endsWith(`${today}-dup-2.md`)).toBe(true);
      expect(p3.endsWith(`${today}-dup-3.md`)).toBe(true);
    } finally {
      rmSync(v, { recursive: true, force: true });
    }
  });

  it("draftPath builds <vault>/research/drafts/<topic>/<date-slug>.md", () => {
    expect(draftPath("/v", "t1", "2026-04-30-x")).toBe("/v/research/drafts/t1/2026-04-30-x.md");
  });
});
