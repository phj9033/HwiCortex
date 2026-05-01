import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parse as parseYaml } from "yaml";
import { scaffoldTopic, listTopicIds } from "../../../src/research/topic/scaffold.js";
import { parseTopic } from "../../../src/research/topic/schema.js";

describe("scaffoldTopic", () => {
  it("writes a YAML topic file that parses against the schema", () => {
    const v = mkdtempSync(join(tmpdir(), "v-"));
    try {
      const path = scaffoldTopic(v, "rag-eval", "Evaluate RAG systems");
      expect(path).toContain("research/topics/rag-eval.yml");
      const txt = readFileSync(path, "utf-8");
      expect(txt).toContain("id: rag-eval");
      const parsed = parseTopic(parseYaml(txt));
      expect(parsed.id).toBe("rag-eval");
      expect(parsed.sources[0].type).toBe("web-search");
    } finally {
      rmSync(v, { recursive: true, force: true });
    }
  });

  it("rejects invalid ids", () => {
    const v = mkdtempSync(join(tmpdir(), "v-"));
    try {
      expect(() => scaffoldTopic(v, "Bad ID")).toThrow(/match/);
    } finally {
      rmSync(v, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite an existing topic", () => {
    const v = mkdtempSync(join(tmpdir(), "v-"));
    try {
      scaffoldTopic(v, "x");
      expect(() => scaffoldTopic(v, "x")).toThrow(/already exists/);
    } finally {
      rmSync(v, { recursive: true, force: true });
    }
  });

  it("yields a sources-empty topic when no prompt is supplied", () => {
    const v = mkdtempSync(join(tmpdir(), "v-"));
    try {
      scaffoldTopic(v, "empty");
      const yaml = readFileSync(join(v, "research", "topics", "empty.yml"), "utf-8");
      const parsed = parseTopic(parseYaml(yaml));
      expect(parsed.sources).toEqual([]);
    } finally {
      rmSync(v, { recursive: true, force: true });
    }
  });
});

describe("listTopicIds", () => {
  it("lists yml stems in research/topics", () => {
    const v = mkdtempSync(join(tmpdir(), "v-"));
    try {
      mkdirSync(join(v, "research", "topics"), { recursive: true });
      writeFileSync(join(v, "research", "topics", "a.yml"), "");
      writeFileSync(join(v, "research", "topics", "b.yml"), "");
      writeFileSync(join(v, "research", "topics", "ignored.txt"), "");
      expect(listTopicIds(v).sort()).toEqual(["a", "b"]);
    } finally {
      rmSync(v, { recursive: true, force: true });
    }
  });

  it("returns [] when topics dir is missing", () => {
    const v = mkdtempSync(join(tmpdir(), "v-"));
    try {
      expect(listTopicIds(v)).toEqual([]);
    } finally {
      rmSync(v, { recursive: true, force: true });
    }
  });
});
