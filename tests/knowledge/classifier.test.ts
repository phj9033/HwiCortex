import { describe, it, expect } from "bun:test";
import { classify } from "../../src/knowledge/classifier";

describe("Classifier", () => {
  it("should determine project folder from session project field", () => {
    const result = classify({ project: "hwicortex", title: "some title" });
    expect(result.folder).toBe("hwicortex");
  });

  it("should generate file name from title", () => {
    const result = classify({ title: "My Great Idea" });
    expect(result.fileName).toBe("my-great-idea.md");
  });

  it("should assign tags from extracted knowledge", () => {
    const result = classify({ title: "test", tags: ["typescript", "testing"] });
    expect(result.tags).toEqual(["typescript", "testing"]);
  });

  it("should use 'general' folder when no project", () => {
    const result = classify({ title: "test" });
    expect(result.folder).toBe("general");
  });

  it("should handle Korean titles in file names", () => {
    const result = classify({ title: "프로젝트 설계 문서" });
    expect(result.fileName).toBe("프로젝트-설계-문서.md");
  });

  it("should handle empty title", () => {
    const result = classify({});
    expect(result.fileName).toMatch(/^\d{4}-\d{2}-\d{2}T\d+Z\.md$/);
  });

  it("should remove non-alphanumeric chars except Korean", () => {
    const result = classify({ title: "Hello, World! @#$% Test" });
    expect(result.fileName).toBe("hello-world-test.md");
  });

  it("should default tags to empty array", () => {
    const result = classify({ title: "test" });
    expect(result.tags).toEqual([]);
  });

  it("should handle empty project string as general", () => {
    const result = classify({ project: "", title: "test" });
    expect(result.folder).toBe("general");
  });
});
