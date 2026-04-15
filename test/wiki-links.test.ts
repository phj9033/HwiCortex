import { describe, it, expect } from "vitest";
import { extractWikiLinks } from "../src/wikilinks.js";

describe("extractWikiLinks", () => {
  it("extracts basic wiki links", () => {
    const content = "See [[PlayerController]] for details.";
    const result = extractWikiLinks(content);
    expect(result).toContainEqual(
      expect.objectContaining({ type: "wiki_link", targetRef: "PlayerController" })
    );
  });

  it("extracts wiki links with display text", () => {
    const content = "Check the [[설정 화면|Settings Page]].";
    const result = extractWikiLinks(content);
    expect(result).toContainEqual(
      expect.objectContaining({ type: "wiki_link", targetRef: "설정 화면" })
    );
  });

  it("extracts wiki links with folder paths", () => {
    const content = "Reference [[specs/achievement]] here.";
    const result = extractWikiLinks(content);
    expect(result).toContainEqual(
      expect.objectContaining({ type: "wiki_link", targetRef: "specs/achievement" })
    );
  });

  it("extracts multiple wiki links from one document", () => {
    const content = "See [[A]] and [[B]] and [[C]].";
    const result = extractWikiLinks(content);
    expect(result).toHaveLength(3);
  });

  it("ignores wiki links inside fenced code blocks", () => {
    const content = "Text\n```\n[[NotALink]]\n```\nMore [[RealLink]] text.";
    const result = extractWikiLinks(content);
    expect(result).toHaveLength(1);
    expect(result[0].targetRef).toBe("RealLink");
  });

  it("ignores wiki links inside inline code", () => {
    const content = "Use `[[NotALink]]` syntax. See [[RealLink]].";
    const result = extractWikiLinks(content);
    expect(result).toHaveLength(1);
    expect(result[0].targetRef).toBe("RealLink");
  });

  it("returns empty for content without wiki links", () => {
    const content = "No links here. Just [regular](markdown).";
    const result = extractWikiLinks(content);
    expect(result).toHaveLength(0);
  });

  it("deduplicates repeated links", () => {
    const content = "See [[A]] and [[A]] again.";
    const result = extractWikiLinks(content);
    expect(result).toHaveLength(1);
  });

  it("is case-sensitive (consistent with Obsidian)", () => {
    const content = "See [[Settings]] link.";
    const result = extractWikiLinks(content);
    expect(result[0].targetRef).toBe("Settings");
  });
});
