import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { writeSynthesis, synthesisPath } from "../../../src/research/store/synthesis.js";

describe("writeSynthesis", () => {
  it("writes a synthesis note with frontmatter and body", () => {
    const v = mkdtempSync(join(tmpdir(), "v-"));
    try {
      writeSynthesis(v, {
        topic_id: "t1",
        subtopic: "intro",
        generated_at: "2026-04-30T00:00:00Z",
        model: "claude-sonnet-4-6",
        source_cards: ["abcdef012345", "112233445566"],
        body_md: "# Intro\n\nBody here.",
      });
      const path = synthesisPath(v, "t1", "intro");
      const txt = readFileSync(path, "utf-8");
      expect(txt).toContain("type: research-synthesis");
      expect(txt).toContain("subtopic: intro");
      expect(txt).toContain("model: claude-sonnet-4-6");
      expect(txt).toContain("- abcdef012345");
      expect(txt).toContain("# Intro");
      expect(txt.endsWith("\n")).toBe(true);
    } finally {
      rmSync(v, { recursive: true, force: true });
    }
  });

  it("synthesisPath puts the file under research/notes/<topic>/<sub>.md", () => {
    expect(synthesisPath("/v", "t1", "x")).toBe("/v/research/notes/t1/x.md");
  });
});
