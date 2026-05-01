import { describe, it, expect } from "vitest";
import { DedupIndex, bodyHash } from "../../../src/research/core/dedup.js";

describe("DedupIndex", () => {
  it("rejects duplicate canonical_url and duplicate body hash", () => {
    const idx = new DedupIndex();
    expect(idx.seen({ canonical_url: "https://x.com/a", body_hash: "h1" })).toBe(false);
    idx.record({ canonical_url: "https://x.com/a", body_hash: "h1" });
    expect(idx.seen({ canonical_url: "https://x.com/a", body_hash: "h2" })).toBe(true);
    expect(idx.seen({ canonical_url: "https://x.com/b", body_hash: "h1" })).toBe(true);
  });
});

describe("bodyHash", () => {
  it("normalizes whitespace before hashing", () => {
    expect(bodyHash("hello   world\n")).toBe(bodyHash("hello world"));
  });
});
