import { describe, it, expect } from "vitest";
import { extractWikiLinks } from "../src/wikilinks.js";

describe("extractWikiLinks", () => {
  it("extracts wiki links with various formats", () => {
    const content = "See [[PlayerController]] and [[설정 화면|Settings]] and [[specs/achievement]].";
    const result = extractWikiLinks(content);
    expect(result).toHaveLength(3);
    expect(result).toContainEqual(expect.objectContaining({ type: "wiki_link", targetRef: "PlayerController" }));
    expect(result).toContainEqual(expect.objectContaining({ type: "wiki_link", targetRef: "설정 화면" }));
    expect(result).toContainEqual(expect.objectContaining({ type: "wiki_link", targetRef: "specs/achievement" }));
  });

  it("ignores links inside code blocks and inline code", () => {
    const content = "Text\n```\n[[InFenced]]\n```\nUse `[[InInline]]` syntax. See [[Real]].";
    const result = extractWikiLinks(content);
    expect(result).toHaveLength(1);
    expect(result[0].targetRef).toBe("Real");
  });

  it("deduplicates and returns empty for no links", () => {
    expect(extractWikiLinks("See [[A]] and [[A]] again.")).toHaveLength(1);
    expect(extractWikiLinks("No links here. Just [regular](markdown).")).toHaveLength(0);
  });
});
