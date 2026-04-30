import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { loadTopic, adhocTopicFromPrompt } from "../../../src/research/topic/loader.js";

let vault: string;
beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "vault-"));
  mkdirSync(join(vault, "research", "topics"), { recursive: true });
});

describe("loadTopic", () => {
  it("loads a YAML topic", async () => {
    writeFileSync(join(vault, "research", "topics", "rag-eval.yml"),
`id: rag-eval
title: "RAG"
sources:
  - type: seed-urls
    urls: ["https://example.com"]
`);
    const t = await loadTopic("rag-eval", vault);
    expect(t.id).toBe("rag-eval");
    expect(t.sources).toHaveLength(1);
  });

  it("throws clear error for missing topic", async () => {
    await expect(loadTopic("nope", vault)).rejects.toThrow(/not found/i);
  });
});

describe("adhocTopicFromPrompt", () => {
  it("produces a slug + single web-search source", () => {
    const t = adhocTopicFromPrompt("RAG 평가 방법");
    expect(t.id).toMatch(/^[a-z0-9-]+$/);
    expect(t.sources[0].type).toBe("web-search");
  });

  it("is deterministic for same input", () => {
    expect(adhocTopicFromPrompt("foo bar").id).toBe(adhocTopicFromPrompt("foo bar").id);
  });

  it("does not produce double-dashes when slug truncates on a separator", () => {
    // 39 a's + space at position 40 → first slug pass: "aaaa…aaa-" (40 chars).
    // The post-slice trailing-dash strip should remove the dash before the hash suffix.
    const id = adhocTopicFromPrompt("a".repeat(39) + " end").id;
    expect(id).not.toMatch(/--/);
  });
});
