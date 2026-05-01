import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { writeCard, cardPath, readCardFrontmatter } from "../../../src/research/store/cards.js";

describe("writeCard", () => {
  it("writes markdown with body_hash in frontmatter", () => {
    const v = mkdtempSync(join(tmpdir(), "v-"));
    try {
      writeCard(v, {
        source_id: "abc",
        topic_id: "t",
        url: "https://x/a",
        title: "T",
        author: null,
        published: null,
        fetched: "2026-04-30",
        language: "en",
        tags: ["r"],
        body_hash: "H",
        tldr: ["one", "two", "three"],
        excerpts: ["q1"],
      });
      const path = cardPath(v, "t", "abc");
      const txt = readFileSync(path, "utf-8");
      expect(txt).toContain("body_hash: H");
      expect(txt).toContain("# T");
      expect(txt).toContain("> q1");
      expect(readCardFrontmatter(path)?.body_hash).toBe("H");
    } finally {
      rmSync(v, { recursive: true, force: true });
    }
  });

  it("renders _(none)_ when no excerpts", () => {
    const v = mkdtempSync(join(tmpdir(), "v-"));
    try {
      writeCard(v, {
        source_id: "abc",
        topic_id: "t",
        url: "https://x/a",
        title: "T",
        author: null,
        published: null,
        fetched: "2026-04-30",
        language: "en",
        tags: [],
        body_hash: "H2",
        tldr: ["one", "two", "three"],
        excerpts: [],
      });
      const txt = readFileSync(cardPath(v, "t", "abc"), "utf-8");
      expect(txt).toContain("_(none)_");
    } finally {
      rmSync(v, { recursive: true, force: true });
    }
  });

  it("readCardFrontmatter returns null when file is absent", () => {
    const v = mkdtempSync(join(tmpdir(), "v-"));
    try {
      expect(readCardFrontmatter(cardPath(v, "t", "missing"))).toBeNull();
    } finally {
      rmSync(v, { recursive: true, force: true });
    }
  });
});
